import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  parseFeishuWikiUrl,
  getTenantAccessToken,
  getWikiNodeInfo,
  fetchAllNodes,
  buildTree,
} from "./feishuApi";
import { scrapePublicWiki } from "./feishuScraper";

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
     * Crawl all nodes from a Feishu wiki space.
     * - With credentials (appId+appSecret or userToken): uses official Feishu API (full data)
     * - Without credentials: uses Puppeteer browser scraping (public wikis only, partial data)
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

        // Parse the URL
        const parsed = parseFeishuWikiUrl(url);
        if (!parsed.isValid) {
          throw new Error(
            "Invalid Feishu wiki URL. Please enter a valid URL like:\n" +
            "https://xxx.feishu.cn/wiki/TOKEN"
          );
        }

        const { domain, token } = parsed;

        // ── Mode 1: Official API with credentials ──────────────────────────
        const hasCredentials =
          (appId && appSecret) || userAccessToken;

        if (hasCredentials) {
          let accessToken: string;
          if (userAccessToken) {
            accessToken = userAccessToken;
          } else {
            accessToken = await getTenantAccessToken(appId!, appSecret!);
          }

          // Resolve space_id from the token
          let spaceId: string;
          let rootNodeToken: string | undefined;

          const nodeInfo = await getWikiNodeInfo(token, accessToken);
          if (nodeInfo) {
            spaceId = nodeInfo.space_id;
            rootNodeToken = nodeInfo.node_token;
          } else {
            spaceId = token;
          }

          const allNodes = await fetchAllNodes(
            spaceId,
            accessToken,
            domain,
            rootNodeToken,
            0
          );

          const tree = buildTree(allNodes);

          return {
            spaceId,
            domain,
            totalCount: allNodes.length,
            nodes: allNodes,
            tree,
            mode: "api" as const,
          };
        }

        // ── Mode 2: Public wiki scraping via Puppeteer ─────────────────────
        const scrapedNodes = await scrapePublicWiki(url, domain, token);

        if (scrapedNodes.length === 0) {
          throw new Error(
            "Could not extract any pages from this wiki.\n\n" +
            "This may be because:\n" +
            "• The wiki is private and requires authentication\n" +
            "• The wiki has no child pages\n" +
            "• The page took too long to load\n\n" +
            "For private wikis, please provide App ID + App Secret or a User Access Token."
          );
        }

        const tree = buildTree(scrapedNodes);

        return {
          spaceId: token,
          domain,
          totalCount: scrapedNodes.length,
          nodes: scrapedNodes,
          tree,
          mode: "scrape" as const,
        };
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
        const token = await getTenantAccessToken(appId, appSecret);
        return { success: true, tokenPreview: token.substring(0, 20) + "..." };
      }),
  }),
});

export type AppRouter = typeof appRouter;
