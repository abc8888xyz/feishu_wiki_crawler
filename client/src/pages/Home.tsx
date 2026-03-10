import { useState, useCallback } from "react";
import {
  Link2,
  Download,
  ChevronDown,
  ChevronUp,
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
  Globe,
  Lock,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { WikiTreeView, type WikiNode } from "@/components/WikiTreeView";
import { WikiTable } from "@/components/WikiTable";

// ─── CSV Export ──────────────────────────────────────────────────────────────
function exportToCsv(nodes: WikiNode[], filename: string = "feishu_wiki_links.csv") {
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
  for (const n of nodes) {
    counts[n.obj_type] = (counts[n.obj_type] ?? 0) + 1;
  }
  const typeColors: Record<string, string> = {
    doc: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    docx: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    wiki: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    sheet: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    bitable: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    mindnote: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
    file: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(counts).map(([type, count]) => (
        <span
          key={type}
          className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", typeColors[type] ?? typeColors.file)}
        >
          {type}: {count}
        </span>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  // Form state
  const [wikiUrl, setWikiUrl] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [userToken, setUserToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showAuthPanel, setShowAuthPanel] = useState(false);
  const [authMode, setAuthMode] = useState<"app" | "token">("app");

  // Results state
  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [tree, setTree] = useState<WikiNode[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [domain, setDomain] = useState("");
  const [crawlMode, setCrawlMode] = useState<"api" | "scrape" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("tree");

  // Mutation
  const crawlMutation = trpc.wiki.crawl.useMutation({
    onSuccess: (data) => {
      setNodes(data.nodes as WikiNode[]);
      setTree(data.tree as WikiNode[]);
      setSpaceId(data.spaceId);
      setDomain(data.domain);
      setCrawlMode(data.mode);
    },
  });

  const testAuthMutation = trpc.wiki.testAuth.useMutation();

  const handleCrawl = useCallback(() => {
    if (!wikiUrl.trim()) return;
    crawlMutation.mutate({
      url: wikiUrl.trim(),
      appId: authMode === "app" && showAuthPanel ? appId.trim() || undefined : undefined,
      appSecret: authMode === "app" && showAuthPanel ? appSecret.trim() || undefined : undefined,
      userAccessToken: authMode === "token" && showAuthPanel ? userToken.trim() || undefined : undefined,
    });
  }, [wikiUrl, appId, appSecret, userToken, authMode, showAuthPanel, crawlMutation]);

  const handleTestAuth = useCallback(() => {
    if (!appId || !appSecret) return;
    testAuthMutation.mutate({ appId, appSecret });
  }, [appId, appSecret, testAuthMutation]);

  const handleExportCsv = useCallback(() => {
    if (nodes.length === 0) return;
    const urlSlug = spaceId || "wiki";
    exportToCsv(nodes, `feishu_wiki_${urlSlug}_${new Date().toISOString().slice(0, 10)}.csv`);
  }, [nodes, spaceId]);

  const hasResults = nodes.length > 0;
  const isLoading = crawlMutation.isPending;
  const error = crawlMutation.error;
  const hasAuth = showAuthPanel && ((authMode === "app" && appId && appSecret) || (authMode === "token" && userToken));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground leading-tight">Feishu Wiki Crawler</h1>
              <p className="text-xs text-muted-foreground leading-tight">Extract all links from Feishu Wiki spaces</p>
            </div>
          </div>
          {hasResults && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handleExportCsv}
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
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
              Wiki URL
            </CardTitle>
            <CardDescription className="text-xs">
              Paste a Feishu Wiki URL. Public wikis work without credentials (browser-based extraction). Private wikis require App credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* URL Input */}
            <div className="flex gap-2">
              <Input
                placeholder="https://xxx.feishu.cn/wiki/TOKEN"
                value={wikiUrl}
                onChange={e => setWikiUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCrawl()}
                className="h-9 text-sm font-mono"
              />
              <Button
                onClick={handleCrawl}
                disabled={isLoading || !wikiUrl.trim()}
                className="h-9 px-4 gap-2 shrink-0"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Crawling...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Crawl
                  </>
                )}
              </Button>
            </div>

            {/* Mode indicator */}
            <div className="flex items-center gap-3 text-xs">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors cursor-pointer",
                  !hasAuth
                    ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
                    : "border-border text-muted-foreground hover:border-border/80"
                )}
                onClick={() => setShowAuthPanel(false)}
              >
                <Globe className="w-3 h-3" />
                Public mode (no credentials)
              </div>
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors cursor-pointer",
                  hasAuth
                    ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
                    : "border-border text-muted-foreground hover:border-border/80"
                )}
                onClick={() => setShowAuthPanel(true)}
              >
                <Lock className="w-3 h-3" />
                Private mode (with credentials)
              </div>
            </div>

            {/* Auth Toggle */}
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAuthPanel(v => !v)}
            >
              <Key className="w-3.5 h-3.5" />
              {showAuthPanel ? "Hide" : "Add"} authentication credentials (for private wikis)
              {showAuthPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* Auth Panel */}
            {showAuthPanel && (
              <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
                {/* Auth mode tabs */}
                <div className="flex gap-1 p-1 bg-muted rounded-md w-fit">
                  <button
                    className={cn(
                      "px-3 py-1 text-xs rounded font-medium transition-colors",
                      authMode === "app"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setAuthMode("app")}
                  >
                    App Credentials
                  </button>
                  <button
                    className={cn(
                      "px-3 py-1 text-xs rounded font-medium transition-colors",
                      authMode === "token"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setAuthMode("token")}
                  >
                    User Access Token
                  </button>
                </div>

                {authMode === "app" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">App ID</Label>
                      <Input
                        placeholder="cli_xxxxxxxxxx"
                        value={appId}
                        onChange={e => setAppId(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
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
                        <button
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowSecret(v => !v)}
                          type="button"
                        >
                          {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!appId || !appSecret || testAuthMutation.isPending}
                        onClick={handleTestAuth}
                      >
                        {testAuthMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : null}
                        Test Connection
                      </Button>
                      {testAuthMutation.isSuccess && (
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Connected successfully
                        </span>
                      )}
                      {testAuthMutation.isError && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> {testAuthMutation.error.message}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs">User Access Token</Label>
                    <Input
                      placeholder="u-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={userToken}
                      onChange={e => setUserToken(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Obtain from Feishu Open Platform API Explorer after login.
                    </p>
                  </div>
                )}

                <Alert className="py-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
                  <Info className="w-3.5 h-3.5 text-blue-500" />
                  <AlertDescription className="text-xs text-blue-700 dark:text-blue-300 ml-1">
                    Get your App ID and Secret from{" "}
                    <a
                      href="https://open.feishu.cn/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Feishu Open Platform
                    </a>
                    . Your app needs <strong>View wiki space node list</strong> permission.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="py-3">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-sm whitespace-pre-wrap ml-1">
              {error.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading state */}
        {isLoading && (
          <Card className="shadow-sm">
            <CardContent className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {hasAuth ? "Fetching wiki nodes via API..." : "Loading wiki in browser (this may take 15–30s)..."}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasAuth
                  ? "Recursively fetching all child nodes with pagination support."
                  : "Opening a headless browser to render the public wiki and extract all page links."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {hasResults && !isLoading && (
          <div className="flex flex-col gap-4 flex-1">
            {/* Stats bar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold text-foreground">{nodes.length} pages found</span>
                </div>
                {crawlMode && (
                  <>
                    <Separator orientation="vertical" className="h-4" />
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                        crawlMode === "api"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      )}
                    >
                      {crawlMode === "api" ? <Zap className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                      {crawlMode === "api" ? "Full API mode" : "Browser scrape mode"}
                    </span>
                  </>
                )}
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-muted-foreground font-mono">{domain}</span>
              </div>
              <div className="flex items-center gap-2">
                <TypeStats nodes={nodes} />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleExportCsv}
                >
                  <Download className="w-3 h-3" />
                  CSV
                </Button>
              </div>
            </div>

            {/* Scrape mode notice */}
            {crawlMode === "scrape" && (
              <Alert className="py-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
                <Info className="w-3.5 h-3.5 text-amber-600" />
                <AlertDescription className="text-xs text-amber-700 dark:text-amber-300 ml-1">
                  <strong>Browser scrape mode:</strong> Results may be partial — only pages visible in the sidebar were captured.
                  For complete results with full metadata, provide{" "}
                  <button
                    className="underline font-medium"
                    onClick={() => setShowAuthPanel(true)}
                  >
                    App credentials
                  </button>
                  {" "}to use the official Feishu API.
                </AlertDescription>
              </Alert>
            )}

            {/* Tabs: Tree / Table */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
              <TabsList className="w-fit h-8">
                <TabsTrigger value="tree" className="text-xs gap-1.5 h-7 px-3">
                  <TreePine className="w-3.5 h-3.5" />
                  Tree View
                </TabsTrigger>
                <TabsTrigger value="table" className="text-xs gap-1.5 h-7 px-3">
                  <Table2 className="w-3.5 h-3.5" />
                  Table View
                </TabsTrigger>
              </TabsList>

              {/* Tree View */}
              <TabsContent value="tree" className="flex-1 mt-3">
                <Card className="shadow-sm h-full">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Wiki Hierarchy</CardTitle>
                      <div className="w-56">
                        <Input
                          placeholder="Search tree..."
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-2 pb-4 overflow-auto max-h-[600px]">
                    <WikiTreeView tree={tree} searchQuery={searchQuery} />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Table View */}
              <TabsContent value="table" className="flex-1 mt-3">
                <Card className="shadow-sm">
                  <CardContent className="pt-4 pb-4 flex flex-col" style={{ minHeight: "500px" }}>
                    <WikiTable
                      nodes={nodes}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Empty state */}
        {!hasResults && !isLoading && !error && (
          <Card className="shadow-sm border-dashed">
            <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-8 h-8 text-primary/60" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Ready to crawl</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Enter a Feishu Wiki URL above. Public wikis work immediately — no credentials needed.
                </p>
              </div>

              {/* Mode comparison */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-lg text-left">
                <div className="border border-green-200 dark:border-green-800 rounded-lg p-3 bg-green-50/50 dark:bg-green-900/10">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs font-semibold text-green-700 dark:text-green-400">Public Mode</span>
                  </div>
                  <p className="text-xs text-muted-foreground">No credentials needed. Uses browser rendering. May capture partial results.</p>
                </div>
                <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50/50 dark:bg-blue-900/10">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">API Mode</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Requires App ID + Secret. Full recursive crawl with complete metadata.</p>
                </div>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground bg-muted/50 rounded-lg px-4 py-3 text-left w-full max-w-lg">
                <p className="font-medium text-foreground mb-1">Example URLs:</p>
                <code className="font-mono">https://waytoagi.feishu.cn/wiki/CCR4wl3upi6dF9kVE5YcAcGcnlU</code>
                <code className="font-mono">https://company.feishu.cn/wiki/SPACE_TOKEN</code>
                <code className="font-mono">https://company.larksuite.com/wiki/SPACE_TOKEN</code>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-3">
        <div className="container flex items-center justify-between text-xs text-muted-foreground">
          <span>Feishu Wiki Crawler — Feishu Open Platform API</span>
          <a
            href="https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space-node/list"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            API Docs
          </a>
        </div>
      </footer>
    </div>
  );
}
