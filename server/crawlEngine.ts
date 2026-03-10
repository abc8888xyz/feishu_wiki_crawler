/**
 * Persistent Crawl Engine
 *
 * Design goals:
 * 1. Zero node loss — every "fetch children" task is persisted in DB before execution.
 *    If the process crashes or token expires, the queue survives and can be resumed.
 * 2. Rate-limit safe — when Feishu returns 99991400 (frequency limit), the task is
 *    re-queued with exponential backoff instead of being skipped.
 * 3. Token-expiry resume — caller can call resumeSession(sessionId, newToken) to
 *    continue from exactly where it stopped.
 * 4. Real-time SSE progress — callers receive live node counts via onProgress callback.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { crawlSessions, crawlQueue, crawlNodes, type CrawlSession } from "../drizzle/schema";
import {
  fetchAllAtLevel,
  buildNodeUrl,
  type FeishuNode,
} from "./feishuApi";

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many queue items to process in parallel per batch */
const BATCH_SIZE = 5;

/** Max retries for rate-limit errors before giving up on a queue item */
const MAX_RATE_LIMIT_RETRIES = 8;

/** Base delay for rate-limit backoff (doubles each retry) */
const RATE_LIMIT_BASE_DELAY_MS = 3000;

/** Feishu rate-limit error code */
const RATE_LIMIT_CODE = 99991400;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlProgress {
  sessionId: number;
  totalNodes: number;
  pendingQueue: number;
  status: "running" | "paused" | "done" | "failed";
  message?: string;
}

export type ProgressCallback = (progress: CrawlProgress) => void;

// ─── Session management ───────────────────────────────────────────────────────

/** Create a new crawl session and seed the initial queue item (root fetch) */
export async function createCrawlSession(
  spaceId: string,
  domain: string,
  rootNodeToken?: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db
    .insert(crawlSessions)
    .values({ spaceId, domain, status: "running", totalNodes: 0, pendingQueue: 1, skippedNodes: 0 });

  const sessionId = (result as { insertId: number }).insertId;

  // Seed the root queue item
  await db.insert(crawlQueue).values({
    sessionId,
    parentToken: rootNodeToken ?? null,
    fetchSpaceId: spaceId,
    depth: 0,
    status: "pending",
    retryCount: 0,
  });

  return sessionId;
}

