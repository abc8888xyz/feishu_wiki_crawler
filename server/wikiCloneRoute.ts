/**
 * Clone Feishu Wiki to LarkSuite
 *
 * Clones documents from a Feishu wiki space to a LarkSuite wiki space,
 * preserving original formatting and folder hierarchy.
 *
 * Pipeline per document (4 steps):
 *   1. Export from Feishu as docx (reuse Drive Export API)
 *   2. Upload docx to LarkSuite Drive
 *   3. Import as LarkSuite document
 *   4. Create wiki node in target space (with parent mapping for hierarchy)
 *
 * POST /api/wiki/clone-to-lark/start
 *   Body: { sessionId, targetSpaceId, targetAccessToken, sourceAccessToken }
 *   -> { jobId, total }
 *
 * GET /api/wiki/clone-to-lark/status?jobId=...
 *   -> { status, done, total, failed, skipped, currentStep, errors }
 */

import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { crawlNodes, crawlSessions } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getInMemorySession } from "./inMemorySessionStore";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CloneJob {
  jobId: string;
  sessionId: number;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  skipped: number;
  currentStep: string;
  errorMsg?: string;
  nodeMapping: Map<string, string>; // oldNodeToken -> newNodeToken
  startedAt: number;
  errors: Array<{ title: string; error: string }>;
}

interface CloneNode {
  nodeToken: string;
  parentNodeToken: string | null;
  objToken: string;
  objType: string;
  title: string;
  depth: number;
}

// ─── In-memory job store ──────────────────────────────────────────────────────
const cloneJobs = new Map<string, CloneJob>();

function generateCloneJobId(): string {
  return `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step 1: Export from Feishu (same as wikiDocExportRoute) ─────────────────

async function createExportTask(
  objToken: string,
  objType: "docx" | "doc",
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/export_tasks`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_extension: "docx",
      token: objToken,
      type: objType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create export task HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    code: number; msg: string; data?: { ticket?: string };
  };

  if (json.code !== 0) throw new Error(`Export API error ${json.code}: ${json.msg}`);
  if (!json.data?.ticket) throw new Error("No ticket returned from export task");
  return json.data.ticket;
}

async function pollExportTask(
  ticket: string,
  objToken: string,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/export_tasks/${encodeURIComponent(ticket)}?token=${encodeURIComponent(objToken)}`;
  const startTime = Date.now();
  let successNoTokenCount = 0;

  while (Date.now() - startTime < 120_000) {
    await sleep(2000);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Poll export HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      code: number; msg: string;
      data?: { result?: { file_token?: string; job_status?: number; job_error_msg?: string } };
    };
    if (json.code !== 0) throw new Error(`Poll API error ${json.code}: ${json.msg}`);

    const result = json.data?.result;
    if (!result) continue;
    if (result.job_status === 3) throw new Error(`Export failed: ${result.job_error_msg ?? "unknown"}`);
    if (result.file_token) return result.file_token;

    if (result.job_status === 2) {
      successNoTokenCount++;
      if (successNoTokenCount >= 5) {
        throw new Error("Export completed but no file_token returned");
      }
    }
  }
  throw new Error("Export timed out after 120s");
}

async function downloadExportFile(
  fileToken: string,
  accessToken: string,
  apiBase: string
): Promise<Buffer> {
  const url = `${apiBase}/open-apis/drive/v1/export_tasks/file/${encodeURIComponent(fileToken)}/download`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Download HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function exportDocFromFeishu(
  objToken: string,
  objType: "docx" | "doc",
  accessToken: string,
  apiBase: string
): Promise<Buffer> {
  const ticket = await createExportTask(objToken, objType, accessToken, apiBase);
  const fileToken = await pollExportTask(ticket, objToken, accessToken, apiBase);
  return downloadExportFile(fileToken, accessToken, apiBase);
}

// ─── Step 2: Upload to LarkSuite Drive ──────────────────────────────────────

async function uploadToLarkDrive(
  fileBytes: Buffer,
  fileName: string,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/medias/upload_all`;

  // Build multipart form data manually
  const boundary = `----CloneBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  // file_name field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${fileName}.docx\r\n`
  ));
  // parent_type field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\nexplorer\r\n`
  ));
  // parent_node field (empty = root)
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n\r\n`
  ));
  // size field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${fileBytes.length}\r\n`
  ));
  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`
  ));
  parts.push(fileBytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    code: number; msg: string; data?: { file_token?: string };
  };

  if (json.code !== 0) throw new Error(`Upload API error ${json.code}: ${json.msg}`);
  if (!json.data?.file_token) throw new Error("No file_token returned from upload");

  console.log(`[Clone] Uploaded ${fileName}: file_token=${json.data.file_token}`);
  return json.data.file_token;
}

// ─── Step 3: Import as LarkSuite document ───────────────────────────────────

async function createImportTask(
  fileToken: string,
  fileName: string,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/import_tasks`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_extension: "docx",
      file_token: fileToken,
      type: "docx",
      file_name: fileName,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Import task HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    code: number; msg: string; data?: { ticket?: string };
  };

  if (json.code !== 0) throw new Error(`Import API error ${json.code}: ${json.msg}`);
  if (!json.data?.ticket) throw new Error("No ticket returned from import task");

  console.log(`[Clone] Import task created: ticket=${json.data.ticket}`);
  return json.data.ticket;
}

