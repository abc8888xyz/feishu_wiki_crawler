import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  FileText,
  BookOpen,
  Table2,
  Brain,
  File,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WikiNode } from "./WikiTreeView";

type SortField = "title" | "obj_type" | "depth" | "obj_create_time" | "obj_edit_time";
type SortDir = "asc" | "desc";

const typeIconMap: Record<string, React.ReactNode> = {
  doc: <FileText className="w-3.5 h-3.5" />,
  docx: <FileText className="w-3.5 h-3.5" />,
  wiki: <BookOpen className="w-3.5 h-3.5" />,
  sheet: <Table2 className="w-3.5 h-3.5" />,
  bitable: <Table2 className="w-3.5 h-3.5" />,
  mindnote: <Brain className="w-3.5 h-3.5" />,
  file: <File className="w-3.5 h-3.5" />,
};

const typeBadgeMap: Record<string, string> = {
  doc: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  docx: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  wiki: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  sheet: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  bitable: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  mindnote: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  file: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function formatTimestamp(ts: string): string {
  if (!ts) return "-";
  const num = parseInt(ts, 10);
  if (isNaN(num)) return ts;
  return new Date(num * 1000).toLocaleDateString("vi-VN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0.5">{part}</mark>
      ) : part
    );
  } catch {
    return text;
  }
}

interface SortHeaderProps {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
  style?: React.CSSProperties;
}

function SortHeader({ label, field, currentField, currentDir, onSort, style }: SortHeaderProps) {
  const isActive = currentField === field;
  return (
    <div
      className="px-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      style={style}
      onClick={() => onSort(field)}
    >
      {label}
      {isActive ? (
        currentDir === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-primary" /> : <ChevronDown className="w-3.5 h-3.5 text-primary" />
      ) : (
        <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
      )}
    </div>
  );
}

const COL = { title: 360, type: 100, depth: 64, created: 100, updated: 100, link: 64 };
const ROW_HEIGHT = 38;
const OVERSCAN = 5; // extra rows above/below viewport

// ─── Virtual Scroll Hook ──────────────────────────────────────────────────────
function useVirtualScroll(itemCount: number, itemHeight: number, containerHeight: number) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + OVERSCAN * 2;
  const endIndex = Math.min(itemCount - 1, startIndex + visibleCount);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const scrollToTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, []);

  return {
    scrollRef,
    startIndex,
    endIndex,
    totalHeight: itemCount * itemHeight,
    offsetY: startIndex * itemHeight,
    onScroll,
    scrollToTop,
  };
}

