/**
 * Wiki Export API endpoints.
 *
 * Exports Feishu/Lark docx pages to Markdown files and packages them as a ZIP.
 * Files are organized into a hierarchical folder structure mirroring the wiki tree.
 *
 * POST /api/wiki/export/start
 *   → Starts a background export job, returns { jobId }
 *   Body: { sessionId, userAccessToken?, appId?, appSecret? }
 *
 * GET /api/wiki/export/status?jobId=...
 *   → Returns current export job status (poll every 2s)
 *
 * GET /api/wiki/export/download?jobId=...
 *   → Streams the ZIP file for download
 *
 * API used: GET /open-apis/docs/v1/content?doc_token=X&doc_type=docx&content_type=markdown
 * Rate limit: 5 req/sec per token
 */

import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { crawlNodes, crawlSessions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { getInMemorySession } from "./inMemorySessionStore";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportJob {
  jobId: string;
  sessionId: number;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  errorMsg?: string;
  lastError?: string;  // last individual file error (for scope detection)
  zipBuffer?: Buffer;
  startedAt: number;
}

// ─── In-memory job store ──────────────────────────────────────────────────────
const exportJobs = new Map<string, ExportJob>();

function generateJobId(): string {
  return `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveAccessToken(
  userAccessToken?: string,
  _appId?: string,
  _appSecret?: string,
  _apiBase = "https://open.feishu.cn"
): Promise<string> {
  if (userAccessToken?.trim()) return userAccessToken.trim();
  throw new Error(
    "Markdown export requires a User Access Token (not App credentials). " +
    "App tokens lack the docs:document.content:read scope. " +
    "Please switch to 'User Access Token' tab and provide a valid token."
  );
}

/** Fetch markdown content of a single docx via Feishu docs/v1/content API */
async function fetchDocxMarkdown(
  objToken: string,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/docs/v1/content?doc_token=${encodeURIComponent(objToken)}&doc_type=docx&content_type=markdown`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { code: number; msg: string; data?: { content?: string } };

  if (json.code !== 0) {
    throw new Error(`Feishu API error ${json.code}: ${json.msg}`);
  }

  return json.data?.content ?? "";
}

/** Sanitize a path segment (folder or filename) to be safe for ZIP */
export function sanitizeFilename(title: string): string {
  return (title || "Untitled")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "_")   // no leading dots
    .replace(/_+/g, "_")    // collapse consecutive underscores
    .slice(0, 80)
    || "Untitled";
}

/**
 * Build a map of nodeToken → full folder path for all nodes in a session.
 *
 * Algorithm:
 *   1. Build a parent lookup: nodeToken → parentNodeToken
 *   2. Build a title lookup: nodeToken → sanitized title
 *   3. For each node, walk up the ancestor chain to build the path
 *   4. Cache computed paths to avoid redundant traversal
 *
 * Example output:
 *   "tokenA" → "Chapter_1"
 *   "tokenB" → "Chapter_1/Section_1.1"
 *   "tokenC" → "Chapter_2"
 */
