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
     * Crawl all nodes from a Feishu wiki space using the official Feishu API.
     * Requires either App ID + App Secret or a User Access Token.
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

        // Parse the URL first
        const parsed = parseFeishuWikiUrl(url);
        if (!parsed.isValid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid Feishu wiki URL. Please enter a valid URL like:\n" +
              "https://xxx.feishu.cn/wiki/TOKEN\n" +
              "https://xxx.larksuite.com/wiki/TOKEN",
          });
        }

        const { domain, token } = parsed;

        // Validate credentials are provided
        const hasAppCreds = appId && appSecret;
        const hasUserToken = userAccessToken && userAccessToken.trim().length > 0;

        if (!hasAppCreds && !hasUserToken) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "Feishu Wiki API requires authentication.\n\n" +
              "How to get credentials:\n\n" +
              "Option A — App Credentials (recommended for full access):\n" +
              "  1. Visit https://open.feishu.cn/app → Create new app\n" +
              "  2. Permissions & Scopes → enable: wiki:wiki:readonly\n" +
              "  3. Publish the app version\n" +
              "  4. Enter App ID + App Secret in the form\n\n" +
              "Option B — User Access Token (quick test):\n" +
              "  1. Visit https://open.feishu.cn/api-explorer\n" +
              "  2. Log in → copy the User Access Token shown\n" +
              "  3. Paste it in the User Access Token field",
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
        let spaceId: string;
        let rootNodeToken: string | undefined;

        try {
          const nodeInfo = await getWikiNodeInfo(token, accessToken);
          if (nodeInfo) {
            spaceId = nodeInfo.space_id;
            rootNodeToken = nodeInfo.node_token;
          } else {
            // token might already be a space_id
            spaceId = token;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `Could not access wiki node: ${msg}\n\n` +
              "Make sure your app has the 'wiki:wiki:readonly' permission and has been added to the wiki space.",
          });
        }

        // Fetch all nodes recursively
        let allNodes;
        try {
          allNodes = await fetchAllNodes(
            spaceId,
            accessToken,
            domain,
            rootNodeToken,
            0
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
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

        const tree = buildTree(allNodes);

        return {
          spaceId,
          domain,
          totalCount: allNodes.length,
          nodes: allNodes,
          tree,
          mode: "api" as const,
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
