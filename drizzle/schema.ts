import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, bigint, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Crawl sessions — one per crawl job.
 * status: 'running' | 'paused' | 'done' | 'failed'
 * paused = token expired or rate-limited mid-crawl; can be resumed with new token
 */
export const crawlSessions = mysqlTable("crawl_sessions", {
  id: int("id").autoincrement().primaryKey(),
  spaceId: varchar("spaceId", { length: 64 }).notNull(),
  domain: varchar("domain", { length: 256 }).notNull(),
  status: mysqlEnum("status", ["running", "paused", "done", "failed"]).default("running").notNull(),
  totalNodes: int("totalNodes").default(0).notNull(),
  pendingQueue: int("pendingQueue").default(0).notNull(),
  skippedNodes: int("skippedNodes").default(0).notNull(),
  errorMsg: text("errorMsg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CrawlSession = typeof crawlSessions.$inferSelect;

/**
 * Crawl queue — persistent BFS queue.
 * Each row = one "fetch children of parentToken" task.
 * status: 'pending' | 'done' | 'failed'
 */
export const crawlQueue = mysqlTable("crawl_queue", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  parentToken: varchar("parentToken", { length: 64 }),   // null = root
  fetchSpaceId: varchar("fetchSpaceId", { length: 64 }).notNull(),
  depth: int("depth").default(0).notNull(),
  status: mysqlEnum("status", ["pending", "done", "failed"]).default("pending").notNull(),
  retryCount: int("retryCount").default(0).notNull(),
  errorMsg: text("errorMsg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CrawlQueueItem = typeof crawlQueue.$inferSelect;

/**
 * Crawl nodes — all discovered nodes for a session.
 */
export const crawlNodes = mysqlTable("crawl_nodes", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  nodeToken: varchar("nodeToken", { length: 64 }).notNull(),
  objToken: varchar("objToken", { length: 64 }),
  objType: varchar("objType", { length: 32 }),
  nodeType: varchar("nodeType", { length: 32 }),
  originNodeToken: varchar("originNodeToken", { length: 64 }),
  originSpaceId: varchar("originSpaceId", { length: 64 }),
  parentNodeToken: varchar("parentNodeToken", { length: 64 }),
  title: text("title"),
  url: text("url"),
  depth: int("depth").default(0).notNull(),
  hasChild: int("hasChild").default(0).notNull(),   // 0/1 boolean
  objCreateTime: bigint("objCreateTime", { mode: "number" }),
  objEditTime: bigint("objEditTime", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CrawlNode = typeof crawlNodes.$inferSelect;
