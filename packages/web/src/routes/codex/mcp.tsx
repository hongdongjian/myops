import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast';

type InstallType = 'http' | 'stdio';

interface CodexInstallConfig {
  url?: string;
  command?: string[];
  env?: Record<string, string>;
  headers?: string[];
  bearerTokenEnvVar?: string;
}

interface CodexMCPPresetStatus {
  name: string;
  description: string;
  install: CodexInstallConfig;
  installed: boolean;
}

interface CodexMCPActiveOp {
  name: string;
  action: 'installing' | 'uninstalling';
  startedAt: number;
}

interface CodexMCPListPayload {
  supported: CodexMCPPresetStatus[];
  activeOps: CodexMCPActiveOp[];
  others: { user: string[] };
  otherConfigs?: Record<string, CodexInstallConfig>;
}

interface EnvRow {
  key: string;
  value: string;
}

interface CodexMCPForm {
  name: string;
  description: string;
  installType: InstallType;
  url: string;
  headerRows: EnvRow[];
  bearerTokenEnvVar: string;
  command: string;
  envRows: EnvRow[];
}

const emptyForm: CodexMCPForm = {
  name: '',
  description: '',
  installType: 'http',
  url: '',
  headerRows: [{ key: '', value: '' }],
  bearerTokenEnvVar: '',
  command: '',
  envRows: [{ key: '', value: '' }],
};

function installTarget(install: CodexInstallConfig): string {
  if (install.command && install.command.length > 0) return install.command.join(' ');
  return install.url ?? '';
}

