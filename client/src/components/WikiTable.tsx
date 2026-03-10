import { useState, useMemo } from "react";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

interface SortHeaderProps {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}

function SortHeader({ label, field, currentField, currentDir, onSort, className }: SortHeaderProps) {
  const isActive = currentField === field;
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none",
        "hover:text-foreground transition-colors",
        className
      )}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === "asc" ? (
            <ChevronUp className="w-3.5 h-3.5 text-primary" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-primary" />
          )
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
        )}
      </div>
    </th>
  );
}

interface WikiTableProps {
  nodes: WikiNode[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

const PAGE_SIZE = 50;

export function WikiTable({ nodes, searchQuery, onSearchChange }: WikiTableProps) {
  const [sortField, setSortField] = useState<SortField>("depth");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  const filtered = useMemo(() => {
    if (!searchQuery) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      n =>
        n.title?.toLowerCase().includes(q) ||
        n.obj_type?.toLowerCase().includes(q) ||
        n.url?.toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") {
        cmp = (a.title ?? "").localeCompare(b.title ?? "");
      } else if (sortField === "obj_type") {
        cmp = (a.obj_type ?? "").localeCompare(b.obj_type ?? "");
      } else if (sortField === "depth") {
        cmp = (a.depth ?? 0) - (b.depth ?? 0);
      } else if (sortField === "obj_create_time") {
        cmp = parseInt(a.obj_create_time ?? "0") - parseInt(b.obj_create_time ?? "0");
      } else if (sortField === "obj_edit_time") {
        cmp = parseInt(a.obj_edit_time ?? "0") - parseInt(b.obj_edit_time ?? "0");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function highlightText(text: string): React.ReactNode {
    if (!searchQuery) return text;
    const parts = text.split(new RegExp(`(${searchQuery})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by title, type, or URL..."
          value={searchQuery}
          onChange={e => {
            onSearchChange(e.target.value);
            setPage(1);
          }}
          className="h-8 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => onSearchChange("")}
          >
            Clear
          </Button>
        )}
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} / {nodes.length} results
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
            <tr className="border-b border-border">
              <SortHeader label="Title" field="title" currentField={sortField} currentDir={sortDir} onSort={handleSort} className="min-w-[200px]" />
              <SortHeader label="Type" field="obj_type" currentField={sortField} currentDir={sortDir} onSort={handleSort} className="w-24" />
              <SortHeader label="Depth" field="depth" currentField={sortField} currentDir={sortDir} onSort={handleSort} className="w-16" />
              <SortHeader label="Created" field="obj_create_time" currentField={sortField} currentDir={sortDir} onSort={handleSort} className="w-28" />
              <SortHeader label="Updated" field="obj_edit_time" currentField={sortField} currentDir={sortDir} onSort={handleSort} className="w-28" />
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-16">Link</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">
                  No results found
                </td>
              </tr>
            ) : (
              paginated.map((node, idx) => (
                <tr
                  key={node.node_token}
                  className={cn(
                    "border-b border-border/50 hover:bg-accent/40 transition-colors",
                    idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                  )}
                >
                  {/* Title */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-px bg-border flex-shrink-0"
                        style={{ height: "16px", marginLeft: `${(node.depth ?? 0) * 12}px` }}
                      />
                      <span className="truncate max-w-[300px] font-medium text-foreground" title={node.title}>
                        {highlightText(node.title || "(Untitled)")}
                      </span>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
                        typeBadgeMap[node.obj_type] ?? typeBadgeMap.file
                      )}
                    >
                      {typeIconMap[node.obj_type] ?? typeIconMap.file}
                      {node.obj_type}
                    </span>
                  </td>

                  {/* Depth */}
                  <td className="px-3 py-2 text-center">
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      L{node.depth ?? 0}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatTimestamp(node.obj_create_time)}
                  </td>

                  {/* Updated */}
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatTimestamp(node.obj_edit_time)}
                  </td>

                  {/* Link */}
                  <td className="px-3 py-2">
                    {node.url ? (
                      <a
                        href={node.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Prev
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const p = i + 1;
              return (
                <Button
                  key={p}
                  variant={page === p ? "default" : "outline"}
                  size="sm"
                  className="h-7 w-7 p-0 text-xs"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              );
            })}
            {totalPages > 7 && <span>...</span>}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
