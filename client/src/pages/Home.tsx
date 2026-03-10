import { useState, useCallback } from "react";
import {
  Link2,
  Download,
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
          How to get Feishu App credentials
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 text-xs bg-blue-50/40 dark:bg-blue-900/10 border-t border-border">
          <div>
            <p className="font-semibold text-foreground mb-1.5">Option A — App Credentials (recommended)</p>
            <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
              <li>Go to <a href="https://open.feishu.cn/app" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">open.feishu.cn/app <ExternalLink className="w-2.5 h-2.5" /></a> and create a new app</li>
              <li>Under <strong className="text-foreground">Permissions &amp; Scopes</strong>, enable: <code className="bg-muted px-1 rounded">wiki:wiki:readonly</code></li>
              <li>Under <strong className="text-foreground">Version Management</strong>, publish the app</li>
              <li>Copy the <strong className="text-foreground">App ID</strong> and <strong className="text-foreground">App Secret</strong> from the app credentials page</li>
            </ol>
          </div>
          <Separator />
          <div>
            <p className="font-semibold text-foreground mb-1.5">Option B — User Access Token (quick test)</p>
            <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
              <li>Go to <a href="https://open.feishu.cn/api-explorer/cli_a5b3f3b3b3b3b3b3" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">Feishu API Explorer <ExternalLink className="w-2.5 h-2.5" /></a></li>
              <li>Log in with your Feishu account</li>
              <li>Copy the <strong className="text-foreground">User Access Token</strong> shown at the top</li>
            </ol>
            <p className="text-amber-600 dark:text-amber-400 mt-1.5">⚠ User tokens expire after 2 hours.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  const [wikiUrl, setWikiUrl] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [userToken, setUserToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [authMode, setAuthMode] = useState<"app" | "token">("app");

  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [tree, setTree] = useState<WikiNode[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [domain, setDomain] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("tree");

  const crawlMutation = trpc.wiki.crawl.useMutation({
    onSuccess: (data) => {
      setNodes(data.nodes as WikiNode[]);
      setTree(data.tree as WikiNode[]);
      setSpaceId(data.spaceId);
      setDomain(data.domain);
    },
  });

  const testAuthMutation = trpc.wiki.testAuth.useMutation();

  const handleCrawl = useCallback(() => {
    if (!wikiUrl.trim()) return;
    crawlMutation.mutate({
      url: wikiUrl.trim(),
      appId: authMode === "app" ? appId.trim() || undefined : undefined,
      appSecret: authMode === "app" ? appSecret.trim() || undefined : undefined,
      userAccessToken: authMode === "token" ? userToken.trim() || undefined : undefined,
    });
  }, [wikiUrl, appId, appSecret, userToken, authMode, crawlMutation]);

  const handleExportCsv = useCallback(() => {
    if (!nodes.length) return;
    exportToCsv(nodes, `feishu_wiki_${spaceId || "export"}_${new Date().toISOString().slice(0, 10)}.csv`);
  }, [nodes, spaceId]);

  const hasResults = nodes.length > 0;
  const isLoading = crawlMutation.isPending;
  const error = crawlMutation.error;

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
                {isLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Crawling...</> : <><RefreshCw className="w-3.5 h-3.5" />Crawl</>}
              </Button>
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

            {/* Credentials guide */}
            <CredentialsGuide />
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="py-3">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-sm whitespace-pre-wrap ml-1">{error.message}</AlertDescription>
          </Alert>
        )}

        {/* Loading */}
        {isLoading && (
          <Card className="shadow-sm">
            <CardContent className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Fetching wiki nodes via Feishu API...</p>
              <p className="text-xs text-muted-foreground">Recursively fetching all child nodes. Large wikis may take a moment.</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {hasResults && !isLoading && (
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold">{nodes.length} pages found</span>
                </div>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-muted-foreground font-mono">{domain}</span>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-xs text-muted-foreground">Space: <code className="font-mono">{spaceId}</code></span>
              </div>
              <div className="flex items-center gap-2">
                <TypeStats nodes={nodes} />
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExportCsv}>
                  <Download className="w-3 h-3" /> CSV
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
              <TabsList className="w-fit h-8">
                <TabsTrigger value="tree" className="text-xs gap-1.5 h-7 px-3"><TreePine className="w-3.5 h-3.5" />Tree View</TabsTrigger>
                <TabsTrigger value="table" className="text-xs gap-1.5 h-7 px-3"><Table2 className="w-3.5 h-3.5" />Table View</TabsTrigger>
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
                    <WikiTreeView tree={tree} searchQuery={searchQuery} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="table" className="flex-1 mt-3">
                <Card className="shadow-sm">
                  <CardContent className="pt-4 pb-4" style={{ minHeight: "500px" }}>
                    <WikiTable nodes={nodes} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Empty state */}
        {!hasResults && !isLoading && !error && (
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
                <code className="font-mono">https://company.feishu.cn/wiki/SPACE_TOKEN</code>
                <code className="font-mono">https://company.larksuite.com/wiki/SPACE_TOKEN</code>
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
