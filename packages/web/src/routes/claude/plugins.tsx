import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PluginPresetStatus {
  name: string;
  description: string;
  package: string;
  marketplace: string;
  scope: string;
  marketplaceConfigured: boolean;
  installed: boolean;
  enabled: boolean;
  autoStart: boolean;
  version?: string;
  link?: string;
}

interface InstalledPlugin {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
}

interface MarketplaceItem {
  name: string;
  source?: string;
  repo?: string;
  url?: string;
  installLocation?: string;
}

interface PluginsPayload {
  path: string;
  supported: PluginPresetStatus[];
  installed: InstalledPlugin[];
  marketplaces: MarketplaceItem[];
  others: string[];
}

export function ClaudePlugins() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<PluginsPayload>({
    queryKey: ['claude', 'plugins'],
    queryFn: () => apiGet<PluginsPayload>('/api/claude/plugins'),
    refetchInterval: 10000,
  });

  const install = useMutation({
    mutationFn: (pkg: string) => apiPost('/api/claude/plugins/install', { package: pkg }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'plugins'] }),
  });
  const enable = useMutation({
    mutationFn: (pkg: string) => apiPost('/api/claude/plugins/enable', { package: pkg }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'plugins'] }),
  });
  const disable = useMutation({
    mutationFn: (pkg: string) => apiPost('/api/claude/plugins/disable', { package: pkg }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'plugins'] }),
  });
  const uninstall = useMutation({
    mutationFn: (pkg: string) => apiPost('/api/claude/plugins/uninstall', { package: pkg }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude', 'plugins'] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>预置插件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">加载中...</div> : null}
          {(data?.supported ?? []).map((p) => (
            <div key={p.package} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium">
                  {p.link ? (
                    <a href={p.link} target="_blank" rel="noreferrer" className="hover:underline">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                  {p.installed ? (
                    p.enabled ? (
                      <Badge className="bg-green-600 text-white">已启用</Badge>
                    ) : (
                      <Badge variant="secondary">已安装</Badge>
                    )
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
                <div className="text-xs text-muted-foreground">
                  <code>{p.package}</code> · scope: {p.scope}
                  {p.version ? ` · v${p.version}` : ''}
                  {p.marketplaceConfigured ? '' : ` · marketplace[${p.marketplace}] 未配置`}
                </div>
              </div>
              <div className="flex gap-2">
                {!p.installed ? (
                  <Button size="sm" onClick={() => install.mutate(p.package)} disabled={install.isPending}>
                    安装
                  </Button>
                ) : (
                  <>
                    {p.enabled ? (
                      <Button size="sm" variant="outline" onClick={() => disable.mutate(p.package)} disabled={disable.isPending}>
                        禁用
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => enable.mutate(p.package)} disabled={enable.isPending}>
                        启用
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => uninstall.mutate(p.package)} disabled={uninstall.isPending}>
                      卸载
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!isLoading && (data?.supported ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">无预置插件</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>已安装插件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.installed ?? []).map((p) => (
            <div key={`${p.id}-${p.scope}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-sm">
              <div>
                <code>{p.id}</code>
                {p.version ? <span className="ml-2 text-xs text-muted-foreground">v{p.version}</span> : null}
                <span className="ml-2 text-xs text-muted-foreground">scope: {p.scope}</span>
              </div>
              {p.enabled ? (
                <Badge className="bg-green-600 text-white">已启用</Badge>
              ) : (
                <Badge variant="secondary">已禁用</Badge>
              )}
            </div>
          ))}
          {(data?.installed ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">无已安装插件</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>市场源</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.marketplaces ?? []).map((m) => (
            <div key={m.name} className="rounded border border-border p-2 text-sm">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-muted-foreground">
                {m.source || m.url || m.repo || '--'}
              </div>
            </div>
          ))}
          {(data?.marketplaces ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">未配置市场源</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
