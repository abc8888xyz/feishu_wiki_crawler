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
  type FeishuNode,
} from "./feishuApi";

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
     * Crawl all nodes from a Feishu wiki space
     * Supports both public (with app credentials) and private (with user token) wikis
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
          throw new Error("Invalid Feishu wiki URL. Please enter a valid URL like https://xxx.feishu.cn/wiki/TOKEN");
        }

        const { domain, token } = parsed;

        // Determine access token
        let accessToken: string;
        if (userAccessToken) {
          accessToken = userAccessToken;
        } else if (appId && appSecret) {
          accessToken = await getTenantAccessToken(appId, appSecret);
        } else {
          // Try with a demo/public approach - some wikis are publicly accessible
          // We'll attempt without auth first, and if it fails, ask for credentials
          throw new Error(
            "Authentication required. Please provide either:\n" +
            "1. Feishu App ID + App Secret (for app-level access)\n" +
            "2. User Access Token (for user-level access)\n\n" +
            "For public wikis like waytoagi.feishu.cn, you still need app credentials to use the API."
          );
        }

        // Resolve space_id from the token
        // The token in the URL could be a space_id or a node_token
        let spaceId: string;
        let rootNodeToken: string | undefined;

        // Try to get node info to resolve space_id
        const nodeInfo = await getWikiNodeInfo(token, accessToken);
        if (nodeInfo) {
          spaceId = nodeInfo.space_id;
          // If the token is a specific node (not root), set it as parent
          rootNodeToken = nodeInfo.node_token;
        } else {
          // Assume the token is the space_id itself
          spaceId = token;
        }

        // Fetch all nodes recursively
        const allNodes = await fetchAllNodes(
          spaceId,
          accessToken,
          domain,
          rootNodeToken,
          0
        );

        // Build tree structure
        const tree = buildTree(allNodes);

        return {
          spaceId,
          domain,
          totalCount: allNodes.length,
          nodes: allNodes,
          tree,
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
