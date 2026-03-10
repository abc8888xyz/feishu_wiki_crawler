import { useState } from "react";
import { ChevronRight, ChevronDown, FileText, BookOpen, Table2, Brain, File, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WikiNode {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  parent_node_token: string;
  node_type: string;
  origin_node_token: string;
  origin_space_id: string;
  has_child: boolean;
  title: string;
  obj_create_time: string;
  obj_edit_time: string;
  node_create_time: string;
  creator: string;
  owner: string;
  depth?: number;
  url?: string;
  children?: WikiNode[];
}

const typeIconMap: Record<string, React.ReactNode> = {
  doc: <FileText className="w-3.5 h-3.5 text-blue-500" />,
  docx: <FileText className="w-3.5 h-3.5 text-blue-500" />,
  wiki: <BookOpen className="w-3.5 h-3.5 text-purple-500" />,
  sheet: <Table2 className="w-3.5 h-3.5 text-green-500" />,
  bitable: <Table2 className="w-3.5 h-3.5 text-orange-500" />,
  mindnote: <Brain className="w-3.5 h-3.5 text-pink-500" />,
  file: <File className="w-3.5 h-3.5 text-gray-500" />,
};

const typeColorMap: Record<string, string> = {
  doc: "text-blue-600 dark:text-blue-400",
  docx: "text-blue-600 dark:text-blue-400",
  wiki: "text-purple-600 dark:text-purple-400",
  sheet: "text-green-600 dark:text-green-400",
  bitable: "text-orange-600 dark:text-orange-400",
  mindnote: "text-pink-600 dark:text-pink-400",
  file: "text-gray-600 dark:text-gray-400",
};

interface TreeNodeProps {
  node: WikiNode;
  depth?: number;
  searchQuery?: string;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function TreeNode({ node, depth = 0, searchQuery = "" }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const icon = typeIconMap[node.obj_type] ?? typeIconMap.doc;

  const matchesSearch = !searchQuery ||
    node.title.toLowerCase().includes(searchQuery.toLowerCase());

  const childrenMatchSearch = searchQuery
    ? (node.children ?? []).some(child =>
        child.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (child.children ?? []).some(gc => gc.title.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : true;

  if (searchQuery && !matchesSearch && !childrenMatchSearch) return null;

  return (
    <div className="tree-node-enter">
      <div
        className={cn(
          "group flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer",
          "hover:bg-accent/60 transition-colors duration-100",
          matchesSearch && searchQuery ? "bg-yellow-50/50 dark:bg-yellow-900/10" : ""
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
      >
        {/* Toggle arrow */}
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 h-3.5" />
          )}
        </span>

        {/* Node icon */}
        <span className="flex-shrink-0">{icon}</span>

        {/* Title */}
        <span
          className={cn(
            "text-sm truncate flex-1",
            typeColorMap[node.obj_type] ?? "text-foreground"
          )}
          title={node.title}
        >
          {highlightText(node.title || "(Untitled)", searchQuery)}
        </span>

        {/* External link */}
        {node.url && (
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent transition-all"
            title="Open in Feishu"
          >
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
        )}

        {/* Children count badge */}
        {hasChildren && (
          <span className="flex-shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {node.children!.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isOpen && (
        <div>
          {node.children!.map(child => (
            <TreeNode
              key={child.node_token}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface WikiTreeViewProps {
  tree: WikiNode[];
  searchQuery?: string;
}

export function WikiTreeView({ tree, searchQuery = "" }: WikiTreeViewProps) {
  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BookOpen className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">No nodes found</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map(node => (
        <TreeNode key={node.node_token} node={node} depth={0} searchQuery={searchQuery} />
      ))}
    </div>
  );
}
