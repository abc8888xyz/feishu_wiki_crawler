import { describe, expect, it } from "vitest";
import {
  parseFeishuWikiUrl,
  buildNodeUrl,
  buildTree,
  type FeishuNode,
} from "./feishuApi";

// ─── parseFeishuWikiUrl ───────────────────────────────────────────────────────
describe("parseFeishuWikiUrl", () => {
  it("parses a standard feishu.cn wiki URL", () => {
    const result = parseFeishuWikiUrl("https://waytoagi.feishu.cn/wiki/CCR4wl3upi6dF9kVE5YcAcGcnlU");
    expect(result.isValid).toBe(true);
    expect(result.token).toBe("CCR4wl3upi6dF9kVE5YcAcGcnlU");
    expect(result.domain).toBe("https://waytoagi.feishu.cn");
  });

  it("parses a larksuite.com wiki URL", () => {
    const result = parseFeishuWikiUrl("https://company.larksuite.com/wiki/AbCdEfGhIjKlMnOp");
    expect(result.isValid).toBe(true);
    expect(result.token).toBe("AbCdEfGhIjKlMnOp");
    expect(result.domain).toBe("https://company.larksuite.com");
  });

  it("returns invalid for non-feishu URLs", () => {
    const result = parseFeishuWikiUrl("https://google.com/wiki/something");
    expect(result.isValid).toBe(false);
  });

  it("returns invalid for malformed URLs", () => {
    const result = parseFeishuWikiUrl("not-a-url");
    expect(result.isValid).toBe(false);
  });

  it("returns invalid for feishu URL without /wiki/ path", () => {
    const result = parseFeishuWikiUrl("https://company.feishu.cn/docs/something");
    expect(result.isValid).toBe(false);
  });

  it("handles URLs with trailing slashes", () => {
    const result = parseFeishuWikiUrl("https://company.feishu.cn/wiki/TOKEN123/");
    expect(result.isValid).toBe(true);
    expect(result.token).toBe("TOKEN123");
  });
});

// ─── buildNodeUrl ─────────────────────────────────────────────────────────────
describe("buildNodeUrl", () => {
  const baseNode: FeishuNode = {
    space_id: "space1",
    node_token: "nodeToken1",
    obj_token: "objToken1",
    obj_type: "doc",
    parent_node_token: "",
    node_type: "origin",
    origin_node_token: "nodeToken1",
    origin_space_id: "space1",
    has_child: false,
    title: "Test Doc",
    obj_create_time: "1642402428",
    obj_edit_time: "1642402428",
    node_create_time: "1642402428",
    creator: "user1",
    owner: "user1",
  };

  it("builds URL for doc type", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "doc" });
    expect(url).toBe("https://company.feishu.cn/docs/objToken1");
  });

  it("builds URL for docx type", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "docx" });
    expect(url).toBe("https://company.feishu.cn/docx/objToken1");
  });

  it("builds URL for wiki type using node_token", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "wiki" });
    expect(url).toBe("https://company.feishu.cn/wiki/nodeToken1");
  });

  it("builds URL for sheet type", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "sheet" });
    expect(url).toBe("https://company.feishu.cn/sheets/objToken1");
  });

  it("builds URL for bitable type", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "bitable" });
    expect(url).toBe("https://company.feishu.cn/base/objToken1");
  });

  it("falls back to wiki path for unknown types", () => {
    const url = buildNodeUrl("https://company.feishu.cn", { ...baseNode, obj_type: "unknown" });
    expect(url).toBe("https://company.feishu.cn/wiki/objToken1");
  });
});

// ─── buildTree ────────────────────────────────────────────────────────────────
describe("buildTree", () => {
  const makeNode = (token: string, parentToken: string, title: string): FeishuNode => ({
    space_id: "space1",
    node_token: token,
    obj_token: `obj_${token}`,
    obj_type: "doc",
    parent_node_token: parentToken,
    node_type: "origin",
    origin_node_token: token,
    origin_space_id: "space1",
    has_child: false,
    title,
    obj_create_time: "1642402428",
    obj_edit_time: "1642402428",
    node_create_time: "1642402428",
    creator: "user1",
    owner: "user1",
  });

  it("builds a flat list into a tree", () => {
    const nodes = [
      makeNode("root1", "", "Root 1"),
      makeNode("child1", "root1", "Child 1"),
      makeNode("child2", "root1", "Child 2"),
      makeNode("grandchild1", "child1", "Grandchild 1"),
    ];

    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Root 1");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children![0].title).toBe("Child 1");
    expect(tree[0].children![0].children).toHaveLength(1);
    expect(tree[0].children![0].children![0].title).toBe("Grandchild 1");
  });

  it("handles multiple root nodes", () => {
    const nodes = [
      makeNode("root1", "", "Root 1"),
      makeNode("root2", "", "Root 2"),
      makeNode("child1", "root1", "Child 1"),
    ];

    const tree = buildTree(nodes);
    expect(tree).toHaveLength(2);
  });

  it("handles empty input", () => {
    const tree = buildTree([]);
    expect(tree).toHaveLength(0);
  });

  it("handles orphaned nodes (parent not in list) as roots", () => {
    const nodes = [
      makeNode("node1", "nonexistent_parent", "Orphan"),
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Orphan");
  });
});
