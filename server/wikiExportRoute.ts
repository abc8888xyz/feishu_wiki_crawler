/**
 * Wiki Export API endpoints.
 *
 * Exports Feishu/Lark docx pages to Markdown files and packages them as a ZIP.
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
import { eq, and } from "drizzle-orm";
import { getTenantAccessToken } from "./feishuApi";
import archiver from "archiver";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportJob {
  jobId: string;
  sessionId: number;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  errorMsg?: string;
  zipBuffer?: Buffer;
  startedAt: number;
}

// ─── In-memory job store ──────────────────────────────────────────────────────
// For simplicity, export jobs are kept in memory (they're short-lived)
const exportJobs = new Map<string, ExportJob>();

function generateJobId(): string {
  return `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveAccessToken(
  userAccessToken?: string,
  appId?: string,
  appSecret?: string,
  apiBase = "https://open.feishu.cn"
): Promise<string> {
  if (userAccessToken?.trim()) return userAccessToken.trim();
  if (appId && appSecret) return getTenantAccessToken(appId, appSecret, apiBase);
  throw new Error("Authentication required. Please provide either App credentials or a User Access Token.");
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

/** Sanitize a filename to be safe for ZIP */
function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Background export runner ─────────────────────────────────────────────────

async function runExportJob(
  job: ExportJob,
  nodes: Array<{ objToken: string; title: string; depth: number; url: string }>,
  accessToken: string,
  apiBase: string
) {
  const CONCURRENCY = 3; // Stay well under 5 req/sec rate limit
  const DELAY_BETWEEN_BATCHES_MS = 800; // ~3.75 req/sec with concurrency=3

  // Collect all markdown content: { path, content }
  const files: Array<{ path: string; content: string }> = [];

  // Track title counts for deduplication
  const titleCounts = new Map<string, number>();

  // Process in batches
  for (let i = 0; i < nodes.length; i += CONCURRENCY) {
    if (job.status === "failed") break;

    const batch = nodes.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (node) => {
        try {
          const markdown = await fetchDocxMarkdown(node.objToken, accessToken, apiBase);

          // Build a unique filename with depth prefix for organization
          const baseName = sanitizeFilename(node.title || node.objToken);
          const count = titleCounts.get(baseName) ?? 0;
          titleCounts.set(baseName, count + 1);
          const uniqueName = count === 0 ? baseName : `${baseName}_${count}`;

          // Add URL and title as frontmatter
          const frontmatter = `---\ntitle: "${(node.title || "").replace(/"/g, '\\"')}"\nurl: "${node.url}"\ndepth: ${node.depth}\n---\n\n`;
          files.push({
            path: `${uniqueName}.md`,
            content: frontmatter + markdown,
          });

          job.done++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Export] Failed to export ${node.objToken} (${node.title}): ${msg}`);
          job.failed++;
          job.done++; // count as processed
        }
      })
    );

    // Throttle between batches
    if (i + CONCURRENCY < nodes.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Build ZIP in memory
  try {
    const zipBuffer = await buildZip(files);
    job.zipBuffer = zipBuffer;
    job.status = "done";
    console.log(`[Export] Job ${job.jobId} done: ${files.length} files, ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);
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

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "Database not available" });
      return;
    }

    // Get session to find apiBase
    const sessions = await db
      .select()
      .from(crawlSessions)
      .where(eq(crawlSessions.id, sessionId))
      .limit(1);

    if (sessions.length === 0) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    const session = sessions[0];
    const apiBase = session.apiBase ?? "https://open.feishu.cn";

    // Resolve access token
    let accessToken: string;
    try {
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    // Get all docx nodes from this session
    const allNodes = await db
      .select()
      .from(crawlNodes)
      .where(and(eq(crawlNodes.sessionId, sessionId), eq(crawlNodes.objType, "docx")));

    if (allNodes.length === 0) {
      res.status(404).json({ error: "No docx nodes found in this session" });
      return;
    }

    // Create job
    const jobId = generateJobId();
    const job: ExportJob = {
      jobId,
      sessionId,
      status: "running",
      total: allNodes.length,
      done: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    exportJobs.set(jobId, job);

    // Map nodes to export format (filter out nodes with null objToken)
    const exportNodes = allNodes
      .filter((n) => n.objToken != null)
      .map((n) => ({
        objToken: n.objToken as string,
        title: n.title ?? "Untitled",
        depth: n.depth,
        url: n.url ?? "",
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
      total: allNodes.length,
      message: `Export started for ${allNodes.length} docx files`,
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
}
