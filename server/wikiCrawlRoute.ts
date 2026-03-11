/**
 * Wiki Crawl API endpoints.
 *
 * Architecture: Background crawl + polling (no long-lived SSE)
 *
 * POST /api/wiki/crawl/start
 *   → Starts a new crawl session in background, returns { sessionId }
 *
 * POST /api/wiki/crawl/resume
 *   → Resumes a paused session in background, returns { sessionId }
 *
 * GET /api/wiki/crawl/status?sessionId=...
 *   → Returns current session status (JSON) — poll every 2s
 *
 * GET /api/wiki/crawl/nodes?sessionId=...
 *   → Returns all nodes for a completed session
 *
 * SSE (legacy, kept for compatibility):
 * GET /api/wiki/crawl-stream?url=...&token=...
 *   → Starts crawl and streams progress, but may timeout on long crawls
 */

import type { Express, Request, Response } from "express";
import {
  parseFeishuWikiUrl,
  getTenantAccessToken,
  getWikiNodeInfo,
  buildTree,
} from "./feishuApi";
import {
  createCrawlSession,
  runCrawlSession,
  getSession,
  getSessionNodes,
} from "./crawlEngine";

// ─── In-memory background job tracker ────────────────────────────────────────
// Tracks which sessions are currently running so we don't double-start them
const runningJobs = new Set<number>();

async function resolveAccessToken(
  userAccessToken?: string,
  appId?: string,
  appSecret?: string,
  apiBase = "https://open.feishu.cn"
): Promise<string> {
  if (userAccessToken && userAccessToken.trim().length > 0) {
    return userAccessToken.trim();
  }
  if (appId && appSecret) {
    return getTenantAccessToken(appId, appSecret, apiBase);
  }
  throw new Error("Authentication required. Please provide either App credentials or a User Access Token.");
}

async function resolveSpaceId(token: string, accessToken: string, apiBase = "https://open.feishu.cn"): Promise<string> {
  try {
    const nodeInfo = await getWikiNodeInfo(token, accessToken, apiBase);
    if (nodeInfo?.space_id) {
      console.log(`[Wiki] Resolved space_id=${nodeInfo.space_id} from node_token=${token}`);
      return nodeInfo.space_id;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("TOKEN_EXPIRED")) throw err;
    console.warn(`[Wiki] get_node failed: ${msg}. Trying token as space_id.`);
  }
  return token;
}

