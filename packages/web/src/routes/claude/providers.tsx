import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

interface Provider {
  name: string;
  baseUrl: string;
  token: string;
  model: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  env: Record<string, string>;
}

interface ProvidersPayload {
  providers: Provider[];
  activeProvider: string;
}

const BASE_URL_PRESETS = [
  { label: 'DeepSeek', value: 'https://api.deepseek.com/anthropic' },
  { label: 'BigModel', value: 'https://open.bigmodel.cn/api/anthropic' },
  { label: 'Local', value: 'http://localhost:4141' },
];

const empty: Provider = { name: '', baseUrl: '', token: '', model: '', haikuModel: '', sonnetModel: '', opusModel: '', env: {} };

function BaseUrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {BASE_URL_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium border transition-all duration-150',
              value === preset.value
                ? 'border-primary bg-primary/10 text-primary shadow-sm'
                : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/70',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Input
        value={value}
        placeholder="Or enter a custom URL..."
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ClaudeProviders() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery<ProvidersPayload>({
    queryKey: ['claude', 'providers'],
    queryFn: () => apiGet<ProvidersPayload>('/api/claude/providers'),
  });

  const [editing, setEditing] = useState<{ original: string | null; form: Provider } | null>(null);
  const [showToken, setShowToken] = useState(false);

  const add = useMutation({
    mutationFn: (p: Provider) => apiPost('/api/claude/providers/add', p),
    onSuccess: () => {
      setEditing(null);
      toast.success('Added');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ original, p }: { original: string; p: Provider }) =>
      apiPost('/api/claude/providers/update', {
        name: original,
        newName: p.name,
        baseUrl: p.baseUrl,
        token: p.token,
        model: p.model,
        haikuModel: p.haikuModel,
        sonnetModel: p.sonnetModel,
        opusModel: p.opusModel,
        env: p.env,
      }),
    onSuccess: () => {
      setEditing(null);
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/providers/delete', { name }),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/providers/apply', { name }),
    onSuccess: () => {
      toast.success('Applied');
      qc.invalidateQueries({ queryKey: ['claude', 'providers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!editing) return;
    if (!editing.form.name.trim()) {
      toast.error('name is required');
      return;
    }
    if (editing.original) {
      update.mutate({ original: editing.original, p: editing.form });
    } else {
      add.mutate(editing.form);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Providers</span>
          <Button size="sm" onClick={() => setEditing({ original: null, form: { ...empty } })}>
            + Add Provider
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
        {isLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
        {(data?.providers ?? []).map((p) => {
          const active = data?.activeProvider === p.name;
          return (
            <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium">
                  {p.name}
                  {active ? <Badge className="bg-green-600 text-white">Active</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  base: <code>{p.baseUrl || '--'}</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  sonnet: <code>{p.sonnetModel || p.model || '--'}</code> · opus: <code>{p.opusModel || p.model || '--'}</code> · haiku: <code>{p.haikuModel || '--'}</code>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => apply.mutate(p.name)} disabled={apply.isPending}>
                  Apply
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing({ original: p.name, form: { ...p } })}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`Delete provider ${p.name}?`)) del.mutate(p.name);
                  }}
                  disabled={del.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
        {!isLoading && (data?.providers ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No providers</div>
        ) : null}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setShowToken(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.original ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
          </DialogHeader>
          {editing ? (
          <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editing.form.name}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <BaseUrlField
                  value={editing.form.baseUrl}
                  onChange={(v) => setEditing({ ...editing, form: { ...editing.form, baseUrl: v } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={editing.form.token}
                    placeholder="sk-..."
                    className="pr-9"
                    onChange={(e) => setEditing({ ...editing, form: { ...editing.form, token: e.target.value } })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model Mappings</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Opus</Label>
                    <Input
                      value={editing.form.opusModel}
                      placeholder="e.g. deepseek-r1"
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, opusModel: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sonnet</Label>
                    <Input
                      value={editing.form.sonnetModel}
                      placeholder="e.g. deepseek-chat"
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sonnetModel: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Haiku</Label>
                    <Input
                      value={editing.form.haikuModel}
                      placeholder="e.g. deepseek-chat"
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, haikuModel: e.target.value } })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Environment Variables</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-1.5">
                  {Object.entries(editing.form.env ?? {}).map(([k, v], idx) => (
                    <div key={idx} className="flex gap-1.5 items-center">
                      <Input
                        value={k}
                        placeholder="KEY"
                        className="font-mono text-xs flex-1"
                        onChange={(e) => {
                          const newKey = e.target.value;
                          const next: Record<string, string> = {};
                          for (const [ek, ev] of Object.entries(editing.form.env ?? {})) {
                            next[ek === k ? newKey : ek] = ev;
                          }
                          setEditing({ ...editing, form: { ...editing.form, env: next } });
                        }}
                      />
                      <span className="text-muted-foreground text-xs">=</span>
                      <Input
                        value={v}
                        placeholder="value"
                        className="font-mono text-xs flex-1"
                        onChange={(e) =>
                          setEditing({ ...editing, form: { ...editing.form, env: { ...editing.form.env, [k]: e.target.value } } })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...editing.form.env };
                          delete next[k];
                          setEditing({ ...editing, form: { ...editing.form, env: next } });
                        }}
                        className="text-muted-foreground hover:text-destructive transition-colors px-1 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    disabled={'' in (editing.form.env ?? {})}
                    onClick={() =>
                      setEditing({ ...editing, form: { ...editing.form, env: { ...editing.form.env, '': '' } } })
                    }
                  >
                    + Add Variable
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={add.isPending || update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
