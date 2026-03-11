/**
 * Wiki Document Export API endpoints.
 *
 * Exports Feishu/Lark docx pages to Docx or PDF files using the Drive Export API.
 * The Drive Export API is an async 3-step process:
 *   1. POST /drive/v1/export_tasks → create task, get ticket
 *   2. GET  /drive/v1/export_tasks/{ticket}?token=... → poll until done, get file_token
 *   3. GET  /drive/v1/export_tasks/{ticket}/download → download file bytes
 *
 * POST /api/wiki/export-doc/start
 *   Body: { sessionId, format: "docx" | "pdf", userAccessToken?, appId?, appSecret? }
 *   → Returns { jobId, total }
 *
 * GET /api/wiki/export-doc/status?jobId=...
 *   → Returns { status, done, total, failed }
 *
 * GET /api/wiki/export-doc/download?jobId=...
 *   → Streams the ZIP file
 *
 * Notes:
 * - Drive Export API requires User Access Token (same as MD export)
 * - Rate limit: ~5 export tasks/sec; we use concurrency=2 + 1s delay between batches
 * - Each export task takes 1-10 seconds to complete (polling every 2s)
 * - Exported files expire 10 minutes after task completion
 */

import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { crawlNodes, crawlSessions } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import archiver from "archiver";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocExportFormat = "docx" | "pdf";

interface DocExportJob {
  jobId: string;
  sessionId: number;
  format: DocExportFormat;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  errorMsg?: string;
  zipBuffer?: Buffer;
  startedAt: number;
}

// ─── In-memory job store ──────────────────────────────────────────────────────
const docExportJobs = new Map<string, DocExportJob>();

