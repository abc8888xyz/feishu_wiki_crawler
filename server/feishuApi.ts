/**
 * Feishu Wiki API helper
 * Handles authentication and API calls to Feishu Open Platform
 */

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
 * Parse Feishu wiki URL to extract space_id and node_token
 * Supported formats:
 * - https://xxx.feishu.cn/wiki/SPACE_ID_OR_NODE_TOKEN
 * - https://xxx.larksuite.com/wiki/SPACE_ID_OR_NODE_TOKEN
 */
export function parseFeishuWikiUrl(url: string): {
  domain: string;
  token: string;
  isValid: boolean;
} {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    
    // Validate it's a Feishu/Lark domain
    const isFeishu = hostname.includes("feishu.cn") || hostname.includes("larksuite.com");
    if (!isFeishu) {
      return { domain: "", token: "", isValid: false };
    }

    // Extract the token from path: /wiki/{token}
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
  const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}&obj_type=wiki`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (data.code !== 0) {
    // Try without obj_type
    const url2 = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`;
    const response2 = await fetch(url2, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const data2 = await response2.json();
    if (data2.code !== 0) return null;
    return data2.data?.node ?? null;
  }
  return data.data?.node ?? null;
}

/**
 * Fetch child nodes for a given space and parent node
 */
export async function fetchChildNodes(
  spaceId: string,
  accessToken: string,
  parentNodeToken?: string,
  pageToken?: string
): Promise<FeishuApiResponse> {
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
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const data: FeishuApiResponse = await response.json();
  return data;
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
  
  // For wiki nodes, use node_token; for other types, use obj_token
  if (node.obj_type === "wiki") {
    return `${domain}/wiki/${node.node_token}`;
  }
  return `${domain}/${path}/${node.obj_token}`;
}

/**
 * Recursively fetch ALL nodes in a wiki space
 * Returns a flat list with depth information
 */
export async function fetchAllNodes(
  spaceId: string,
  accessToken: string,
  domain: string,
  parentNodeToken?: string,
  depth: number = 0,
  onProgress?: (count: number) => void
): Promise<FeishuNode[]> {
  const allNodes: FeishuNode[] = [];
  let pageToken: string | undefined;

  // Paginate through all nodes at this level
  do {
    const response = await fetchChildNodes(spaceId, accessToken, parentNodeToken, pageToken);

    if (response.code !== 0) {
      throw new Error(`Feishu API error ${response.code}: ${response.msg}`);
    }

    const items = response.data?.items ?? [];

    for (const node of items) {
      const enrichedNode: FeishuNode = {
        ...node,
        depth,
        url: buildNodeUrl(domain, node),
      };
      allNodes.push(enrichedNode);
      onProgress?.(allNodes.length);

      // Recursively fetch children if this node has children
      if (node.has_child) {
        const children = await fetchAllNodes(
          spaceId,
          accessToken,
          domain,
          node.node_token,
          depth + 1,
          onProgress
        );
        allNodes.push(...children);
      }
    }

    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);

  return allNodes;
}

/**
 * Build tree structure from flat node list
 */
export function buildTree(nodes: FeishuNode[]): FeishuNode[] {
  const nodeMap = new Map<string, FeishuNode>();
  const roots: FeishuNode[] = [];

  // Initialize all nodes with empty children arrays
  for (const node of nodes) {
    nodeMap.set(node.node_token, { ...node, children: [] });
  }

  // Build tree
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