function startBackgroundCrawl(sessionId: number, accessToken: string) {
  if (runningJobs.has(sessionId)) {
    console.log(`[Wiki] Session ${sessionId} already running, skipping duplicate start`);
    return;
  }
  runningJobs.add(sessionId);
  runCrawlSession(sessionId, accessToken)
    .then(() => {
      console.log(`[Wiki] Session ${sessionId} completed`);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Wiki] Session ${sessionId} failed: ${msg}`);
    })
    .finally(() => {
      runningJobs.delete(sessionId);
    });
}

export function registerWikiCrawlRoute(app: Express) {
  // ─── Start new crawl (background) ────────────────────────────────────────

  app.post("/api/wiki/crawl/start", async (req: Request, res: Response) => {
    const { url, userAccessToken, appId, appSecret, crawlMode } = req.body as Record<string, string>;

    if (!url) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }

    const parsed = parseFeishuWikiUrl(url);
    if (!parsed.isValid) {
      res.status(400).json({ error: "Invalid Feishu/Lark wiki URL. Please enter a valid URL like: https://xxx.feishu.cn/wiki/TOKEN or https://xxx.larksuite.com/wiki/TOKEN" });
      return;
    }

    const { apiBase, platform } = parsed;
    console.log(`[Wiki] Platform detected: ${platform} (apiBase: ${apiBase})`);

    let accessToken: string;
    try {
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    let spaceId: string;
    try {
      spaceId = await resolveSpaceId(parsed.token, accessToken, apiBase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const tokenUrl = platform === 'lark'
        ? 'https://open.larksuite.com/api-explorer'
        : 'https://open.feishu.cn/api-explorer';
      if (msg.includes("TOKEN_EXPIRED")) {
        res.status(401).json({ error: `Your User Access Token has expired. Please get a new token from ${tokenUrl}` });
      } else {
        res.status(500).json({ error: `Failed to resolve wiki space: ${msg}` });
      }
      return;
    }

    // crawlMode='subtree' → only crawl children of the specific node in the URL
    // crawlMode='space' (default) → crawl entire wiki space from root
    const rootNodeToken = crawlMode === 'subtree' ? parsed.token : undefined;
    const sessionId = await createCrawlSession(spaceId, parsed.domain, rootNodeToken, apiBase);
    startBackgroundCrawl(sessionId, accessToken);

    res.json({ sessionId, spaceId, domain: parsed.domain, platform, rootNodeToken });
  });

  // ─── Resume paused session (background) ──────────────────────────────────

  app.post("/api/wiki/crawl/resume", async (req: Request, res: Response) => {
    const { sessionId: sessionIdStr, userAccessToken, appId, appSecret } = req.body as Record<string, string>;
    const sessionId = parseInt(sessionIdStr ?? "");

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    if (session.status === "done") {
      res.status(400).json({ error: "Session is already complete" });
      return;
    }

    if (runningJobs.has(sessionId)) {
      res.json({ sessionId, message: "Session is already running" });
      return;
    }

    let accessToken: string;
    try {
      accessToken = await resolveAccessToken(userAccessToken, appId, appSecret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(401).json({ error: msg });
      return;
    }

    startBackgroundCrawl(sessionId, accessToken);
    res.json({ sessionId, message: "Resumed" });
  });

  // ─── Get session status ───────────────────────────────────────────────────

  app.get("/api/wiki/crawl/status", async (req: Request, res: Response) => {
    const { sessionId: sessionIdStr } = req.query as Record<string, string>;
    const sessionId = parseInt(sessionIdStr ?? "");

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    res.json({
      sessionId: session.id,
      spaceId: session.spaceId,
      domain: session.domain,
      status: session.status,
      totalNodes: session.totalNodes,
      pendingQueue: session.pendingQueue,
      skippedNodes: session.skippedNodes,
      errorMsg: session.errorMsg,
      isRunning: runningJobs.has(session.id),
    });
  });

  // ─── Get nodes for completed session ─────────────────────────────────────

  app.get("/api/wiki/crawl/nodes", async (req: Request, res: Response) => {
    const { sessionId: sessionIdStr } = req.query as Record<string, string>;
    const sessionId = parseInt(sessionIdStr ?? "");

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ error: "Missing or invalid sessionId" });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    const nodes = await getSessionNodes(sessionId);
    const treeAvailable = nodes.length <= 5000;
    const tree = treeAvailable ? buildTree(nodes) : [];

    res.json({
      sessionId,
      spaceId: session.spaceId,
      domain: session.domain,
      status: session.status,
      totalCount: nodes.length,
      skipped: session.skippedNodes,
      nodes,
      tree,
      treeAvailable,
    });
  });

  // ─── Legacy SSE endpoint (kept for backward compat, but uses background crawl) ──

  app.get("/api/wiki/crawl-stream", async (req: Request, res: Response) => {
    const { url, userAccessToken, appId, appSecret } = req.query as Record<string, string>;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
    const sendEvent = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      if (!url) {
        sendEvent({ type: "error", message: "Missing url parameter" });
        return;
      }

      const parsed = parseFeishuWikiUrl(url);
      if (!parsed.isValid) {
        sendEvent({ type: "error", message: "Invalid Feishu wiki URL." });
        return;
      }

      sendEvent({ type: "progress", count: 0, pending: 0, message: "Authenticating..." });

      let accessToken: string;
      try {
        accessToken = await resolveAccessToken(userAccessToken, appId, appSecret);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent({ type: "error", message: msg });
        return;
      }

      let spaceId: string;
      try {
        spaceId = await resolveSpaceId(parsed.token, accessToken);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TOKEN_EXPIRED")) {
          sendEvent({ type: "error", message: "Your User Access Token has expired. Please get a new token from https://open.feishu.cn/api-explorer" });
        } else {
          sendEvent({ type: "error", message: `Failed to resolve wiki space: ${msg}` });
        }
        return;
      }

      // crawlMode='subtree' → only crawl children of the specific node in the URL
      const { crawlMode } = req.query as Record<string, string>;
      const rootNodeToken = crawlMode === 'subtree' ? parsed.token : undefined;
      const sessionId = await createCrawlSession(spaceId, parsed.domain, rootNodeToken);
      sendEvent({ type: "session", sessionId });
      sendEvent({ type: "progress", count: 0, pending: 1, message: "Starting background crawl..." });

      // Start background crawl
      startBackgroundCrawl(sessionId, accessToken);

      // Poll for progress and stream updates
      let lastCount = 0;
      let done = false;
      const pollInterval = setInterval(async () => {
        try {
          const session = await getSession(sessionId);
          if (!session) return;

          if (session.totalNodes !== lastCount) {
            lastCount = session.totalNodes;
            sendEvent({
              type: "progress",
              count: session.totalNodes,
              pending: session.pendingQueue,
              message: `Fetching nodes... ${session.totalNodes} found (${session.pendingQueue} pending)`,
            });
          }

          if (session.status === "done" || session.status === "failed" || session.status === "paused") {
            done = true;
            clearInterval(pollInterval);

            if (session.status === "done") {
              const nodes = await getSessionNodes(sessionId);
              const treeAvailable = nodes.length <= 5000;
              const tree = treeAvailable ? buildTree(nodes) : [];
              sendEvent({
                type: "done",
                sessionId,
                spaceId: session.spaceId,
                domain: session.domain,
                totalCount: nodes.length,
                skipped: session.skippedNodes,
                nodes,
                tree,
                treeAvailable,
              });
            } else if (session.status === "paused") {
              sendEvent({
                type: "paused",
                sessionId,
                totalCount: session.totalNodes,
                pending: session.pendingQueue,
                message: "Token expired mid-crawl. Get a new token and click Resume to continue.",
              });
            } else {
              sendEvent({ type: "error", message: session.errorMsg ?? "Crawl failed" });
            }

            res.end();
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Wiki] Poll error for session ${sessionId}: ${msg}`);
        }
      }, 2000);

      // Safety timeout: close SSE after 25 minutes, send paused state
      const safetyTimeout = setTimeout(async () => {
        if (!done) {
          clearInterval(pollInterval);
          const session = await getSession(sessionId);
          sendEvent({
            type: "paused",
            sessionId,
            totalCount: session?.totalNodes ?? 0,
            pending: session?.pendingQueue ?? 0,
            message: `Connection timeout after 25 minutes. The crawl is still running in background. Use session ID ${sessionId} to check status.`,
          });
          res.end();
        }
      }, 25 * 60 * 1000);

      // Cleanup on client disconnect
      req.on("close", () => {
        clearInterval(pollInterval);
        clearTimeout(safetyTimeout);
      });

      return; // Don't fall through to finally
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent({ type: "error", message: `Unexpected error: ${msg}` });
    } finally {
      clearInterval(keepAlive);
      // Note: res.end() is called by poll interval or safety timeout
    }
  });

  // ─── Resume via SSE (for UI resume button) ────────────────────────────────

  app.get("/api/wiki/crawl-resume", async (req: Request, res: Response) => {
    const { sessionId: sessionIdStr, userAccessToken, appId, appSecret } = req.query as Record<string, string>;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
    const sendEvent = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const sessionId = parseInt(sessionIdStr ?? "");
      if (!sessionId || isNaN(sessionId)) {
        sendEvent({ type: "error", message: "Missing or invalid sessionId" });
        clearInterval(keepAlive);
        res.end();
        return;
      }

      const session = await getSession(sessionId);
      if (!session) {
        sendEvent({ type: "error", message: `Session ${sessionId} not found` });
        clearInterval(keepAlive);
        res.end();
        return;
      }

      let accessToken: string;
      try {
        accessToken = await resolveAccessToken(userAccessToken, appId, appSecret);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent({ type: "error", message: msg });
        clearInterval(keepAlive);
        res.end();
        return;
      }

      sendEvent({
        type: "progress",
        count: session.totalNodes,
        pending: session.pendingQueue,
        message: `Resuming... ${session.totalNodes} nodes already found, ${session.pendingQueue} pending`,
      });

      startBackgroundCrawl(sessionId, accessToken);

      // Poll for progress
      let lastCount = session.totalNodes;
      let done = false;
      const pollInterval = setInterval(async () => {
        try {
          const updated = await getSession(sessionId);
          if (!updated) return;

          if (updated.totalNodes !== lastCount) {
            lastCount = updated.totalNodes;
            sendEvent({
              type: "progress",
              count: updated.totalNodes,
              pending: updated.pendingQueue,
              message: `Fetching nodes... ${updated.totalNodes} found (${updated.pendingQueue} pending)`,
            });
          }

          if (updated.status === "done" || updated.status === "failed" || updated.status === "paused") {
            done = true;
            clearInterval(pollInterval);

            if (updated.status === "done") {
              const nodes = await getSessionNodes(sessionId);
              const treeAvailable = nodes.length <= 5000;
              const tree = treeAvailable ? buildTree(nodes) : [];
              sendEvent({
                type: "done",
                sessionId,
                spaceId: updated.spaceId,
                domain: updated.domain,
                totalCount: nodes.length,
                skipped: updated.skippedNodes,
                nodes,
                tree,
                treeAvailable,
              });
            } else if (updated.status === "paused") {
              sendEvent({
                type: "paused",
                sessionId,
                totalCount: updated.totalNodes,
                pending: updated.pendingQueue,
                message: "Token expired again. Please get a new token and resume.",
              });
            } else {
              sendEvent({ type: "error", message: updated.errorMsg ?? "Crawl failed" });
            }

            clearInterval(keepAlive);
            res.end();
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Wiki] Resume poll error for session ${sessionId}: ${msg}`);
        }
      }, 2000);

      const safetyTimeout = setTimeout(async () => {
        if (!done) {
          clearInterval(pollInterval);
          const updated = await getSession(sessionId);
          sendEvent({
            type: "paused",
            sessionId,
            totalCount: updated?.totalNodes ?? 0,
            pending: updated?.pendingQueue ?? 0,
            message: `Connection timeout. Crawl still running in background. Session ID: ${sessionId}`,
          });
          clearInterval(keepAlive);
          res.end();
        }
      }, 25 * 60 * 1000);

      req.on("close", () => {
        clearInterval(pollInterval);
        clearTimeout(safetyTimeout);
        clearInterval(keepAlive);
      });

      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent({ type: "error", message: `Unexpected error: ${msg}` });
      clearInterval(keepAlive);
      res.end();
    }
  });
}