function generateJobId(format: DocExportFormat): string {
  return `${format}_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sanitize a filename to be safe for ZIP */
function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

/**
 * Resolve access token — Drive Export API requires User Access Token.
 * App Token (tenant_access_token) does NOT have the required export scope.
 */
async function resolveAccessToken(
  userAccessToken?: string,
  _appId?: string,
  _appSecret?: string
): Promise<string> {
  if (userAccessToken?.trim()) return userAccessToken.trim();
  throw new Error(
    "Docx/PDF export requires a User Access Token (not App credentials). " +
    "App tokens lack the required export scope. " +
    "Please switch to 'User Access Token' tab and provide a valid token."
  );
}

/**
 * Step 1: Create an export task via Drive Export API.
 * Returns the ticket (task ID).
 *
 * For wiki nodes, obj_type can be "docx" or "doc".
 * - type="docx" supports file_extension="docx" or "pdf"
 * - type="doc" supports file_extension="docx" or "pdf"
 */
async function createExportTask(
  objToken: string,
  objType: "docx" | "doc",
  fileExtension: DocExportFormat,
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
      file_extension: fileExtension,
      token: objToken,
      type: objType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create export task HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    code: number;
    msg: string;
    data?: { ticket?: string };
  };

  if (json.code !== 0) {
    throw new Error(`Create export task API error ${json.code}: ${json.msg}`);
  }

  const ticket = json.data?.ticket;
  if (!ticket) {
    throw new Error("Create export task: no ticket returned");
  }

  return ticket;
}

/**
 * Step 2: Poll export task status until done.
 * Returns the file_token for downloading.
 */
async function pollExportTask(
  ticket: string,
  objToken: string,
  accessToken: string,
  apiBase: string,
  maxWaitMs = 120_000
): Promise<string> {
  const url = `${apiBase}/open-apis/drive/v1/export_tasks/${encodeURIComponent(ticket)}?token=${encodeURIComponent(objToken)}`;
  const startTime = Date.now();
  const POLL_INTERVAL_MS = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Poll export task HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      code: number;
      msg: string;
      data?: {
        result?: {
          file_token?: string;
          file_name?: string;
          file_size?: number;
          job_status?: number; // 0=init, 1=processing, 2=success, 3=failed
          job_error_msg?: string;
        };
      };
    };

    if (json.code !== 0) {
      throw new Error(`Poll export task API error ${json.code}: ${json.msg}`);
    }

    const result = json.data?.result;
    if (!result) continue;

    // job_status: 0=init, 1=processing, 2=success, 3=failed
    if (result.job_status === 3) {
      throw new Error(`Export task failed: ${result.job_error_msg ?? "unknown error"}`);
    }

    if (result.job_status === 2 && result.file_token) {
      return result.file_token;
    }

    // Still processing (0 or 1), continue polling
  }

  throw new Error(`Export task timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Step 3: Download the exported file bytes.
 */
async function downloadExportFile(
  ticket: string,
  accessToken: string,
  apiBase: string
): Promise<Buffer> {
  const url = `${apiBase}/open-apis/drive/v1/export_tasks/${encodeURIComponent(ticket)}/download`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Download export file HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Export a single document (docx or pdf) using the 3-step Drive Export API.
 * Returns the file bytes.
 */
async function exportSingleDoc(
  objToken: string,
  objType: "docx" | "doc",
  format: DocExportFormat,
  accessToken: string,
  apiBase: string
): Promise<Buffer> {
  // Step 1: Create task
  const ticket = await createExportTask(objToken, objType, format, accessToken, apiBase);

  // Step 2: Poll until done
  await pollExportTask(ticket, objToken, accessToken, apiBase);

  // Step 3: Download
  const fileBytes = await downloadExportFile(ticket, accessToken, apiBase);
  return fileBytes;
}

/** Build a ZIP buffer from an array of { path, content (Buffer) } */
function buildBinaryZip(files: Array<{ path: string; content: Buffer }>): Promise<Buffer> {
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

// ─── Background export runner ─────────────────────────────────────────────────

async function runDocExportJob(
  job: DocExportJob,
  nodes: Array<{ objToken: string; objType: string; title: string }>,
  accessToken: string,
  apiBase: string
) {
  // Use concurrency=2 to avoid overwhelming the export API
  // Each task takes ~2-10s to process, so 2 concurrent = ~4-20 tasks/10s = well under limits
  const CONCURRENCY = 2;
  const DELAY_BETWEEN_BATCHES_MS = 1000;

  const files: Array<{ path: string; content: Buffer }> = [];
  const titleCounts = new Map<string, number>();

  for (let i = 0; i < nodes.length; i += CONCURRENCY) {
    if (job.status === "failed") break;

    const batch = nodes.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (node) => {
        try {
          // Determine obj_type for export API: only "docx" and "doc" support docx/pdf export
          const exportType: "docx" | "doc" =
            node.objType === "doc" ? "doc" : "docx";

          const fileBytes = await exportSingleDoc(
            node.objToken,
            exportType,
            job.format,
            accessToken,
            apiBase
          );

          // Build a unique filename
          const baseName = sanitizeFilename(node.title || node.objToken);
          const count = titleCounts.get(baseName) ?? 0;
          titleCounts.set(baseName, count + 1);
          const uniqueName = count === 0 ? baseName : `${baseName}_${count}`;

          files.push({
            path: `${uniqueName}.${job.format}`,
            content: fileBytes,
          });

          job.done++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[DocExport] Failed to export ${node.objToken} (${node.title}): ${msg}`
          );
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

  // Build ZIP
  try {
    const zipBuffer = await buildBinaryZip(files);
    job.zipBuffer = zipBuffer;
    job.status = "done";
    console.log(
      `[DocExport] Job ${job.jobId} done: ${files.length} ${job.format} files, ` +
      `${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.errorMsg = `Failed to build ZIP: ${msg}`;
    console.error(`[DocExport] Job ${job.jobId} ZIP build failed: ${msg}`);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerWikiDocExportRoute(app: Express) {
  // ─── Start export job ─────────────────────────────────────────────────────

  app.post("/api/wiki/export-doc/start", async (req: Request, res: Response) => {
    const {
      sessionId: sessionIdStr,
      format,
      userAccessToken,
      appId,
      appSecret,
    } = req.body as Record<string, string>;

    const sessionId = parseInt(sessionIdStr ?? "");
    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    const exportFormat = format as DocExportFormat;
    if (exportFormat !== "docx" && exportFormat !== "pdf") {
      res.status(400).json({ error: "format must be 'docx' or 'pdf'" });
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
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    // Get all docx AND doc nodes from this session (both support docx/pdf export)
    const allNodes = await db
      .select()
      .from(crawlNodes)
      .where(
        and(
          eq(crawlNodes.sessionId, sessionId),
          inArray(crawlNodes.objType, ["docx", "doc"])
        )
      );

    if (allNodes.length === 0) {
      res.status(404).json({ error: "No exportable document nodes (docx/doc) found in this session" });
      return;
    }

    // Create job
    const jobId = generateJobId(exportFormat);
    const job: DocExportJob = {
      jobId,
      sessionId,
      format: exportFormat,
      status: "running",
      total: allNodes.length,
      done: 0,
      failed: 0,
      startedAt: Date.now(),
    };
    docExportJobs.set(jobId, job);

    // Map nodes to export format
    const exportNodes = allNodes
      .filter((n) => n.objToken != null)
      .map((n) => ({
        objToken: n.objToken as string,
        objType: n.objType ?? "docx",
        title: n.title ?? "Untitled",
      }));

    // Start background export
    runDocExportJob(job, exportNodes, accessToken, apiBase).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.errorMsg = msg;
      console.error(`[DocExport] Job ${jobId} crashed: ${msg}`);
    });

    res.json({
      jobId,
      total: allNodes.length,
      format: exportFormat,
      message: `Export started for ${allNodes.length} ${exportFormat} files`,
    });
  });

  // ─── Get export job status ────────────────────────────────────────────────

  app.get("/api/wiki/export-doc/status", (req: Request, res: Response) => {
    const { jobId } = req.query as Record<string, string>;

    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const job = docExportJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);
    const rate = elapsed > 0 ? (job.done / elapsed).toFixed(2) : "0";

    res.json({
      jobId: job.jobId,
      status: job.status,
      format: job.format,
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

  app.get("/api/wiki/export-doc/download", (req: Request, res: Response) => {
    const { jobId } = req.query as Record<string, string>;

    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const job = docExportJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: `Job ${jobId} not found` });
      return;
    }

    if (job.status !== "done" || !job.zipBuffer) {
      res.status(400).json({ error: "Export not complete yet" });
      return;
    }

    const filename = `wiki_${job.format}_${job.sessionId}_${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", job.zipBuffer.length);
    res.send(job.zipBuffer);
  });
}
