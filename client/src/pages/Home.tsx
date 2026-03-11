import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Link2,
  Download,
  FileDown,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  BookOpen,
  TreePine,
  Table2,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertTriangle,
  PlayCircle,
  PauseCircle,
  Database,
  Scissors,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { WikiTreeView, type WikiNode } from "@/components/WikiTreeView";
import { WikiTable } from "@/components/WikiTable";

// ─── CSV Export ──────────────────────────────────────────────────────────────
function exportToCsv(nodes: WikiNode[], filename = "feishu_wiki_links.csv") {
  const headers = ["Title", "URL", "Type", "Depth", "Node Token", "Obj Token", "Parent Token", "Created", "Updated"];
  const rows = nodes.map(n => [
    `"${(n.title ?? "").replace(/"/g, '""')}"`,
    n.url ?? "",
    n.obj_type ?? "",
    String(n.depth ?? 0),
    n.node_token ?? "",
    n.obj_token ?? "",
    n.parent_node_token ?? "",
    n.obj_create_time ? new Date(parseInt(n.obj_create_time) * 1000).toISOString() : "",
    n.obj_edit_time ? new Date(parseInt(n.obj_edit_time) * 1000).toISOString() : "",
  ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Type Stats ───────────────────────────────────────────────────────────────
function TypeStats({ nodes }: { nodes: WikiNode[] }) {
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.obj_type] = (counts[n.obj_type] ?? 0) + 1;
  const typeColors: Record<string, string> = {
    doc: "bg-blue-100 text-blue-700",
    docx: "bg-blue-100 text-blue-700",
    wiki: "bg-purple-100 text-purple-700",
    sheet: "bg-green-100 text-green-700",
    bitable: "bg-orange-100 text-orange-700",
    mindnote: "bg-pink-100 text-pink-700",
    file: "bg-gray-100 text-gray-700",
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(counts).map(([type, count]) => (
        <span key={type} className={cn("px-2 py-0.5 rounded-full text-xs font-medium", typeColors[type] ?? typeColors.file)}>
          {type}: {count}
        </span>
      ))}
    </div>
  );
}

// ─── Credentials Guide ────────────────────────────────────────────────────────
function CredentialsGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-500" />
          How to get Feishu / Lark credentials
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 text-xs bg-blue-50/40 dark:bg-blue-900/10 border-t border-border">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1">
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">Feishu</span>
                App Credentials
              </p>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li>Go to <a href="https://open.feishu.cn/app" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">open.feishu.cn/app <ExternalLink className="w-2.5 h-2.5" /></a></li>
                <li>Enable: <code className="bg-muted px-1 rounded">wiki:wiki:readonly</code></li>
                <li>Publish the app, then copy App ID &amp; Secret</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1">
                <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">Lark</span>
                App Credentials
              </p>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li>Go to <a href="https://open.larksuite.com/app" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">open.larksuite.com/app <ExternalLink className="w-2.5 h-2.5" /></a></li>
                <li>Enable: <code className="bg-muted px-1 rounded">wiki:wiki:readonly</code></li>
                <li>Publish the app, then copy App ID &amp; Secret</li>
              </ol>
            </div>
          </div>
          <Separator />
          <div>
            <p className="font-semibold text-foreground mb-1.5">User Access Token (quick test, expires in 2h)</p>
            <div className="grid grid-cols-2 gap-4">
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li className="font-medium text-foreground">For Feishu:</li>
                <li>Go to <a href="https://open.feishu.cn/api-explorer" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">Feishu API Explorer <ExternalLink className="w-2.5 h-2.5" /></a></li>
                <li>Click <strong className="text-foreground">Get Token</strong> → <strong className="text-foreground">user_access_token</strong></li>
              </ol>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li className="font-medium text-foreground">For Lark:</li>
                <li>Go to <a href="https://open.larksuite.com/api-explorer" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">Lark API Explorer <ExternalLink className="w-2.5 h-2.5" /></a></li>
                <li>Click <strong className="text-foreground">Get Token</strong> → <strong className="text-foreground">user_access_token</strong></li>
              </ol>
            </div>
            <p className="text-amber-600 dark:text-amber-400 mt-1.5">⚠ User tokens expire after 2 hours. If the crawl pauses mid-way, get a new token and click <strong>Resume</strong>.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Progress Display ─────────────────────────────────────────────────────────
function CrawlProgressDisplay({ count, pending, message, startTime }: { count: number; pending: number; message: string; startTime: number }) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const rate = elapsed > 0 ? Math.round(count / elapsed) : 0;

  return (
    <Card className="shadow-sm border-primary/20">
      <CardContent className="py-6 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">{message}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {elapsed}s elapsed{rate > 0 ? ` · ~${rate} nodes/sec` : ""}
            </p>
          </div>
        </div>
        {count > 0 && (
          <div className="w-full max-w-md space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{count.toLocaleString()} nodes found</span>
              <span className="flex items-center gap-1">
                {pending > 0 && <span className="text-amber-600">{pending.toLocaleString()} pending</span>}
                {pending > 0 && <span>·</span>}
                <Zap className="w-3 h-3 text-yellow-500" />Persistent BFS
              </span>
            </div>
            <Progress value={Math.min((count / 200) % 100, 99)} className="h-1.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Paused State Display ─────────────────────────────────────────────────────
function PausedDisplay({
  sessionId,
  totalCount,
  pending,
  message,
  onResume,
}: {
  sessionId: number;
  totalCount: number;
  pending: number;
  message: string;
  onResume: () => void;
}) {
  return (
    <Card className="shadow-sm border-amber-200 bg-amber-50/40 dark:bg-amber-900/10">
      <CardContent className="py-6 flex flex-col items-center gap-4 text-center">
        <PauseCircle className="w-10 h-10 text-amber-500" />
        <div>
          <p className="text-sm font-semibold text-foreground">Crawl Paused</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">{message}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 bg-background rounded-md px-3 py-1.5 border">
            <Database className="w-3.5 h-3.5 text-primary" />
            <strong>{totalCount.toLocaleString()}</strong> nodes saved
          </span>
          <span className="flex items-center gap-1.5 bg-background rounded-md px-3 py-1.5 border border-amber-200">
            <Loader2 className="w-3.5 h-3.5 text-amber-500" />
            <strong>{pending.toLocaleString()}</strong> pending
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Session ID: <code className="font-mono bg-muted px-1 rounded">{sessionId}</code></p>
        <Button onClick={onResume} className="gap-2">
          <PlayCircle className="w-4 h-4" />
          Resume with new token
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── SSE Crawl Hook ───────────────────────────────────────────────────────────
interface CrawlResult {
  sessionId?: number;
  spaceId: string;
  domain: string;
  totalCount: number;
  skipped: number;
  nodes: WikiNode[];
  tree: WikiNode[];
  treeAvailable: boolean;
}

interface PausedState {
  sessionId: number;
  totalCount: number;
  pending: number;
  message: string;
}

function useSseCrawl() {
  const [isLoading, setIsLoading] = useState(false);
  const [progressCount, setProgressCount] = useState(0);
  const [progressPending, setProgressPending] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [paused, setPaused] = useState<PausedState | null>(null);
  const [startTime, setStartTime] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const openSSE = useCallback((url: string) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setPaused(null);
    setProgressCount(0);
    setProgressPending(0);
    setProgressMessage("Connecting...");
    setStartTime(Date.now());

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "session") {
          // Session created — nothing to do in UI yet
        } else if (data.type === "progress") {
          setProgressCount(data.count ?? 0);
          setProgressPending(data.pending ?? 0);
          setProgressMessage(data.message ?? "");
        } else if (data.type === "done") {
          setResult({
            sessionId: data.sessionId,
            spaceId: data.spaceId,
            domain: data.domain,
            totalCount: data.totalCount,
            skipped: data.skipped ?? 0,
            nodes: data.nodes as WikiNode[],
            tree: data.tree as WikiNode[],
            treeAvailable: data.treeAvailable ?? true,
          });
          setIsLoading(false);
          es.close();
          esRef.current = null;
        } else if (data.type === "paused") {
          setPaused({
            sessionId: data.sessionId,
            totalCount: data.totalCount ?? 0,
            pending: data.pending ?? 0,
            message: data.message ?? "Token expired mid-crawl.",
          });
          setIsLoading(false);
          es.close();
          esRef.current = null;
        } else if (data.type === "error") {
          setError(data.message ?? "Unknown error");
          setIsLoading(false);
          es.close();
          esRef.current = null;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      if (esRef.current) {
        setError("Connection lost. Please try again.");
        setIsLoading(false);
        es.close();
        esRef.current = null;
      }
    };
  }, []);

  const crawl = useCallback((params: {
    url: string;
    appId?: string;
    appSecret?: string;
    userAccessToken?: string;
    crawlMode?: "space" | "subtree";
  }) => {
    const qs = new URLSearchParams();
    qs.set("url", params.url);
    if (params.userAccessToken) qs.set("userAccessToken", params.userAccessToken);
    if (params.appId) qs.set("appId", params.appId);
    if (params.appSecret) qs.set("appSecret", params.appSecret);
    if (params.crawlMode) qs.set("crawlMode", params.crawlMode);
    openSSE(`/api/wiki/crawl-stream?${qs.toString()}`);
  }, [openSSE]);

  const resume = useCallback((params: {
    sessionId: number;
    appId?: string;
    appSecret?: string;
    userAccessToken?: string;
  }) => {
    const qs = new URLSearchParams();
    qs.set("sessionId", String(params.sessionId));
    if (params.userAccessToken) qs.set("userAccessToken", params.userAccessToken);
    if (params.appId) qs.set("appId", params.appId);
    if (params.appSecret) qs.set("appSecret", params.appSecret);
    openSSE(`/api/wiki/crawl-resume?${qs.toString()}`);
  }, [openSSE]);

  const abort = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  return { crawl, resume, abort, isLoading, progressCount, progressPending, progressMessage, error, result, paused, startTime };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  const [wikiUrl, setWikiUrl] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [userToken, setUserToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [authMode, setAuthMode] = useState<"app" | "token">("app");
  const [crawlMode, setCrawlMode] = useState<"space" | "subtree">("space");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("tree");

  // Parse node token from URL for display
  const parsedUrlToken = useMemo(() => {
    try {
      const u = new URL(wikiUrl.trim());
      const m = u.pathname.match(/\/wiki\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    } catch { return null; }
  }, [wikiUrl]);

  const { crawl, resume, abort, isLoading, progressCount, progressPending, progressMessage, error, result, paused, startTime } = useSseCrawl();
  const testAuthMutation = trpc.wiki.testAuth.useMutation();

  const handleCrawl = useCallback(() => {
    if (!wikiUrl.trim()) return;
    crawl({
      url: wikiUrl.trim(),
      appId: authMode === "app" ? appId.trim() || undefined : undefined,
      appSecret: authMode === "app" ? appSecret.trim() || undefined : undefined,
      userAccessToken: authMode === "token" ? userToken.trim() || undefined : undefined,
      crawlMode,
    });
  }, [wikiUrl, appId, appSecret, userToken, authMode, crawlMode, crawl]);

  const handleResume = useCallback(() => {
    if (!paused) return;
    resume({
      sessionId: paused.sessionId,
      appId: authMode === "app" ? appId.trim() || undefined : undefined,
      appSecret: authMode === "app" ? appSecret.trim() || undefined : undefined,
      userAccessToken: authMode === "token" ? userToken.trim() || undefined : undefined,
    });
  }, [paused, appId, appSecret, userToken, authMode, resume]);

  const handleExportCsv = useCallback(() => {
    if (!result?.nodes.length) return;
    exportToCsv(
      result.nodes,
      `feishu_wiki_${result.spaceId || "export"}_${new Date().toISOString().slice(0, 10)}.csv`
    );
  }, [result]);

  // ─── Markdown Export State ───────────────────────────────────────────────
  const [mdExportJobId, setMdExportJobId] = useState<string | null>(null);
  const [mdExportStatus, setMdExportStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [mdExportProgress, setMdExportProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [mdExportError, setMdExportError] = useState<string | null>(null);
  const mdPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopMdPoll = useCallback(() => {
    if (mdPollRef.current) {
      clearInterval(mdPollRef.current);
      mdPollRef.current = null;
    }
  }, []);

  const handleExportMarkdown = useCallback(async () => {
    if (!result?.sessionId) return;
    setMdExportStatus("running");
    setMdExportError(null);
    setMdExportProgress({ done: 0, total: 0, failed: 0 });
    setMdExportJobId(null);

    try {
      const body: Record<string, string> = { sessionId: String(result.sessionId) };
      if (authMode === "token" && userToken.trim()) body.userAccessToken = userToken.trim();
      if (authMode === "app" && appId.trim()) body.appId = appId.trim();
      if (authMode === "app" && appSecret.trim()) body.appSecret = appSecret.trim();

      const startRes = await fetch("/api/wiki/export/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const startData = await startRes.json() as { jobId?: string; total?: number; error?: string };
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error ?? "Failed to start export");
      }

      const jobId = startData.jobId;
      setMdExportJobId(jobId);
      setMdExportProgress({ done: 0, total: startData.total ?? 0, failed: 0 });

      // Poll status every 2 seconds
      stopMdPoll();
      mdPollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/wiki/export/status?jobId=${encodeURIComponent(jobId)}`);
          const statusData = await statusRes.json() as {
            status: string; done: number; total: number; failed: number;
            errorMsg?: string; hasZip?: boolean;
          };
          setMdExportProgress({ done: statusData.done, total: statusData.total, failed: statusData.failed });

          if (statusData.status === "done" && statusData.hasZip) {
            stopMdPoll();
            setMdExportStatus("done");
            // Auto-download
            const a = document.createElement("a");
            a.href = `/api/wiki/export/download?jobId=${encodeURIComponent(jobId)}`;
            a.click();
          } else if (statusData.status === "failed") {
            stopMdPoll();
            setMdExportStatus("failed");
            setMdExportError(statusData.errorMsg ?? "Export failed");
          }
        } catch (e) {
          console.warn("[MD Export] Poll error:", e);
        }
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMdExportStatus("failed");
      setMdExportError(msg);
    }
  }, [result, authMode, userToken, appId, appSecret, stopMdPoll]);

  const handleDownloadMdAgain = useCallback(() => {
    if (!mdExportJobId) return;
    const a = document.createElement("a");
    a.href = `/api/wiki/export/download?jobId=${encodeURIComponent(mdExportJobId)}`;
    a.click();
  }, [mdExportJobId]);

  // Cleanup poll on unmount
  useEffect(() => () => stopMdPoll(), [stopMdPoll]);

  const hasResults = !!result && result.nodes.length > 0;
  const isLargeWiki = result && result.totalCount > 5000;

  // Auto-switch to table tab when wiki is large
  useEffect(() => {
    if (isLargeWiki) setActiveTab("table");
  }, [isLargeWiki]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-20">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">Feishu Wiki Crawler</h1>
              <p className="text-xs text-muted-foreground leading-tight">Extract all links from Feishu Wiki spaces</p>
            </div>
          </div>
          {hasResults && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleExportCsv}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 container py-6 flex flex-col gap-5">
        {/* Input Card */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              Wiki URL &amp; Credentials
            </CardTitle>
            <CardDescription className="text-xs">
              Feishu Wiki API requires authentication. Enter your App credentials or User Access Token to crawl any wiki.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* URL Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="https://xxx.feishu.cn/wiki/TOKEN or https://xxx.larksuite.com/wiki/TOKEN"
                  value={wikiUrl}
                  onChange={e => setWikiUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCrawl()}
                  className="h-9 text-sm font-mono pr-24"
                />
                {wikiUrl.trim() && (
                  <span className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    wikiUrl.includes("larksuite.com")
                      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                      : wikiUrl.includes("feishu.cn")
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {wikiUrl.includes("larksuite.com") ? "Lark" : wikiUrl.includes("feishu.cn") ? "Feishu" : "?"}
                  </span>
                )}
              </div>
              {isLoading ? (
                <Button variant="destructive" onClick={abort} className="h-9 px-4 gap-2 shrink-0">
                  <AlertCircle className="w-3.5 h-3.5" />Stop
                </Button>
              ) : (
                <Button
                  onClick={handleCrawl}
                  disabled={!wikiUrl.trim()}
                  className="h-9 px-4 gap-2 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />Crawl
                </Button>
              )}
            </div>

            {/* Auth mode tabs */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Authentication</span>
              </div>
              <div className="flex gap-1 p-1 bg-muted rounded-md w-fit mb-3">
                <button
                  className={cn("px-3 py-1 text-xs rounded font-medium transition-colors", authMode === "app" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => setAuthMode("app")}
                >
                  App Credentials
                </button>
                <button
                  className={cn("px-3 py-1 text-xs rounded font-medium transition-colors", authMode === "token" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => setAuthMode("token")}
                >
                  User Access Token
                </button>
              </div>

              {authMode === "app" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">App ID</Label>
                    <Input placeholder="cli_xxxxxxxxxx" value={appId} onChange={e => setAppId(e.target.value)} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">App Secret</Label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder="App Secret"
                        value={appSecret}
                        onChange={e => setAppSecret(e.target.value)}
                        className="h-8 text-xs font-mono pr-8"
                      />
                      <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowSecret(v => !v)} type="button">
                        {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!appId || !appSecret || testAuthMutation.isPending} onClick={() => testAuthMutation.mutate({ appId, appSecret })}>
                      {testAuthMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Test Connection
                    </Button>
                    {testAuthMutation.isSuccess && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Connected</span>}
                    {testAuthMutation.isError && <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {testAuthMutation.error.message}</span>}
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">User Access Token</Label>
                  <Input placeholder="u-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={userToken} onChange={e => setUserToken(e.target.value)} className="h-8 text-xs font-mono" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠ User tokens expire after 2 hours.</p>
                </div>
              )}
            </div>

            {/* Crawl Mode Toggle */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Crawl Scope</span>
              </div>
              <div className="flex gap-1 p-1 bg-muted rounded-md w-fit">
                <button
                  className={cn("px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1.5", crawlMode === "space" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => setCrawlMode("space")}
                >
                  <Globe className="w-3 h-3" />
                  Entire Space
                </button>
                <button
                  className={cn("px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1.5", crawlMode === "subtree" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => setCrawlMode("subtree")}
                >
                  <Scissors className="w-3 h-3" />
                  This Node Only
                </button>
              </div>
              {crawlMode === "space" ? (
                <p className="text-xs text-muted-foreground">Crawl the entire wiki space — all pages, all sections.</p>
              ) : parsedUrlToken ? (
                <p className="text-xs text-muted-foreground">
                  Only crawl children of node{" "}
                  <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">{parsedUrlToken}</code>
                  {" "}and its descendants.
                </p>
              ) : (
                <p className="text-xs text-amber-600">⚠ Enter a URL with a specific node token to use this mode.</p>
              )}
            </div>

            {/* Credentials guide */}
            <CredentialsGuide />
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="py-3">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-sm whitespace-pre-wrap ml-1">{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading with real-time progress */}
        {isLoading && (
          <CrawlProgressDisplay count={progressCount} pending={progressPending} message={progressMessage} startTime={startTime} />
        )}

        {/* Paused state — token expired mid-crawl */}
        {paused && !isLoading && (
          <PausedDisplay
            sessionId={paused.sessionId}
            totalCount={paused.totalCount}
            pending={paused.pending}
            message={paused.message}
            onResume={handleResume}
          />
        )}

        {/* Results */}
        {hasResults && !isLoading && (
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold">{result.nodes.length.toLocaleString()} pages found</span>
                </div>
                {result.skipped > 0 && (
                  <>
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {result.skipped} permanently failed
                    </span>
                  </>
                )}
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-muted-foreground font-mono">{result.domain}</span>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-muted-foreground">Space: <code className="font-mono">{result.spaceId}</code></span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <TypeStats nodes={result.nodes} />
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExportCsv}>
                  <Download className="w-3 h-3" /> CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400"
                  onClick={handleExportMarkdown}
                  disabled={mdExportStatus === "running"}
                >
                  {mdExportStatus === "running" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <FileDown className="w-3 h-3" />
                  )}
                  {mdExportStatus === "running"
                    ? `Exporting... ${mdExportProgress.done}/${mdExportProgress.total}`
                    : mdExportStatus === "done"
                    ? "MD (ZIP) ✓"
                    : "MD (ZIP)"}
                </Button>
                {mdExportStatus === "done" && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-violet-600" onClick={handleDownloadMdAgain}>
                    <Download className="w-3 h-3" /> Re-download
                  </Button>
                )}
              </div>
            </div>

            {/* MD Export Progress */}
            {mdExportStatus === "running" && (
              <Card className="shadow-sm border-violet-200 dark:border-violet-800">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-violet-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-medium text-violet-700 dark:text-violet-400">Exporting Markdown files...</span>
                        <span className="text-muted-foreground">{mdExportProgress.done}/{mdExportProgress.total} docs{mdExportProgress.failed > 0 ? ` · ${mdExportProgress.failed} failed` : ""}</span>
                      </div>
                      <Progress
                        value={mdExportProgress.total > 0 ? Math.round((mdExportProgress.done / mdExportProgress.total) * 100) : 0}
                        className="h-1.5"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <FileText className="w-3 h-3 inline mr-1" />
                    Fetching content via Feishu Docs API (rate limit: 5 req/s). Large wikis may take several minutes. ZIP will auto-download when done.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* MD Export Error */}
            {mdExportStatus === "failed" && mdExportError && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="text-xs ml-1">
                  <strong>Markdown export failed:</strong> {mdExportError}
                  <Button variant="link" size="sm" className="h-auto p-0 ml-2 text-xs" onClick={handleExportMarkdown}>Retry</Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Large wiki warning */}
            {isLargeWiki && (
              <Alert className="py-2 border-amber-200 bg-amber-50 dark:bg-amber-900/10">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-700 dark:text-amber-400 ml-1">
                  Large wiki ({result.totalCount.toLocaleString()} nodes). Tree view is disabled for performance — use Table View with search/filter instead. CSV export includes all nodes.
                </AlertDescription>
              </Alert>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
              <TabsList className="w-fit h-8">
                <TabsTrigger value="tree" className="text-xs gap-1.5 h-7 px-3">
                  <TreePine className="w-3.5 h-3.5" />Tree View {isLargeWiki && <span className="text-xs opacity-60">(large)</span>}
                </TabsTrigger>
                <TabsTrigger value="table" className="text-xs gap-1.5 h-7 px-3">
                  <Table2 className="w-3.5 h-3.5" />Table View
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tree" className="flex-1 mt-3">
                <Card className="shadow-sm">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Wiki Hierarchy</CardTitle>
                      <div className="w-56">
                        <Input placeholder="Search tree..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-7 text-xs" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 overflow-auto max-h-[600px]">
                    {isLargeWiki && !searchQuery ? (
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <AlertTriangle className="w-8 h-8 text-amber-500" />
                        <div>
                          <p className="text-sm font-medium">Tree view may be slow for {result.totalCount.toLocaleString()} nodes</p>
                          <p className="text-xs text-muted-foreground mt-1">Use the search box above to filter, or switch to Table View for better performance.</p>
                        </div>
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => setActiveTab("table")}>
                          <Table2 className="w-3.5 h-3.5 mr-1.5" />Switch to Table View
                        </Button>
                        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setSearchQuery(" ")}>
                          Load tree anyway
                        </Button>
                      </div>
                    ) : (
                      <WikiTreeView tree={result.tree} searchQuery={searchQuery} />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="table" className="flex-1 mt-3">
                <Card className="shadow-sm">
                  <CardContent className="pt-4 pb-4" style={{ minHeight: "500px" }}>
                    <WikiTable nodes={result.nodes} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Empty state */}
        {!hasResults && !isLoading && !error && !paused && (
          <Card className="shadow-sm border-dashed">
            <CardContent className="py-14 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-8 h-8 text-primary/60" />
              </div>
              <div>
                <h3 className="text-base font-semibold mb-1">Ready to crawl</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Enter a Feishu Wiki URL and your App credentials above, then click <strong>Crawl</strong>.
                </p>
              </div>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg px-4 py-3 text-left">
                <p className="font-medium text-foreground mb-1">Example URLs:</p>
                <code className="font-mono">https://waytoagi.feishu.cn/wiki/CCR4wl3upi6dF9kVE5YcAcGcnlU</code>
                <code className="font-mono">https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e</code>
                <code className="font-mono">https://company.larksuite.com/wiki/SPACE_TOKEN</code>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-50 dark:bg-green-900/10 rounded-lg px-4 py-2.5 border border-green-200 dark:border-green-800">
                <Zap className="w-3.5 h-3.5 text-green-600 shrink-0" />
                <span><strong className="text-green-700 dark:text-green-400">Zero node loss:</strong> Persistent queue in DB — resume if token expires mid-crawl</span>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="border-t border-border py-3">
        <div className="container flex items-center justify-between text-xs text-muted-foreground">
          <span>Feishu Wiki Crawler — Feishu Open Platform API</span>
          <a href="https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space-node/list" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">API Docs</a>
        </div>
      </footer>
    </div>
  );
}