function CodexMCPFormFields({
  form,
  onChange,
  lockName,
}: {
  form: CodexMCPForm;
  onChange: (f: CodexMCPForm) => void;
  lockName?: boolean;
}) {
  const update = (patch: Partial<CodexMCPForm>) => onChange({ ...form, ...patch });

  const addHeader = () => update({ headerRows: [...form.headerRows, { key: '', value: '' }] });
  const removeHeader = (i: number) =>
    update({ headerRows: form.headerRows.filter((_, idx) => idx !== i) });
  const setHeaderKey = (i: number, key: string) =>
    update({ headerRows: form.headerRows.map((r, idx) => (idx === i ? { ...r, key } : r)) });
  const setHeaderVal = (i: number, value: string) =>
    update({ headerRows: form.headerRows.map((r, idx) => (idx === i ? { ...r, value } : r)) });

  const addEnv = () => update({ envRows: [...form.envRows, { key: '', value: '' }] });
  const removeEnv = (i: number) =>
    update({ envRows: form.envRows.filter((_, idx) => idx !== i) });
  const setEnvKey = (i: number, key: string) =>
    update({ envRows: form.envRows.map((r, idx) => (idx === i ? { ...r, key } : r)) });
  const setEnvVal = (i: number, value: string) =>
    update({ envRows: form.envRows.map((r, idx) => (idx === i ? { ...r, value } : r)) });

  return (
    <div className="grid gap-4">
      <div className="space-y-1.5">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input
          value={form.name}
          placeholder="e.g. context7-mcp"
          disabled={lockName}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input value={form.description} onChange={(e) => update({ description: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Install Type</Label>
        <Select value={form.installType} onValueChange={(v) => update({ installType: v as InstallType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="stdio">stdio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.installType !== 'stdio' ? (
        <>
          <div className="space-y-1.5">
            <Label>URL <span className="text-destructive">*</span></Label>
            <Input
              value={form.url}
              placeholder="https://mcp.example.com/mcp"
              onChange={(e) => update({ url: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Headers <span className="text-muted-foreground font-normal">(optional)</span></span>
              <Button type="button" size="sm" variant="outline" onClick={addHeader}>+ Add</Button>
            </Label>
            <div className="space-y-1.5">
              {form.headerRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={row.key} placeholder="KEY" className="w-2/5" onChange={(e) => setHeaderKey(i, e.target.value)} />
                  <Input value={row.value} placeholder="value" className="flex-1" onChange={(e) => setHeaderVal(i, e.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={() => removeHeader(i)} disabled={form.headerRows.length <= 1}>×</Button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Bearer Token Env Var <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.bearerTokenEnvVar}
              placeholder="e.g. MY_API_KEY"
              onChange={(e) => update({ bearerTokenEnvVar: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>Command <span className="text-destructive">*</span></Label>
            <Input
              value={form.command}
              placeholder="npx -y @notionhq/notion-mcp-server"
              onChange={(e) => update({ command: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Space-separated arguments</p>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>Environment Variables <span className="text-muted-foreground font-normal">(optional)</span></span>
              <Button type="button" size="sm" variant="outline" onClick={addEnv}>+ Add</Button>
            </Label>
            <div className="space-y-1.5">
              {form.envRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={row.key} placeholder="KEY" className="w-2/5" onChange={(e) => setEnvKey(i, e.target.value)} />
                  <Input value={row.value} placeholder="value" className="flex-1" onChange={(e) => setEnvVal(i, e.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={() => removeEnv(i)} disabled={form.envRows.length <= 1}>×</Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildCodexPayload(form: CodexMCPForm) {
  const env: Record<string, string> = {};
  form.envRows.forEach((r) => { if (r.key.trim()) env[r.key.trim()] = r.value; });
  const headers = form.headerRows
    .filter((r) => r.key.trim() !== '')
    .map((r) => `${r.key.trim()}: ${r.value}`);
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    installType: form.installType,
    url: form.installType !== 'stdio' ? form.url.trim() : undefined,
    headers: form.installType !== 'stdio' && headers.length > 0 ? headers : undefined,
    bearerTokenEnvVar: form.installType !== 'stdio' && form.bearerTokenEnvVar.trim()
      ? form.bearerTokenEnvVar.trim()
      : undefined,
    command: form.installType === 'stdio'
      ? form.command.trim().split(/\s+/).filter(Boolean)
      : undefined,
    env: form.installType === 'stdio' && Object.keys(env).length > 0 ? env : undefined,
  };
}

function validateCodexForm(form: CodexMCPForm, toast: { error: (msg: string) => void }): boolean {
  if (!form.name.trim()) { toast.error('Name is required'); return false; }
  if (form.installType !== 'stdio' && !form.url.trim()) { toast.error('URL is required'); return false; }
  if (form.installType === 'stdio' && !form.command.trim()) { toast.error('Command is required'); return false; }
  return true;
}

function installConfigToForm(name: string, install: CodexInstallConfig): CodexMCPForm {
  if (install.command && install.command.length > 0) {
    const envRows = install.env
      ? Object.entries(install.env).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }];
    return {
      name,
      description: '',
      installType: 'stdio',
      url: '',
      headerRows: [{ key: '', value: '' }],
      bearerTokenEnvVar: '',
      command: install.command.join(' '),
      envRows: envRows.length > 0 ? envRows : [{ key: '', value: '' }],
    };
  }
  const headerRows = (install.headers ?? []).map((h) => {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) return { key: h.trim(), value: '' };
    return { key: h.slice(0, colonIdx).trim(), value: h.slice(colonIdx + 1).trim() };
  });
  return {
    name,
    description: '',
    installType: 'http',
    url: install.url ?? '',
    headerRows: headerRows.length > 0 ? headerRows : [{ key: '', value: '' }],
    bearerTokenEnvVar: install.bearerTokenEnvVar ?? '',
    command: '',
    envRows: [{ key: '', value: '' }],
  };
}

export function CodexMcp() {
  const qc = useQueryClient();
  const toast = useToast();

  const [addForm, setAddForm] = useState<CodexMCPForm>({ ...emptyForm });
  const [adding, setAdding] = useState(false);
  const [editForm, setEditForm] = useState<CodexMCPForm>({ ...emptyForm });
  const [editing, setEditing] = useState<string | null>(null);
  const [manageForm, setManageForm] = useState<CodexMCPForm>({ ...emptyForm });
  const [managing, setManaging] = useState(false);

  const { data, isLoading, error } = useQuery<CodexMCPListPayload>({
    queryKey: ['codex', 'mcp', 'list'],
    queryFn: () => apiGet<CodexMCPListPayload>('/api/codex/mcp/list'),
    refetchInterval: 3000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['codex', 'mcp', 'list'] });

  const activeOpsMap = new Map<string, 'installing' | 'uninstalling'>(
    (data?.activeOps ?? []).map((op) => [op.name, op.action]),
  );

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/mcp/preset/install', { name }),
    onSuccess: () => { toast.success('Installed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/mcp/preset/remove', { name }),
    onSuccess: () => { toast.success('Uninstalled'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPreset = useMutation({
    mutationFn: (form: CodexMCPForm) => apiPost('/api/codex/mcp/preset/create', buildCodexPayload(form)),
    onSuccess: () => {
      toast.success('MCP added');
      setAdding(false);
      setAddForm({ ...emptyForm });
      setManaging(false);
      setManageForm({ ...emptyForm });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePreset = useMutation({
    mutationFn: (form: CodexMCPForm) =>
      apiPost<{ reinstalled: boolean; reinstallError: string }>('/api/codex/mcp/preset/update', buildCodexPayload(form)),
    onSuccess: (data) => {
      if (!data?.reinstalled && !data?.reinstallError) {
        toast.success('MCP updated');
      } else if (data?.reinstallError) {
        toast.error(`Updated but reinstall failed: ${data.reinstallError}`);
      } else {
        toast.success('MCP updated and reinstalled');
      }
      setEditing(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePreset = useMutation({
    mutationFn: (name: string) => apiPost('/api/codex/mcp/preset/delete', { name }),
    onSuccess: () => { toast.success('MCP deleted'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (p: CodexMCPPresetStatus) => {
    setEditForm({ ...installConfigToForm(p.name, p.install), description: p.description });
    setEditing(p.name);
  };

  const openManage = (name: string) => {
    const install = data?.otherConfigs?.[name];
    const form = install ? installConfigToForm(name, install) : { ...emptyForm, name };
    setManageForm(form);
    setManaging(true);
  };

  const handleManage = (form: CodexMCPForm) => {
    if (!validateCodexForm(form, toast)) return;
    createPreset.mutate(form);
  };

  const otherNames = [...(data?.others?.user ?? [])].sort();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>MCP</span>
            <Button size="sm" onClick={() => setAdding(true)}>+ Add MCP</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
          {(data?.supported ?? []).map((p) => {
            const op = activeOpsMap.get(p.name);
            return (
              <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {p.name}
                    {op === 'installing' ? (
                      <Badge variant="secondary">Installing...</Badge>
                    ) : op === 'uninstalling' ? (
                      <Badge variant="secondary">Uninstalling...</Badge>
                    ) : p.installed ? (
                      <Badge className="bg-green-600 text-white">Installed</Badge>
                    ) : (
                      <Badge variant="secondary">Not installed</Badge>
                    )}
                  </div>
                  {p.description ? <div className="text-xs text-muted-foreground">{p.description}</div> : null}
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-sm">
                    {installTarget(p.install)}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {p.installed || op === 'installing' ? (
                    <Button size="sm" variant="outline" onClick={() => remove.mutate(p.name)} disabled={!!op}>
                      {op === 'uninstalling' ? 'Uninstalling...' : 'Uninstall'}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => install.mutate(p.name)} disabled={!!op}>
                      Install
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)} disabled={!!op}>Edit</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Delete MCP preset "${p.name}"?`)) deletePreset.mutate(p.name);
                    }}
                    disabled={!!op || deletePreset.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
          {!isLoading && (data?.supported ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No MCP presets configured</div>
          ) : null}
        </CardContent>
      </Card>

      {otherNames.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Other Installed MCPs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherNames.map((name) => (
              <div key={name} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2">
                <code className="text-sm">{name}</code>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openManage(name)}>Manage</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { if (window.confirm(`Remove MCP "${name}"?`)) remove.mutate(name); }}
                    disabled={remove.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add dialog */}
      <Dialog open={adding} onOpenChange={(o) => { if (!o) { setAdding(false); setAddForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add MCP</DialogTitle></DialogHeader>
          <CodexMCPFormFields form={addForm} onChange={setAddForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdding(false); setAddForm({ ...emptyForm }); }}>Cancel</Button>
            <Button onClick={() => { if (validateCodexForm(addForm, toast)) createPreset.mutate(addForm); }} disabled={createPreset.isPending}>
              {createPreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit MCP</DialogTitle></DialogHeader>
          <CodexMCPFormFields form={editForm} onChange={setEditForm} lockName />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (validateCodexForm(editForm, toast)) updatePreset.mutate(editForm); }} disabled={updatePreset.isPending}>
              {updatePreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage dialog (add unmanaged MCP to presets) */}
      <Dialog open={managing} onOpenChange={(o) => { if (!o) { setManaging(false); setManageForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add to MCP Presets</DialogTitle></DialogHeader>
          <CodexMCPFormFields form={manageForm} onChange={setManageForm} lockName />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setManaging(false); setManageForm({ ...emptyForm }); }}>Cancel</Button>
            <Button onClick={() => handleManage(manageForm)} disabled={createPreset.isPending}>
              {createPreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