interface WikiTableProps {
  nodes: WikiNode[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

const TABLE_HEIGHT = 520;

export function WikiTable({ nodes, searchQuery, onSearchChange }: WikiTableProps) {
  const [sortField, setSortField] = useState<SortField>("depth");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const filtered = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return nodes;
    const q = trimmed.toLowerCase();
    return nodes.filter(n =>
      n.title?.toLowerCase().includes(q) ||
      n.obj_type?.toLowerCase().includes(q) ||
      n.url?.toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
      else if (sortField === "obj_type") cmp = (a.obj_type ?? "").localeCompare(b.obj_type ?? "");
      else if (sortField === "depth") cmp = (a.depth ?? 0) - (b.depth ?? 0);
      else if (sortField === "obj_create_time") cmp = parseInt(a.obj_create_time ?? "0") - parseInt(b.obj_create_time ?? "0");
      else if (sortField === "obj_edit_time") cmp = parseInt(a.obj_edit_time ?? "0") - parseInt(b.obj_edit_time ?? "0");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const trimmedSearch = searchQuery.trim();

  const { scrollRef, startIndex, endIndex, totalHeight, offsetY, onScroll, scrollToTop } = useVirtualScroll(
    sorted.length,
    ROW_HEIGHT,
    TABLE_HEIGHT
  );

  // Reset scroll on search/sort change
  useEffect(() => { scrollToTop(); }, [searchQuery, sortField, sortDir, scrollToTop]);

  const visibleRows = sorted.slice(startIndex, endIndex + 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
            placeholder="Search by title, type, or URL..."
            value={trimmedSearch}
            onChange={e => onSearchChange(e.target.value)}
            className="h-8 text-sm pl-8"
          />
          {searchQuery && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => onSearchChange("")}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {filtered.length.toLocaleString()} / {nodes.length.toLocaleString()} results
        </span>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-hidden">
        {/* Sticky Header */}
        <div className="flex items-center bg-muted/80 border-b border-border" style={{ height: ROW_HEIGHT }}>
          <SortHeader label="Title" field="title" currentField={sortField} currentDir={sortDir} onSort={handleSort} style={{ width: COL.title, minWidth: COL.title }} />
          <SortHeader label="Type" field="obj_type" currentField={sortField} currentDir={sortDir} onSort={handleSort} style={{ width: COL.type, minWidth: COL.type }} />
          <SortHeader label="Depth" field="depth" currentField={sortField} currentDir={sortDir} onSort={handleSort} style={{ width: COL.depth, minWidth: COL.depth }} />
          <SortHeader label="Created" field="obj_create_time" currentField={sortField} currentDir={sortDir} onSort={handleSort} style={{ width: COL.created, minWidth: COL.created }} />
          <SortHeader label="Updated" field="obj_edit_time" currentField={sortField} currentDir={sortDir} onSort={handleSort} style={{ width: COL.updated, minWidth: COL.updated }} />
          <div className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" style={{ width: COL.link, minWidth: COL.link }}>Link</div>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{ height: TABLE_HEIGHT, overflowY: "auto", overflowX: "auto", position: "relative" }}
        >
          {sorted.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No results found</div>
          ) : (
            /* Total height spacer + positioned rows */
            <div style={{ height: totalHeight, position: "relative" }}>
              <div style={{ transform: `translateY(${offsetY}px)` }}>
                {visibleRows.map((node, i) => {
                  const actualIndex = startIndex + i;
                  const isEven = actualIndex % 2 === 0;
                  return (
                    <div
                      key={node.node_token || actualIndex}
                      className={cn(
                        "flex items-center border-b border-border/50 hover:bg-accent/40 transition-colors",
                        isEven ? "bg-background" : "bg-muted/20"
                      )}
                      style={{ height: ROW_HEIGHT }}
                    >
                      {/* Title */}
                      <div className="px-3 flex items-center gap-1.5 overflow-hidden" style={{ width: COL.title, minWidth: COL.title }}>
                        <span className="inline-block w-0.5 h-4 bg-border/60 flex-shrink-0 rounded" style={{ marginLeft: `${(node.depth ?? 0) * 10}px` }} />
                        <span className="truncate font-medium text-foreground text-xs" title={node.title}>
                          {trimmedSearch ? highlightText(node.title || "(Untitled)", trimmedSearch) : (node.title || "(Untitled)")}
                        </span>
                      </div>
                      {/* Type */}
                      <div className="px-3 flex items-center" style={{ width: COL.type, minWidth: COL.type }}>
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", typeBadgeMap[node.obj_type] ?? typeBadgeMap.file)}>
                          {typeIconMap[node.obj_type] ?? typeIconMap.file}
                          {node.obj_type}
                        </span>
                      </div>
                      {/* Depth */}
                      <div className="px-3 flex items-center justify-center" style={{ width: COL.depth, minWidth: COL.depth }}>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">L{node.depth ?? 0}</span>
                      </div>
                      {/* Created */}
                      <div className="px-3 text-xs text-muted-foreground" style={{ width: COL.created, minWidth: COL.created }}>
                        {formatTimestamp(node.obj_create_time)}
                      </div>
                      {/* Updated */}
                      <div className="px-3 text-xs text-muted-foreground" style={{ width: COL.updated, minWidth: COL.updated }}>
                        {formatTimestamp(node.obj_edit_time)}
                      </div>
                      {/* Link */}
                      <div className="px-3 flex items-center" style={{ width: COL.link, minWidth: COL.link }}>
                        {node.url ? (
                          <a href={node.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                            <ExternalLink className="w-3 h-3" />Open
                          </a>
                        ) : <span className="text-muted-foreground text-xs">-</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{sorted.length.toLocaleString()} rows {searchQuery ? `(filtered from ${nodes.length.toLocaleString()})` : ""}</span>
        <span>Virtual scroll — renders only visible rows for performance</span>
      </div>
    </div>
  );
}