/** Get session info */
export async function getSession(sessionId: number): Promise<CrawlSession | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(crawlSessions)
    .where(eq(crawlSessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Get all nodes for a session as FeishuNode array */
export async function getSessionNodes(sessionId: number): Promise<FeishuNode[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(crawlNodes)
    .where(eq(crawlNodes.sessionId, sessionId));

  return rows.map((r) => ({
    space_id: r.originSpaceId ?? "",
    node_token: r.nodeToken,
    obj_token: r.objToken ?? "",
    obj_type: (r.objType ?? "docx") as FeishuNode["obj_type"],
    parent_node_token: r.parentNodeToken ?? "",
    node_type: (r.nodeType ?? "origin") as FeishuNode["node_type"],
    origin_node_token: r.originNodeToken ?? r.nodeToken,
    origin_space_id: r.originSpaceId ?? "",
    has_child: r.hasChild === 1,
    title: r.title ?? "",
    obj_create_time: String(r.objCreateTime ?? 0),
    obj_edit_time: String(r.objEditTime ?? 0),
    node_create_time: String(r.objCreateTime ?? 0),
    creator: "",
    owner: "",
    depth: r.depth,
    url: r.url ?? "",
  }));
}

// ─── Core crawl loop ──────────────────────────────────────────────────────────

/**
 * Run or resume a crawl session.
 *
 * This function processes the persistent queue in batches.
 * - Rate-limit errors: re-queue with backoff, NEVER skip.
 * - Token-expiry errors: pause session, throw so caller can surface the error.
 * - Other permanent errors: mark queue item as failed (counted in skippedNodes).
 */
export async function runCrawlSession(
  sessionId: number,
  accessToken: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Mark as running
  await db
    .update(crawlSessions)
    .set({ status: "running", errorMsg: null })
    .where(eq(crawlSessions.id, sessionId));

  const { spaceId, domain } = session;

  try {
    while (true) {
      // Fetch next batch of pending queue items
      const batch = await db
        .select()
        .from(crawlQueue)
        .where(and(eq(crawlQueue.sessionId, sessionId), eq(crawlQueue.status, "pending")))
        .limit(BATCH_SIZE);

      if (batch.length === 0) break; // Queue empty — done!

      // Process batch in parallel
      await Promise.all(
        batch.map((item) =>
          processQueueItem(item, accessToken, sessionId, spaceId, domain, onProgress)
        )
      );

      // Emit progress
      const statsRows = await db
        .select({
          totalNodes: crawlSessions.totalNodes,
          pendingQueue: crawlSessions.pendingQueue,
        })
        .from(crawlSessions)
        .where(eq(crawlSessions.id, sessionId))
        .limit(1);

      const stats = statsRows[0];
      onProgress?.({
        sessionId,
        totalNodes: stats?.totalNodes ?? 0,
        pendingQueue: stats?.pendingQueue ?? 0,
        status: "running",
      });
    }

    // All done
    await db
      .update(crawlSessions)
      .set({ status: "done", pendingQueue: 0 })
      .where(eq(crawlSessions.id, sessionId));

    const finalRows = await db
      .select({ totalNodes: crawlSessions.totalNodes, skippedNodes: crawlSessions.skippedNodes })
      .from(crawlSessions)
      .where(eq(crawlSessions.id, sessionId))
      .limit(1);

    const final = finalRows[0];
    console.log(`[CrawlEngine] Session ${sessionId} done: ${final?.totalNodes ?? 0} nodes, ${final?.skippedNodes ?? 0} permanently failed`);

    onProgress?.({
      sessionId,
      totalNodes: final?.totalNodes ?? 0,
      pendingQueue: 0,
      status: "done",
      message: `Crawl complete: ${final?.totalNodes ?? 0} nodes`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPaused = msg.includes("TOKEN_EXPIRED");

    await db
      .update(crawlSessions)
      .set({ status: isPaused ? "paused" : "failed", errorMsg: msg })
      .where(eq(crawlSessions.id, sessionId));

    const statsRows = await db
      .select({ totalNodes: crawlSessions.totalNodes, pendingQueue: crawlSessions.pendingQueue })
      .from(crawlSessions)
      .where(eq(crawlSessions.id, sessionId))
      .limit(1);

    const stats = statsRows[0];
    onProgress?.({
      sessionId,
      totalNodes: stats?.totalNodes ?? 0,
      pendingQueue: stats?.pendingQueue ?? 0,
      status: isPaused ? "paused" : "failed",
      message: msg,
    });

    throw err;
  }
}

// ─── Queue item processor ─────────────────────────────────────────────────────

type QueueItem = typeof crawlQueue.$inferSelect;

async function processQueueItem(
  item: QueueItem,
  accessToken: string,
  sessionId: number,
  _spaceId: string,
  domain: string,
  _onProgress?: ProgressCallback
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const items = await fetchAllAtLevel(item.fetchSpaceId, accessToken, item.parentToken ?? undefined);

    // Persist all discovered nodes
    if (items.length > 0) {
      const nodeRows = items.map((node: FeishuNode) => ({
        sessionId,
        nodeToken: node.node_token,
        objToken: node.obj_token,
        objType: node.obj_type,
        nodeType: node.node_type,
        originNodeToken: node.origin_node_token,
        originSpaceId: node.origin_space_id,
        parentNodeToken: node.parent_node_token || null,
        title: node.title,
        url: buildNodeUrl(domain, node),
        depth: item.depth,
        hasChild: node.has_child ? 1 : 0,
        objCreateTime: node.obj_create_time ? parseInt(node.obj_create_time) : null,
        objEditTime: node.obj_edit_time ? parseInt(node.obj_edit_time) : null,
      }));

      // Insert nodes (ignore duplicates from retries)
      await db.insert(crawlNodes).ignore().values(nodeRows);

      // Enqueue children for nodes that have them
      const childItems = items.filter((n: FeishuNode) => n.has_child);
      if (childItems.length > 0) {
        const queueRows = childItems.map((node: FeishuNode) => {
          const isShortcut = node.node_type === "shortcut";
          return {
            sessionId,
            parentToken: isShortcut ? node.origin_node_token : node.node_token,
            fetchSpaceId: isShortcut && node.origin_space_id ? node.origin_space_id : item.fetchSpaceId,
            depth: item.depth + 1,
            status: "pending" as const,
            retryCount: 0,
          };
        });
        await db.insert(crawlQueue).values(queueRows);
      }

      // Update session counters atomically
      await db
        .update(crawlSessions)
        .set({
          totalNodes: sql`totalNodes + ${items.length}`,
          pendingQueue: sql`pendingQueue + ${childItems.length} - 1`,
        })
        .where(eq(crawlSessions.id, sessionId));
    } else {
      // No items returned — just decrement pending
      await db
        .update(crawlSessions)
        .set({ pendingQueue: sql`GREATEST(pendingQueue - 1, 0)` })
        .where(eq(crawlSessions.id, sessionId));
    }

    // Mark queue item as done
    await db
      .update(crawlQueue)
      .set({ status: "done" })
      .where(eq(crawlQueue.id, item.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Token expired — abort entire crawl
    if (msg.includes("TOKEN_EXPIRED")) throw err;

    // Rate limit — re-queue with backoff delay (NEVER skip)
    const isRateLimit =
      msg.includes("frequency limit") ||
      msg.includes("rate limit") ||
      msg.includes(`code=${RATE_LIMIT_CODE}`);

    if (isRateLimit && item.retryCount < MAX_RATE_LIMIT_RETRIES) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, item.retryCount);
      console.warn(
        `[CrawlEngine] Rate limit on parentToken=${item.parentToken ?? "root"}, ` +
          `retry ${item.retryCount + 1}/${MAX_RATE_LIMIT_RETRIES} after ${delay}ms`
      );
      await new Promise((r: (v: void) => void) => setTimeout(r, delay));

      // Put back as pending with incremented retry count (status stays 'pending')
      await db
        .update(crawlQueue)
        .set({ retryCount: item.retryCount + 1, errorMsg: msg })
        .where(eq(crawlQueue.id, item.id));
      return;
    }

    // Permanent failure — mark as failed, decrement pending
    console.error(
      `[CrawlEngine] Permanently failed parentToken=${item.parentToken ?? "root"}: ${msg}`
    );
    await db
      .update(crawlQueue)
      .set({ status: "failed", errorMsg: msg })
      .where(eq(crawlQueue.id, item.id));

    await db
      .update(crawlSessions)
      .set({
        pendingQueue: sql`GREATEST(pendingQueue - 1, 0)`,
        skippedNodes: sql`skippedNodes + 1`,
      })
      .where(eq(crawlSessions.id, sessionId));
  }
}
