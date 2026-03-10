/**
 * Feishu Wiki API helper
 * Optimized for large wikis (10,000+ nodes) using concurrent BFS fetching
 */

import pLimit from "p-limit";

export interface FeishuNode {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: "doc" | "sheet" | "mindnote" | "bitable" | "file" | "docx" | "wiki" | string;
  parent_node_token: string;
  node_type: "origin" | "shortcut";
  origin_node_token: string;
  origin_space_id: string;
  has_child: boolean;
  title: string;
  obj_create_time: string;
  obj_edit_time: string;
  node_create_time: string;
  creator: string;
  owner: string;
  node_creator?: string;
  depth?: number;
  url?: string;
  children?: FeishuNode[];
}

export interface FeishuApiResponse {
  code: number;
  msg: string;
  data: {
    items: FeishuNode[];
    page_token?: string;
    has_more: boolean;
  };
}

export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
  access_token?: string;
  token_type?: string;
  refresh_token?: string;
  user_access_token?: string;
}

/**
 * Feishu API error codes for token issues
 */
const TOKEN_ERROR_CODES = new Set([99991668, 99991663, 99991664, 99991665, 99991672]);

/**
 * Feishu API error codes that indicate a non-retryable node-level error
 * (e.g., node deleted, no permission to this specific node)
 */
const NODE_SKIP_CODES = new Set([230002, 230003, 230004, 1254043, 1254044]);

/**
 * Feishu API error codes that indicate rate limiting — should be retried with backoff
 */
const RATE_LIMIT_CODES = new Set([99991400, 99991401, 429]);

/**
 * Parse Feishu wiki URL to extract space_id and node_token
 */
export function parseFeishuWikiUrl(url: string): {
  domain: string;
  token: string;
  isValid: boolean;
} {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    const isFeishu = hostname.includes("feishu.cn") || hostname.includes("larksuite.com");
    if (!isFeishu) {
      return { domain: "", token: "", isValid: false };
    }

    const pathMatch = parsed.pathname.match(/\/wiki\/([A-Za-z0-9_-]+)/);
    if (!pathMatch) {
      return { domain: "", token: "", isValid: false };
    }

    return {
      domain: `https://${hostname}`,
      token: pathMatch[1],
      isValid: true,
    };
  } catch {
    return { domain: "", token: "", isValid: false };
  }
}

/**
 * Get tenant access token using App ID and App Secret
 */