export function buildNodePaths(
  allNodes: Array<{
    nodeToken: string;
    parentNodeToken: string | null | undefined;
    title: string | null | undefined;
    objType: string | null | undefined;
  }>
): Map<string, string> {
  // Build lookup maps
  const parentMap = new Map<string, string | null>();
  const titleMap = new Map<string, string>();

  for (const node of allNodes) {
    parentMap.set(node.nodeToken, node.parentNodeToken ?? null);
    titleMap.set(node.nodeToken, sanitizeFilename(node.title ?? "Untitled"));
  }

  // Cache for computed paths
  const pathCache = new Map<string, string>();

  function getPath(token: string, visited = new Set<string>()): string {
    if (pathCache.has(token)) return pathCache.get(token)!;

    // Cycle guard
    if (visited.has(token)) return "";
    visited.add(token);

    const parent = parentMap.get(token);
    const title = titleMap.get(token) ?? "Untitled";

    let path: string;
    if (!parent || !parentMap.has(parent)) {
      // Root node or parent not in session → place at top level
      path = title;
    } else {
      const parentPath = getPath(parent, visited);
      path = parentPath ? `${parentPath}/${title}` : title;
    }

    pathCache.set(token, path);
    return path;
  }

  const result = new Map<string, string>();
  for (const node of allNodes) {
    result.set(node.nodeToken, getPath(node.nodeToken));
  }

  return result;
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Background export runner ─────────────────────────────────────────────────

async function runExportJob(
  job: ExportJob,
  nodes: Array<{
    nodeToken: string;
    objToken: string;
    title: string;
    depth: number;
    url: string;
    folderPath: string;  // pre-computed hierarchical path
  }>,
  accessToken: string,
  apiBase: string
) {
  const CONCURRENCY = 3;
  const DELAY_BETWEEN_BATCHES_MS = 800;

  const files: Array<{ path: string; content: string }> = [];

  // Track used paths for deduplication within same folder
  const usedPaths = new Map<string, number>();

  for (let i = 0; i < nodes.length; i += CONCURRENCY) {
    if (job.status === "failed") break;

    const batch = nodes.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (node) => {
        try {
          const markdown = await fetchDocxMarkdown(node.objToken, accessToken, apiBase);

          // Build full path: folderPath/filename.md
          // folderPath already includes the node's own title as last segment,
          // so we use it directly as the file path (just add .md extension).
          const basePath = node.folderPath;
          const count = usedPaths.get(basePath) ?? 0;
          usedPaths.set(basePath, count + 1);
          const uniquePath = count === 0 ? `${basePath}.md` : `${basePath}_${count}.md`;

          const frontmatter = `---\ntitle: "${(node.title || "").replace(/"/g, '\\"')}"\nurl: "${node.url}"\ndepth: ${node.depth}\n---\n\n`;
          files.push({
            path: uniquePath,
            content: frontmatter + markdown,
          });

          job.done++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Export] Failed to export ${node.objToken} (${node.title}): ${msg}`);
          job.failed++;
          job.done++;
          job.lastError = msg;
          // Early exit if scope error detected (all files will fail)
          if (msg.includes("99991672") || msg.includes("docs:document.content:read")) {
            job.status = "failed";
            job.errorMsg = "SCOPE_ERROR:docs:document.content:read";
            return;
          }
        }
      })
    );

    if (i + CONCURRENCY < nodes.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // If already marked failed (e.g. scope error), skip ZIP
  if (job.status === "failed") return;

  // If all files failed, mark as failed instead of producing empty ZIP
  if (files.length === 0 && job.failed > 0) {
    job.status = "failed";
    job.errorMsg = job.lastError ?? "All files failed to export";
    console.warn(`[Export] Job ${job.jobId} failed: 0 files exported, ${job.failed} errors`);
    return;
  }

  // Build ZIP in memory
  try {
    const zipBuffer = await buildZip(files);
    job.zipBuffer = zipBuffer;
    job.status = "done";
    console.log(`[Export] Job ${job.jobId} done: ${files.length} files (${job.failed} failed), ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMsg = `Failed to build ZIP: ${msg}`;
    console.error(`[Export] Job ${job.jobId} ZIP build failed: ${msg}`);
  }
}

/** Build a ZIP buffer from an array of { path, content } */
function buildZip(files: Array<{ path: string; content: string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const file of files) {
      archive.append(file.content, { name: file.path });
    }

    archive.finalize();
  });
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerWikiExportRoute(app: Express) {
  // ─── Start export job ─────────────────────────────────────────────────────

  app.post("/api/wiki/export/start", async (req: Request, res: Response) => {
    const { sessionId: sessionIdStr, userAccessToken, appId, appSecret } = req.body as Record<string, string>;
    const sessionId = parseInt(sessionIdStr ?? "");

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    let apiBase = "https://open.feishu.cn";
    let allNodes: Array<{
      nodeToken: string;
      parentNodeToken: string | null | undefined;
      objToken: string | null;
      objType: string | null | undefined;
      title: string | null | undefined;
      depth: number;
      url: string | null;
    }>;

    const db = await getDb();
    if (db) {
      // Get session from DB
      const sessions = await db
        .select()
        .from(crawlSessions)
        .where(eq(crawlSessions.id, sessionId))
        .limit(1);

      if (sessions.length === 0) {
        res.status(404).json({ error: `Session ${sessionId} not found` });
        return;
      }

      apiBase = sessions[0].apiBase ?? "https://open.feishu.cn";

      allNodes = await db
        .select()
        .from(crawlNodes)
        .where(eq(crawlNodes.sessionId, sessionId));
    } else {
      // Try in-memory session store
      const memSession = getInMemorySession(sessionId);
      if (!memSession) {
        res.status(404).json({ error: `Session ${sessionId} not found (no database configured)` });
        return;
      }

      apiBase = memSession.apiBase;
      allNodes = memSession.nodes;
    }

    // Resolve access token
    let accessToken: string;
    try {
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    // Filter to exportable nodes (docx only for markdown)
    const exportableNodes = allNodes.filter(
      (n) => n.objType === "docx" && n.objToken != null
    );

    if (exportableNodes.length === 0) {
      res.status(404).json({ error: "No docx nodes found in this session" });
      return;
    }

    // Build hierarchical paths for ALL nodes (needed for folder structure)
    const nodePaths = buildNodePaths(allNodes);

    // Create job
    const jobId = generateJobId();
    const job: ExportJob = {
      jobId,
      sessionId,
      status: "running",
      total: exportableNodes.length,
      done: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    exportJobs.set(jobId, job);

    // Map exportable nodes with their computed folder paths
    const exportNodes = exportableNodes.map((n) => ({
      nodeToken: n.nodeToken,
      objToken: n.objToken as string,
      title: n.title ?? "Untitled",
      depth: n.depth,
      url: n.url ?? "",
      folderPath: nodePaths.get(n.nodeToken) ?? sanitizeFilename(n.title ?? "Untitled"),
    }));

    // Start background export
    runExportJob(job, exportNodes, accessToken, apiBase).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.errorMsg = msg;
      console.error(`[Export] Job ${jobId} crashed: ${msg}`);
    });

    res.json({
      jobId,
      total: exportableNodes.length,
      message: `Export started for ${exportableNodes.length} docx files`,
    });
  });

  // ─── Get export job status ────────────────────────────────────────────────

  app.get("/api/wiki/export/status", (req: Request, res: Response) => {
    const { jobId } = req.query as Record<string, string>;

    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const job = exportJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);
    const rate = elapsed > 0 ? (job.done / elapsed).toFixed(1) : "0";

    res.json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      done: job.done,
      failed: job.failed,
      errorMsg: job.errorMsg,
      elapsed,
      rate: `${rate} files/sec`,
      hasZip: !!job.zipBuffer,
    });
  });

  // ─── Download ZIP ─────────────────────────────────────────────────────────

  app.get("/api/wiki/export/download", (req: Request, res: Response) => {
    const { jobId } = req.query as Record<string, string>;

    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const job = exportJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    if (job.status !== "done" || !job.zipBuffer) {
      res.status(400).json({ error: "Export not complete yet" });
      return;
    }

    const filename = `wiki_markdown_${job.sessionId}_${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", job.zipBuffer.length);
    res.send(job.zipBuffer);
  });

  // ─── Download single node Markdown ────────────────────────────────────────

  app.get("/api/wiki/export/single", async (req: Request, res: Response) => {
    const {
      objToken,
      title,
      userAccessToken,
      appId,
      appSecret,
      apiBase: apiBaseParam,
    } = req.query as Record<string, string>;

    if (!objToken) {
      res.status(400).json({ error: "Missing objToken" });
      return;
    }

    const apiBase = apiBaseParam ?? "https://open.feishu.cn";

    let accessToken: string;
    try {
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    let content: string;
    try {
      content = await fetchDocxMarkdown(objToken, accessToken, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to fetch markdown: ${msg}` });
      return;
    }

    const safeTitle = title ?? objToken;
    const frontmatter = `---\ntitle: "${safeTitle.replace(/"/g, '\\"')}"\n---\n\n`;
    const fullContent = frontmatter + content;

    const safeFilename = sanitizeFilename(safeTitle) + ".md";
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    res.send(fullContent);
  });
}
