import { useState, useEffect } from "react";
import {
  History,
  Trash2,
  Eye,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PauseCircle,
  Clock,
  Database,
  Globe,
  FileDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    done: {
      label: "Done",
      className: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    running: {
      label: "Running",
      className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400",
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    paused: {
      label: "Paused",
      className: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400",
      icon: <PauseCircle className="w-3 h-3" />,
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400",
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };
  const c = config[status] ?? config.failed;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", c.className)}>
      {c.icon}
      {c.label}
    </span>
  );
}

// ─── Format date ──────────────────────────────────────────────────────────────
function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Session Row ──────────────────────────────────────────────────────────────
interface SessionRowProps {
  session: {
    id: number;
    spaceId: string;
    domain: string;
    status: string;
    totalNodes: number;
    pendingQueue: number;
    skippedNodes: number;
    errorMsg: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  onView: (id: number) => void;
  onDelete: (id: number) => void;
  onExportMd: (id: number) => void;
  isDeleting: boolean;
  isLoadingNodes: boolean;
  mdExportState: { status: string; jobId: string | null; progress: { done: number; total: number } };
}

function SessionRow({ session, onView, onDelete, onExportMd, isDeleting, isLoadingNodes, mdExportState }: SessionRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
        {/* Expand toggle */}
        <button
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {/* Session info */}
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate">{session.domain}</span>
              <span className="text-xs text-muted-foreground font-mono hidden sm:inline truncate max-w-[120px]">
                {session.spaceId}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{formatDate(session.createdAt)}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">ID: {session.id}</span>
            </div>
          </div>

          {/* Node count */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Database className="w-3.5 h-3.5" />
            <span className="font-medium text-foreground">{session.totalNodes.toLocaleString()}</span>
            <span>nodes</span>
          </div>

          {/* Status */}
          <StatusBadge status={session.status} />

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => onView(session.id)}
              disabled={isLoadingNodes}
              title="Xem lại kết quả crawl"
            >
              {isLoadingNodes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              Xem
            </Button>

            {/* Export MD */}
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 gap-1 text-xs",
                mdExportState.status === "running"
                  ? "border-violet-300 text-violet-700"
                  : mdExportState.status === "done"
                  ? "border-green-300 text-green-700"
                  : "border-violet-300 text-violet-700 hover:bg-violet-50"
              )}
              onClick={() => onExportMd(session.id)}
              disabled={mdExportState.status === "running"}
              title="Export Markdown ZIP"
            >
              {mdExportState.status === "running" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {mdExportState.progress.done}/{mdExportState.progress.total}
                </>
              ) : mdExportState.status === "done" ? (
                <>
                  <Download className="w-3 h-3" /> MD ✓
                </>
              ) : (
                <>
                  <FileDown className="w-3 h-3" /> MD
                </>
              )}
            </Button>

            {/* Delete */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
              onClick={() => onDelete(session.id)}
              disabled={isDeleting}
              title="Xóa session này"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 bg-muted/20 border-t border-border text-xs space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-muted-foreground mb-0.5">Space ID</p>
              <code className="font-mono text-foreground bg-muted px-1 rounded">{session.spaceId}</code>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Tổng nodes</p>
              <p className="font-medium text-foreground">{session.totalNodes.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Pending queue</p>
              <p className="font-medium text-foreground">{session.pendingQueue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Bỏ qua</p>
              <p className="font-medium text-foreground">{session.skippedNodes.toLocaleString()}</p>
            </div>
          </div>
          {session.errorMsg && (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              <p className="text-red-600 dark:text-red-400 font-medium mb-0.5">Lỗi:</p>
              <p className="text-red-600 dark:text-red-400">{session.errorMsg}</p>
            </div>
          )}
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>Tạo: {formatDate(session.createdAt)}</span>
            <span>·</span>
            <span>Cập nhật: {formatDate(session.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────
interface HistoryPanelProps {
  onLoadSession: (sessionId: number, domain: string, nodes: unknown[], spaceId: string) => void;
}

export function HistoryPanel({ onLoadSession }: HistoryPanelProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // MD export state per session
  const [mdExportStates, setMdExportStates] = useState<
    Record<number, { status: "idle" | "running" | "done" | "failed"; jobId: string | null; progress: { done: number; total: number } }>
  >({});

  const { data: sessions, isLoading, error, refetch } = trpc.wiki.listSessions.useQuery(undefined, {
    refetchInterval: 10000, // auto-refresh every 10s
  });

  const getSessionNodesMutation = trpc.wiki.getSessionNodes.useQuery(
    { sessionId: loadingSessionId! },
    { enabled: loadingSessionId !== null }
  );

  const deleteSessionMutation = trpc.wiki.deleteSession.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa session thành công");
      refetch();
      setDeleteConfirmId(null);
    },
    onError: (err) => {
      toast.error(`Xóa thất bại: ${err.message}`);
    },
  });

  // Handle view session
  const handleView = async (sessionId: number) => {
    setLoadingSessionId(sessionId);
  };

  // When nodes are loaded, pass to parent — must be in useEffect to avoid setState-in-render
  useEffect(() => {
    if (loadingSessionId !== null && getSessionNodesMutation.data && !getSessionNodesMutation.isLoading) {
      const { session, nodes } = getSessionNodesMutation.data;
      const wikiNodes = nodes.map(n => ({
        node_token: n.nodeToken,
        obj_token: n.objToken ?? "",
        obj_type: n.objType ?? "docx",
        node_type: n.nodeType ?? "",
        origin_node_token: n.originNodeToken ?? "",
        origin_space_id: n.originSpaceId ?? "",
        parent_node_token: n.parentNodeToken ?? "",
        title: n.title ?? "Untitled",
        url: n.url ?? "",
        depth: n.depth,
        has_children: n.hasChild === 1,
        obj_create_time: n.objCreateTime ? String(n.objCreateTime) : undefined,
        obj_edit_time: n.objEditTime ? String(n.objEditTime) : undefined,
      }));
      onLoadSession(loadingSessionId, session.domain, wikiNodes, session.spaceId);
      setLoadingSessionId(null);
    }
  }, [loadingSessionId, getSessionNodesMutation.data, getSessionNodesMutation.isLoading, onLoadSession]);

  // Handle export MD from history
  const handleExportMd = async (sessionId: number) => {
    setMdExportStates(prev => ({
      ...prev,
      [sessionId]: { status: "running", jobId: null, progress: { done: 0, total: 0 } },
    }));

    try {
      const startRes = await fetch("/api/wiki/export/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: String(sessionId) }),
      });
      const startData = await startRes.json() as { jobId?: string; total?: number; error?: string };
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error ?? "Failed to start export");
      }

      const jobId = startData.jobId;
      setMdExportStates(prev => ({
        ...prev,
        [sessionId]: { status: "running", jobId, progress: { done: 0, total: startData.total ?? 0 } },
      }));

      // Poll
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/wiki/export/status?jobId=${encodeURIComponent(jobId)}`);
          const statusData = await statusRes.json() as {
            status: string; done: number; total: number; failed: number; hasZip?: boolean; errorMsg?: string;
          };
          setMdExportStates(prev => ({
            ...prev,
            [sessionId]: { ...prev[sessionId], progress: { done: statusData.done, total: statusData.total } },
          }));

          if (statusData.status === "done" && statusData.hasZip) {
            clearInterval(poll);
            setMdExportStates(prev => ({ ...prev, [sessionId]: { ...prev[sessionId], status: "done" } }));
            const a = document.createElement("a");
            a.href = `/api/wiki/export/download?jobId=${encodeURIComponent(jobId)}`;
            a.click();
            toast.success("Đã tải xuống Markdown ZIP");
          } else if (statusData.status === "failed") {
            clearInterval(poll);
            setMdExportStates(prev => ({ ...prev, [sessionId]: { ...prev[sessionId], status: "failed" } }));
            toast.error(`Export thất bại: ${statusData.errorMsg ?? "Unknown error"}`);
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMdExportStates(prev => ({ ...prev, [sessionId]: { status: "failed", jobId: null, progress: { done: 0, total: 0 } } }));
      toast.error(`Export thất bại: ${msg}`);
    }
  };

  // Filter sessions
  const filteredSessions = sessions?.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return s.domain.toLowerCase().includes(q) || s.spaceId.toLowerCase().includes(q);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Đang tải lịch sử...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="py-3">
        <AlertCircle className="w-4 h-4" />
        <AlertDescription className="text-sm ml-1">Không thể tải lịch sử: {error.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">
            {sessions?.length ?? 0} phiên crawl
          </span>
          {sessions && sessions.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <span className="text-xs text-muted-foreground">
                {sessions.filter(s => s.status === "done").length} hoàn thành ·{" "}
                {sessions.filter(s => s.status === "paused").length} tạm dừng ·{" "}
                {sessions.filter(s => s.status === "running").length} đang chạy
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm theo domain..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 text-xs pl-8 w-48"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" />
            Làm mới
          </Button>
        </div>
      </div>

      {/* Session list */}
      {!filteredSessions?.length ? (
        <Card className="shadow-sm border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <History className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {searchQuery ? "Không tìm thấy kết quả" : "Chưa có lịch sử crawl"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery
                  ? `Không có session nào khớp với "${searchQuery}"`
                  : "Crawl một wiki để bắt đầu. Mỗi lần crawl sẽ được lưu tại đây."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredSessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              onView={handleView}
              onDelete={(id) => setDeleteConfirmId(id)}
              onExportMd={handleExportMd}
              isDeleting={deleteSessionMutation.isPending && deleteConfirmId === session.id}
              isLoadingNodes={loadingSessionId === session.id && getSessionNodesMutation.isLoading}
              mdExportState={mdExportStates[session.id] ?? { status: "idle", jobId: null, progress: { done: 0, total: 0 } }}
            />
          ))}
        </div>
      )}

      {/* Stats summary */}
      {sessions && sessions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Tổng phiên", value: sessions.length, color: "text-foreground" },
            { label: "Hoàn thành", value: sessions.filter(s => s.status === "done").length, color: "text-green-600" },
            { label: "Tổng nodes", value: sessions.reduce((a, s) => a + s.totalNodes, 0).toLocaleString(), color: "text-blue-600" },
            { label: "Tạm dừng", value: sessions.filter(s => s.status === "paused").length, color: "text-amber-600" },
          ].map(stat => (
            <Card key={stat.label} className="shadow-sm">
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className={cn("text-lg font-bold mt-0.5", stat.color)}>{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirm dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa phiên crawl?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này sẽ xóa vĩnh viễn session #{deleteConfirmId} cùng toàn bộ nodes và queue liên quan.
              Không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteConfirmId !== null) deleteSessionMutation.mutate({ sessionId: deleteConfirmId }); }}
            >
              {deleteSessionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