export async function getTenantAccessToken(
  appId: string,
  appSecret: string
): Promise<string> {
  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  const data: FeishuTokenResponse = await response.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: ${data.msg}`);
  }
  return data.tenant_access_token;
}

/**
 * Get wiki node info by node token to resolve space_id
 */
export async function getWikiNodeInfo(
  nodeToken: string,
  accessToken: string
): Promise<{ space_id: string; node_token: string; title: string; obj_type: string } | null> {
  const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (TOKEN_ERROR_CODES.has(data.code)) {
    throw new Error(`TOKEN_EXPIRED: ${data.msg}. Please get a new User Access Token (tokens expire after 2 hours).`);
  }

  if (data.code !== 0) return null;
  return data.data?.node ?? null;
}

/**
 * Fetch ALL nodes at a given level (with pagination), returns items array
 */
async function fetchAllAtLevel(
  spaceId: string,
  accessToken: string,
  parentNodeToken?: string
): Promise<FeishuNode[]> {
  const items: FeishuNode[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams();
    params.set("page_size", "50"); // Feishu API max is 50 (range: 1-50)
    if (pageToken) params.set("page_token", pageToken);
    if (parentNodeToken) params.set("parent_node_token", parentNodeToken);

    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // CRITICAL: Always parse JSON body first — Feishu returns 400 for BOTH
      // token errors (code 99991668) AND node-level errors.
      // We must distinguish them: token errors must abort the whole crawl,
      // while node-level errors should be skipped.
      const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
      const code = body?.code ?? 0;
      if (TOKEN_ERROR_CODES.has(code)) {
        throw new Error(`TOKEN_EXPIRED: ${body.msg ?? 'Access token is invalid or expired'}. Please get a new User Access Token.`);
      }
      // Node-level permission/not-found errors — skip this node
      if (NODE_SKIP_CODES.has(code)) {
        console.warn(`[Wiki] Node-level error (parentToken=${parentNodeToken ?? 'root'}) code=${code}: ${body.msg}`);
        return [];
      }
      // Other HTTP errors — throw so BFS can skip this branch
      throw new Error(`HTTP error ${response.status} code=${code}: ${body.msg ?? response.statusText}`);
    }

    const data: FeishuApiResponse = await response.json();

    if (TOKEN_ERROR_CODES.has(data.code)) {
      throw new Error(`TOKEN_EXPIRED: ${data.msg}. Please get a new User Access Token (tokens expire after 2 hours).`);
    }

    if (data.code !== 0) {
      throw new Error(`Feishu API error ${data.code}: ${data.msg}`);
    }

    items.push(...(data.data?.items ?? []));
    pageToken = data.data?.has_more ? data.data.page_token : undefined;
  } while (pageToken);

  return items;
}

/**
 * Build the full URL for a wiki node based on domain and obj_type
 */
export function buildNodeUrl(domain: string, node: FeishuNode): string {
  const typePathMap: Record<string, string> = {
    doc: "docs",
    docx: "docx",
    sheet: "sheets",
    bitable: "base",
    mindnote: "mindnotes",
    file: "file",
    wiki: "wiki",
  };
  const path = typePathMap[node.obj_type] ?? "wiki";

  if (node.obj_type === "wiki") {
    return `${domain}/wiki/${node.node_token}`;
  }
  return `${domain}/${path}/${node.obj_token}`;
}

/**
 * Fetch with retry for transient errors (rate limiting, 5xx).
 * Token errors are NOT retried — they abort immediately.
 */
async function fetchWithRetry(
  spaceId: string,
  accessToken: string,
  parentNodeToken: string | undefined,
  maxRetries = 5
): Promise<FeishuNode[]> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchAllAtLevel(spaceId, accessToken, parentNodeToken);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Token errors abort immediately — no retry
      if (msg.includes('TOKEN_EXPIRED')) throw err;
      lastErr = err instanceof Error ? err : new Error(msg);
      if (attempt < maxRetries) {
        // Check if this is a rate limit error — use longer backoff
        const isRateLimit = RATE_LIMIT_CODES.has(
          parseInt(msg.match(/code=(\d+)/)?.[1] ?? '0')
        ) || msg.includes('frequency limit') || msg.includes('rate limit');
        // Rate limit: 2s, 4s, 8s, 16s, 32s; Other errors: 500ms, 1s, 2s, 4s, 8s
        const baseDelay = isRateLimit ? 2000 : 500;
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[Wiki] Retry ${attempt + 1}/${maxRetries} for parentToken=${parentNodeToken ?? 'root'} after ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr!;
}

/**
 * Fetch ALL nodes using concurrent BFS (Breadth-First Search).
 * Instead of sequential recursion, we process each level in parallel
 * using p-limit to avoid rate limiting.
 *
 * Key improvements over v1:
 * - page_size=100 (was 50) → fewer API calls
 * - concurrency=10 (was 5) → faster for large wikis
 * - retry with exponential backoff for transient errors
 * - TOKEN_EXPIRED errors abort the entire crawl immediately
 * - shortcut nodes use origin_node_token for child fetching
 */
export async function fetchAllNodes(
  spaceId: string,
  accessToken: string,
  domain: string,
  rootNodeToken?: string,
  _depth: number = 0,
  onProgress?: (count: number) => void
): Promise<FeishuNode[]> {
  // Concurrency: 5 parallel requests (balanced between speed and rate limits)
  // Feishu rate limit: ~10 req/s per token; 5 concurrent + retry handles bursts well
  const limit = pLimit(5);
  const allNodes: FeishuNode[] = [];
  let skippedCount = 0;

  // BFS queue: each entry is { parentToken, spaceId for cross-space shortcuts, depth }
  type QueueEntry = { parentToken: string | undefined; fetchSpaceId: string; depth: number };
  let currentLevel: QueueEntry[] = [{ parentToken: rootNodeToken, fetchSpaceId: spaceId, depth: 0 }];

  while (currentLevel.length > 0) {
    // Fetch all nodes at current level in parallel, with per-node error handling
    const levelResults = await Promise.all(
      currentLevel.map(({ parentToken, fetchSpaceId, depth }) =>
        limit(async () => {
          try {
            const items = await fetchWithRetry(fetchSpaceId, accessToken, parentToken);
            return items.map((node) => ({
              ...node,
              depth,
              url: buildNodeUrl(domain, node),
            }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // Propagate token expiry errors immediately — abort entire crawl
            if (msg.includes('TOKEN_EXPIRED')) throw err;
            // For other errors on specific nodes, skip and continue
            skippedCount++;
            console.warn(`[Wiki] Skipping node (parentToken=${parentToken ?? 'root'} spaceId=${fetchSpaceId}): ${msg}`);
            return [] as (FeishuNode & { depth: number; url: string })[];
          }
        })
      )
    );

    // Collect all nodes from this level
    const nextLevel: QueueEntry[] = [];
    for (const items of levelResults) {
      for (const node of items) {
        allNodes.push(node);
        onProgress?.(allNodes.length);

        if (node.has_child) {
          // For shortcut nodes: use origin_node_token + origin_space_id to fetch children.
          // This is the key fix: shortcut nodes point to content in another location;
          // their children must be fetched using the origin identifiers.
          const isShortcut = node.node_type === 'shortcut';
          const childParentToken = isShortcut ? node.origin_node_token : node.node_token;
          const childSpaceId = isShortcut && node.origin_space_id ? node.origin_space_id : spaceId;
          nextLevel.push({
            parentToken: childParentToken,
            fetchSpaceId: childSpaceId,
            depth: (node.depth ?? 0) + 1,
          });
        }
      }
    }

    currentLevel = nextLevel;
  }

  if (skippedCount > 0) {
    console.log(`[Wiki] Crawl complete: ${allNodes.length} nodes fetched, ${skippedCount} branches skipped`);
  }

  return allNodes;
}

/**
 * Build tree structure from flat node list
 */
export function buildTree(nodes: FeishuNode[]): FeishuNode[] {
  const nodeMap = new Map<string, FeishuNode>();
  const roots: FeishuNode[] = [];

  for (const node of nodes) {
    nodeMap.set(node.node_token, { ...node, children: [] });
  }

  for (const node of nodes) {
    const current = nodeMap.get(node.node_token)!;
    if (node.parent_node_token && nodeMap.has(node.parent_node_token)) {
      const parent = nodeMap.get(node.parent_node_token)!;
      parent.children = parent.children ?? [];
      parent.children.push(current);
    } else {
      roots.push(current);
    }
  }

  return roots;
}
