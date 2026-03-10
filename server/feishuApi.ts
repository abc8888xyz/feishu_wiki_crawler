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
    params.set("page_size", "50");
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
      const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
      const code = body?.code ?? 0;
      if (TOKEN_ERROR_CODES.has(code)) {
        throw new Error(`TOKEN_EXPIRED: Access token is invalid or expired. Please get a new User Access Token.`);
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
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
 * Fetch ALL nodes using concurrent BFS (Breadth-First Search).
 * Instead of sequential recursion, we process each level in parallel
 * using p-limit to avoid rate limiting.
 *
 * This is ~5-10x faster than sequential recursion for large wikis.
 */
export async function fetchAllNodes(
  spaceId: string,
  accessToken: string,
  domain: string,
  rootNodeToken?: string,
  _depth: number = 0,
  onProgress?: (count: number) => void
): Promise<FeishuNode[]> {
  // Concurrency: max 5 parallel requests to avoid rate limiting
  const limit = pLimit(5);
  const allNodes: FeishuNode[] = [];

  // BFS queue: each entry is { parentToken, depth }
  type QueueEntry = { parentToken: string | undefined; depth: number };
  let currentLevel: QueueEntry[] = [{ parentToken: rootNodeToken, depth: 0 }];

  while (currentLevel.length > 0) {
    // Fetch all nodes at current level in parallel, with per-node error handling
    const levelResults = await Promise.all(
      currentLevel.map(({ parentToken, depth }) =>
        limit(async () => {
          try {
            const items = await fetchAllAtLevel(spaceId, accessToken, parentToken);
            return items.map((node) => ({
              ...node,
              depth,
              url: buildNodeUrl(domain, node),
            }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // Propagate token expiry errors immediately
            if (msg.includes('TOKEN_EXPIRED')) throw err;
            // For 400/403 errors on specific nodes, skip and continue
            // This handles shortcut nodes, external links, or restricted nodes
            console.warn(`[Wiki] Skipping node (parentToken=${parentToken ?? 'root'}): ${msg}`);
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

        // Queue children for next level
        if (node.has_child) {
          nextLevel.push({ parentToken: node.node_token, depth: (node.depth ?? 0) + 1 });
        }
      }
    }

    currentLevel = nextLevel;
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
