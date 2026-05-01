import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, BookOpen, AlertTriangle, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useStatusPolling } from '@/lib/use-status-polling';
import { renderMarkdown } from '@/lib/render-markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/status-badge';
import { LogPanel } from '@/components/log-panel';
import { FilePicker } from '@/components/file-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/toast';

interface XHSStatus {
  process?: { running?: boolean; pid?: number };
  health?: { healthy?: boolean; state?: string; error?: string };
  auth?: { hasCookie?: boolean; cookieFile?: string; actionLabel?: string };
  package?: { loginBinaryExists?: boolean; serverBinaryExists?: boolean };
}

interface AutostartState {
  enabled: boolean;
}

interface BinaryConfig {
  loginBinaryPath: string;
  serverBinaryPath: string;
}

interface CommandResult {
  stdout?: string;
  stderr?: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

export function XiaohongshuPanel() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: status } = useStatusPolling<XHSStatus>(
    ['mcp', 'status'],
    '/api/mcp/xiaohongshu/status',
    2000,
  );
  const { data: autostart } = useQuery<AutostartState>({
    queryKey: ['mcp', 'autostart'],
    queryFn: () => apiGet<AutostartState>('/api/mcp/xiaohongshu/autostart'),
  });
  const { data: binaryConfig } = useQuery<BinaryConfig>({
    queryKey: ['mcp', 'config'],
    queryFn: () => apiGet<BinaryConfig>('/api/mcp/xiaohongshu/config'),
  });

  const running = !!status?.process?.running;
  const loggedIn = !!status?.auth?.hasCookie;
  const serverConfigured = !!binaryConfig?.serverBinaryPath;
  const loginConfigured = !!binaryConfig?.loginBinaryPath;

  const [loginDialog, setLoginDialog] = useState<CommandResult | null>(null);
  const [configDialog, setConfigDialog] = useState(false);
  const [loginPathInput, setLoginPathInput] = useState('');
  const [serverPathInput, setServerPathInput] = useState('');
  const [filePicker, setFilePicker] = useState<{ open: boolean; field: 'login' | 'server' }>({ open: false, field: 'login' });

  const openConfig = () => {
    setLoginPathInput(binaryConfig?.loginBinaryPath ?? '');
    setServerPathInput(binaryConfig?.serverBinaryPath ?? '');
    setConfigDialog(true);
  };

  const openFilePicker = (field: 'login' | 'server') => {
    setFilePicker({ open: true, field });
  };

  const handleFileSelect = (path: string) => {
    if (filePicker.field === 'login') setLoginPathInput(path);
    else setServerPathInput(path);
  };

  const start = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const restart = useMutation({
    mutationFn: () => apiPost('/api/mcp/xiaohongshu/restart'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const setAutostart = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost<AutostartState>('/api/mcp/xiaohongshu/autostart/set', { enabled }),
    onSuccess: (data) => qc.setQueryData(['mcp', 'autostart'], data),
  });
  const login = useMutation({
    mutationFn: () => apiPost<CommandResult>('/api/mcp/xiaohongshu/login'),
    onSuccess: (data) => setLoginDialog(data),
    onError: (e: Error) => setLoginDialog({ stderr: e.message }),
  });
  const saveConfig = useMutation({
    mutationFn: () =>
      apiPost<BinaryConfig>('/api/mcp/xiaohongshu/config/save', {
        loginBinaryPath: loginPathInput,
        serverBinaryPath: serverPathInput,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['mcp', 'config'], data);
      setConfigDialog(false);
      toast.success('Config saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startDisabled = start.isPending || stop.isPending || (!running && (!serverConfigured || !loggedIn));
  const restartDisabled = !running || restart.isPending || !serverConfigured || !loggedIn;
  const loginDisabled = login.isPending || !loginConfigured;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <span>Xiaohongshu MCP</span>
                <StatusBadge running={running} />
                {status?.health?.error ? (
                  <span className="text-xs text-destructive">{status.health.error}</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={running ? 'outline' : 'default'}
                    onClick={() => running ? stop.mutate() : start.mutate()}
                    disabled={startDisabled}
                  >
                    {start.isPending || stop.isPending ? 'Working...' : running ? 'Stop' : 'Start'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restart.mutate()}
                    disabled={restartDisabled}
                  >
                    {restart.isPending ? 'Restarting...' : 'Restart'}
                  </Button>
                </div>

                <div className="flex items-center gap-2 border-l border-border pl-6">
                  <Label className="text-sm">Auto-start</Label>
                  <Switch
                    checked={!!autostart?.enabled}
                    onCheckedChange={(v) => setAutostart.mutate(v)}
                    disabled={setAutostart.isPending}
                  />
                </div>

                <div className="flex items-center gap-2 border-l border-border pl-6">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => login.mutate()}
                    disabled={loginDisabled}
                  >
                    {login.isPending ? 'Logging in...' : status?.auth?.actionLabel || 'Login'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={openConfig}>
                    Config
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Auth: {loggedIn ? 'Logged in' : 'Not logged in'}</span>
                <span>Login binary: {loginConfigured ? '✓' : 'not configured'}</span>
                <span>Server binary: {serverConfigured ? '✓' : 'not configured'}</span>
              </div>
            </CardContent>
          </Card>

          <ReleasesPanel />
        </TabsContent>

        <TabsContent value="log" className="space-y-0 pt-4">
          <Card>
            <CardContent className="pt-4">
              <LogPanel path="/api/mcp/xiaohongshu/logs?lines=300" clearPath="/api/mcp/xiaohongshu/logs/clear" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!loginDialog} onOpenChange={(o) => !o && setLoginDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Login Result</DialogTitle></DialogHeader>
          <pre className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {loginDialog?.stdout || ''}{loginDialog?.stderr ? `\n${loginDialog.stderr}` : ''}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={configDialog} onOpenChange={(o) => !o && setConfigDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Binary Config</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Login Binary Path</Label>
              <div className="flex gap-2">
                <Input
                  value={loginPathInput}
                  onChange={(e) => setLoginPathInput(e.target.value)}
                  placeholder="Select login binary..."
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="outline" className="shrink-0 px-2" onClick={() => openFilePicker('login')}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Server Binary Path</Label>
              <div className="flex gap-2">
                <Input
                  value={serverPathInput}
                  onChange={(e) => setServerPathInput(e.target.value)}
                  placeholder="Select server binary..."
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="outline" className="shrink-0 px-2" onClick={() => openFilePicker('server')}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfigDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
              {saveConfig.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FilePicker
        open={filePicker.open}
        onOpenChange={(o) => setFilePicker((prev) => ({ ...prev, open: o }))}
        onSelect={handleFileSelect}
        title={filePicker.field === 'login' ? 'Select Login Binary' : 'Select Server Binary'}
        initialPath={filePicker.field === 'login' ? loginPathInput : serverPathInput}
      />
    </div>
  );
}

function ReleasesPanel() {
  const { data, isLoading, error } = useQuery<GithubRelease[]>({
    queryKey: ['mcp', 'releases'],
    queryFn: () => apiGet<GithubRelease[]>('/api/mcp/xiaohongshu/releases'),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center gap-2 border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span>Releases</span>
        </CardTitle>
        <a href="https://github.com/xpzouying/xiaohongshu-mcp/releases" target="_blank" rel="noopener noreferrer" className="ml-auto font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground">
          github ↗
        </a>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading releases…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{(error as Error).message}</span>
          </div>
        )}
        {data && data.length > 0 && (
          <div className="max-h-[480px] overflow-y-auto pr-1 space-y-4">
            {data.map((release) => (
              <div key={release.tag_name} className="space-y-1.5 border-b border-border/40 pb-4 last:border-0 last:pb-0">
                <div className="flex items-baseline gap-2">
                  <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-semibold hover:underline">
                    {release.name || release.tag_name}
                  </a>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    {new Date(release.published_at).toLocaleDateString()}
                  </span>
                </div>
                {release.body ? <div className="space-y-1">{renderMarkdown(release.body.trim())}</div> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
