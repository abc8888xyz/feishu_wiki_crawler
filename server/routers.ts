import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  parseFeishuWikiUrl,
  getTenantAccessToken,
  getWikiNodeInfo,
  fetchAllNodes,
  buildTree,
} from "./feishuApi";
import { getDb } from "./db";
import { crawlSessions, crawlNodes, crawlQueue } from "../drizzle/schema";
import { desc, eq, and } from "drizzle-orm";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  wiki: router({
    /**
     * Parse a Feishu wiki URL and return the extracted token
     */
    parseUrl: publicProcedure
      .input(z.object({ url: z.string() }))
      .query(({ input }) => {
        const result = parseFeishuWikiUrl(input.url);
        return result;
      }),

    /**
     * Crawl all nodes from a Feishu wiki space using concurrent BFS.
     * Optimized for large wikis (10,000+ nodes).
     */
    crawl: publicProcedure
      .input(
        z.object({
          url: z.string(),
          appId: z.string().optional(),
          appSecret: z.string().optional(),
          userAccessToken: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { url, appId, appSecret, userAccessToken } = input;

        const parsed = parseFeishuWikiUrl(url);
        if (!parsed.isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid Feishu wiki URL. Please enter a valid URL like:\n" +
              "https://xxx.feishu.cn/wiki/TOKEN",
          });
        }

        const { domain, token } = parsed;

        const hasAppCreds = appId && appSecret;
        const hasUserToken = userAccessToken && userAccessToken.trim().length > 0;

        if (!hasAppCreds && !hasUserToken) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "Authentication required. Please provide either:\n" +
              "1. Feishu App ID + App Secret (for app-level access)\n" +
              "2. User Access Token (for user-level access)\n\n" +
              "For public wikis like waytoagi.feishu.cn, you still need app credentials to use the API.",
          });
        }

        // Get access token
        let accessToken: string;
        try {
          if (hasUserToken) {
            accessToken = userAccessToken!.trim();
          } else {
            accessToken = await getTenantAccessToken(appId!, appSecret!);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: `Failed to authenticate with Feishu: ${msg}`,
          });
        }

        // Resolve space_id from the token
        // The URL token is always a node_token (not space_id).
        // We call get_node to resolve the space_id, then crawl the ENTIRE space from root.
        let spaceId: string;

        try {
          const nodeInfo = await getWikiNodeInfo(token, accessToken);
          if (nodeInfo && nodeInfo.space_id) {
            // Got space_id from node info — crawl entire space from root
            spaceId = nodeInfo.space_id;
          } else {
            // Fallback: treat token as space_id directly
            spaceId = token;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("TOKEN_EXPIRED")) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "Your User Access Token has expired (tokens expire after 2 hours).\n\n" +
                "Please get a new token:\n" +
                "1. Go to https://open.feishu.cn/api-explorer\n" +
                "2. Log in and click 'Get Token'\n" +
                "3. Copy the new User Access Token and paste it here",
            });
          }
          // If get_node fails (e.g. permission), try using token as space_id
          console.warn(`[Wiki] get_node failed for token ${token}: ${msg}. Trying as space_id.`);
          spaceId = token;
        }

        // Fetch ALL nodes from root of the space (no rootNodeToken = start from space root)
        let allNodes;
        try {
          allNodes = await fetchAllNodes(
            spaceId,
            accessToken,
            domain,
            undefined, // always start from root of space
            0
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("TOKEN_EXPIRED")) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "Your User Access Token has expired (tokens expire after 2 hours).\n\n" +
                "Please get a new token:\n" +
                "1. Go to https://open.feishu.cn/api-explorer\n" +
                "2. Log in and click 'Get Token'\n" +
                "3. Copy the new User Access Token and paste it here",
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to fetch wiki nodes: ${msg}`,
          });
        }

        if (allNodes.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "No pages found in this wiki space.\n\n" +
              "This could mean:\n" +
              "• The wiki space is empty\n" +
              "• Your app doesn't have permission to view the pages\n" +
              "• The wiki token in the URL is incorrect",
          });
        }

        // Only build tree for reasonable sizes to avoid memory issues
        const tree = allNodes.length <= 5000 ? buildTree(allNodes) : [];

        return {
          spaceId,
          domain,
          totalCount: allNodes.length,
          nodes: allNodes,
          tree,
          treeAvailable: allNodes.length <= 5000,
          mode: "api" as const,
        };
      }),

    /**
     * List all crawl sessions (history)
     */
    listSessions: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(crawlSessions)
        .orderBy(desc(crawlSessions.createdAt))
        .limit(100);
      return rows;
    }),

    /**
     * Get nodes for a specific session (for re-viewing history)
     */
    getSessionNodes: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
        const session = await db
          .select()
          .from(crawlSessions)
          .where(eq(crawlSessions.id, input.sessionId))
          .limit(1);
        if (!session.length) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        const nodes = await db
          .select()
          .from(crawlNodes)
          .where(eq(crawlNodes.sessionId, input.sessionId))
          .limit(20000);
        return { session: session[0], nodes };
      }),

    /**
     * Delete a session and all its nodes/queue items
     */
    deleteSession: publicProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
        await db.delete(crawlNodes).where(eq(crawlNodes.sessionId, input.sessionId));
        await db.delete(crawlQueue).where(eq(crawlQueue.sessionId, input.sessionId));
        await db.delete(crawlSessions).where(eq(crawlSessions.id, input.sessionId));
        return { success: true };
      }),

    /**
     * Test connection with provided credentials
     */
    testAuth: publicProcedure
      .input(
        z.object({
          appId: z.string(),
          appSecret: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const { appId, appSecret } = input;
        try {
          const token = await getTenantAccessToken(appId, appSecret);
          return { success: true, tokenPreview: token.substring(0, 20) + "..." };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: `Authentication failed: ${msg}`,
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