async function pollImportTask(
  ticket: string,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/import_tasks/${encodeURIComponent(ticket)}`;
  const startTime = Date.now();

  while (Date.now() - startTime < 120_000) {
    await sleep(2000);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Poll import HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      code: number; msg: string;
      data?: { result?: { token?: string; url?: string; type?: string; job_status?: number; job_error_msg?: string } };
    };

    if (json.code !== 0) throw new Error(`Poll import API error ${json.code}: ${json.msg}`);

    const result = json.data?.result;
    if (!result) continue;

    if (result.job_status === 3) {
      throw new Error(`Import failed: ${result.job_error_msg ?? "unknown"}`);
    }

    if (result.token) {
      console.log(`[Clone] Import done: token=${result.token}`);
      return result.token;
    }
  }
  throw new Error("Import timed out after 120s");
}

// ─── Step 4: Create wiki node in target space ───────────────────────────────

async function createWikiNode(
  spaceId: string,
  objToken: string,
  objType: string,
  title: string,
  parentNodeToken: string | null,
  accessToken: string,
  apiBase: string
): Promise<string> {
  const url = `${apiBase}/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`;
  const bodyObj: Record<string, string> = {
    obj_type: objType === "doc" ? "doc" : "docx",
    obj_token: objToken,
    title,
  };
  if (parentNodeToken) {
    bodyObj.parent_node_token = parentNodeToken;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create wiki node HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    code: number; msg: string;
    data?: { node?: { node_token?: string; obj_token?: string } };
  };

  if (json.code !== 0) throw new Error(`Wiki node API error ${json.code}: ${json.msg}`);
  const nodeToken = json.data?.node?.node_token;
  if (!nodeToken) throw new Error("No node_token returned from wiki node creation");

  console.log(`[Clone] Wiki node created: node_token=${nodeToken}, title=${title}`);
  return nodeToken;
}

// ─── Background clone runner ────────────────────────────────────────────────

async function runCloneJob(
  job: CloneJob,
  nodes: CloneNode[],
  sourceAccessToken: string,
  sourceApiBase: string,
  targetSpaceId: string,
  targetAccessToken: string,
  targetApiBase: string,
  targetParentNodeToken?: string
) {
  const DELAY_BETWEEN_NODES_MS = 2000;

  // Sort by depth for BFS processing
  nodes.sort((a, b) => a.depth - b.depth);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    job.currentStep = `[${i + 1}/${nodes.length}] ${node.title}`;

    try {
      // Step 1: Export from Feishu as docx
      console.log(`[Clone] ${i + 1}/${nodes.length} Exporting: ${node.title} (${node.objToken})`);
      job.currentStep = `[${i + 1}/${nodes.length}] Exporting: ${node.title}`;

      const exportType: "docx" | "doc" = node.objType === "doc" ? "doc" : "docx";
      const fileBytes = await exportDocFromFeishu(
        node.objToken, exportType, sourceAccessToken, sourceApiBase
      );

      // Step 2: Upload to LarkSuite Drive
      console.log(`[Clone] ${i + 1}/${nodes.length} Uploading: ${node.title} (${fileBytes.length} bytes)`);
      job.currentStep = `[${i + 1}/${nodes.length}] Uploading: ${node.title}`;

      const sanitizedName = node.title
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 100);

      const uploadedFileToken = await uploadToLarkDrive(
        fileBytes, sanitizedName, targetAccessToken, targetApiBase
      );

      // Step 3: Import as document
      console.log(`[Clone] ${i + 1}/${nodes.length} Importing: ${node.title}`);
      job.currentStep = `[${i + 1}/${nodes.length}] Importing: ${node.title}`;

      const importTicket = await createImportTask(
        uploadedFileToken, sanitizedName, targetAccessToken, targetApiBase
      );
      const importedDocToken = await pollImportTask(
        importTicket, targetAccessToken, targetApiBase
      );

      // Step 4: Create wiki node with hierarchy
      console.log(`[Clone] ${i + 1}/${nodes.length} Creating wiki node: ${node.title}`);
      job.currentStep = `[${i + 1}/${nodes.length}] Creating node: ${node.title}`;

      // Resolve parent: use mapped parent if available, otherwise target root
      let parentToken = targetParentNodeToken ?? null;
      if (node.parentNodeToken && job.nodeMapping.has(node.parentNodeToken)) {
        parentToken = job.nodeMapping.get(node.parentNodeToken)!;
      }

      const newNodeToken = await createWikiNode(
        targetSpaceId, importedDocToken, node.objType, node.title,
        parentToken, targetAccessToken, targetApiBase
      );

      // Store mapping for child nodes
      job.nodeMapping.set(node.nodeToken, newNodeToken);
      job.done++;

      console.log(`[Clone] ${i + 1}/${nodes.length} Done: ${node.title}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Clone] Failed to clone ${node.title}: ${msg}`);
      job.errors.push({ title: node.title, error: msg });
      job.failed++;
      job.done++;
    }

    // Delay between nodes
    if (i < nodes.length - 1) {
      await sleep(DELAY_BETWEEN_NODES_MS);
    }
  }

  job.status = "done";
  job.currentStep = `Done: ${job.done - job.failed} cloned, ${job.failed} failed, ${job.skipped} skipped`;
  console.log(`[Clone] Job ${job.jobId} done: ${job.done - job.failed} cloned, ${job.failed} failed, ${job.skipped} skipped`);
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerWikiCloneRoute(app: Express) {
  // ─── Start clone job ────────────────────────────────────────────────────

  app.post("/api/wiki/clone-to-lark/start", async (req: Request, res: Response) => {
    const {
      sessionId: sessionIdStr,
      targetSpaceId,
      targetAccessToken,
      sourceAccessToken,
      targetParentNodeToken,
    } = req.body as Record<string, string>;

    const sessionId = parseInt(sessionIdStr ?? "");
    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }
    if (!targetSpaceId?.trim()) {
      res.status(400).json({ error: "Missing targetSpaceId" });
      return;
    }
    if (!targetAccessToken?.trim()) {
      res.status(400).json({ error: "Missing targetAccessToken (LarkSuite User Access Token)" });
      return;
    }
    if (!sourceAccessToken?.trim()) {
      res.status(400).json({ error: "Missing sourceAccessToken (Feishu User Access Token)" });
      return;
    }

    // Load session nodes
    let sourceApiBase = "https://open.feishu.cn";
    let allNodes: Array<{
      nodeToken: string;
      parentNodeToken: string | null;
      objToken: string | null;
      objType: string | null;
      title: string | null;
      depth: number;
    }>;

    const db = await getDb();
    if (db) {
      const sessions = await db
        .select().from(crawlSessions)
        .where(eq(crawlSessions.id, sessionId))
        .limit(1);

      if (sessions.length === 0) {
        res.status(404).json({ error: `Session ${sessionId} not found` });
        return;
      }

      sourceApiBase = sessions[0].apiBase ?? "https://open.feishu.cn";

      const dbNodes = await db
        .select().from(crawlNodes)
        .where(eq(crawlNodes.sessionId, sessionId));

      allNodes = dbNodes.map((n) => ({
        nodeToken: n.nodeToken,
        parentNodeToken: n.parentNodeToken ?? null,
        objToken: n.objToken ?? null,
        objType: n.objType ?? null,
        title: n.title ?? null,
        depth: n.depth ?? 0,
      }));
    } else {
      const memSession = getInMemorySession(sessionId);
      if (!memSession) {
        res.status(404).json({ error: `Session ${sessionId} not found` });
        return;
      }
      sourceApiBase = memSession.apiBase;
      allNodes = memSession.nodes;
    }

    // Filter to cloneable nodes (docx/doc only)
    const cloneableNodes: CloneNode[] = [];
    let skipped = 0;

    for (const n of allNodes) {
      if (!n.objToken) { skipped++; continue; }
      if (n.objType === "docx" || n.objType === "doc") {
        cloneableNodes.push({
          nodeToken: n.nodeToken,
          parentNodeToken: n.parentNodeToken,
          objToken: n.objToken,
          objType: n.objType,
          title: n.title ?? "Untitled",
          depth: n.depth,
        });
      } else {
        skipped++;
      }
    }

    if (cloneableNodes.length === 0) {
      res.status(404).json({ error: "No cloneable documents (docx/doc) found in this session" });
      return;
    }

    // Create job
    const jobId = generateCloneJobId();
    const job: CloneJob = {
      jobId,
      sessionId,
      status: "running",
      total: cloneableNodes.length,
      done: 0,
      failed: 0,
      skipped,
      currentStep: "Starting...",
      nodeMapping: new Map(),
      startedAt: Date.now(),
      errors: [],
    };
    cloneJobs.set(jobId, job);

    const targetApiBase = "https://open.larksuite.com";

    console.log(`[Clone] Starting clone job: ${cloneableNodes.length} docs from session ${sessionId}, target space=${targetSpaceId}`);

    // Start background job
    runCloneJob(
      job, cloneableNodes, sourceAccessToken.trim(), sourceApiBase,
      targetSpaceId.trim(), targetAccessToken.trim(), targetApiBase,
      targetParentNodeToken?.trim() || undefined
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.errorMsg = msg;
      console.error(`[Clone] Job ${jobId} crashed: ${msg}`);
    });

    res.json({
      jobId,
      total: cloneableNodes.length,
      skipped,
      message: `Clone started: ${cloneableNodes.length} documents (${skipped} non-doc nodes skipped)`,
    });
  });

  // ─── Get clone job status ───────────────────────────────────────────────

  app.get("/api/wiki/clone-to-lark/status", (req: Request, res: Response) => {
    const { jobId } = req.query as Record<string, string>;
    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const job = cloneJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);

    res.json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      done: job.done,
      failed: job.failed,
      skipped: job.skipped,
      currentStep: job.currentStep,
      errorMsg: job.errorMsg,
      errors: job.errors,
      elapsed,
    });
  });
}
