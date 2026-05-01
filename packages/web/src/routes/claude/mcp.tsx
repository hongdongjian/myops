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

type InstallType = 'http' | 'sse' | 'stdio';

interface MCPInstallConfig {
  transport?: string;
  target?: string;
  headers?: string[];
  command?: string[];
  env?: Record<string, string>;
}

interface PresetStatus {
  name: string;
  description: string;
  install: MCPInstallConfig;
  installedLocal: boolean;
  installedProject: boolean;
  installedUser: boolean;
}

interface MCPActiveOp {
  name: string;
  action: 'installing' | 'uninstalling';
  startedAt: number;
}

interface MCPListPayload {
  supported: PresetStatus[];
  activeOps: MCPActiveOp[];
  others: { local: string[]; project: string[]; user: string[] };
  otherConfigs: Record<string, MCPInstallConfig>;
}

interface EnvRow {
  key: string;
  value: string;
}

interface MCPForm {
  name: string;
  description: string;
  installType: InstallType;
  target: string;
  headerRows: EnvRow[];
  command: string;
  envRows: EnvRow[];
}

const emptyForm: MCPForm = {
  name: '',
  description: '',
  installType: 'http',
  target: '',
  headerRows: [{ key: '', value: '' }],
  command: '',
  envRows: [{ key: '', value: '' }],
};

function installConfigToForm(name: string, install: MCPInstallConfig): MCPForm {
  if (install.command && install.command.length > 0) {
    const envRows = install.env
      ? Object.entries(install.env).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }];
    return {
      name,
      description: '',
      installType: 'stdio',
      target: '',
      headerRows: [{ key: '', value: '' }],
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
    installType: (install.transport as InstallType) ?? 'http',
    target: install.target ?? '',
    headerRows: headerRows.length > 0 ? headerRows : [{ key: '', value: '' }],
    command: '',
    envRows: [{ key: '', value: '' }],
  };
}

function presetToForm(p: PresetStatus): MCPForm {
  return { ...installConfigToForm(p.name, p.install), description: p.description };
}

function MCPFormFields({
  form,
  onChange,
  lockName,
}: {
  form: MCPForm;
  onChange: (f: MCPForm) => void;
  lockName?: boolean;
}) {
  const update = (patch: Partial<MCPForm>) => onChange({ ...form, ...patch });

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
        <Input
          value={form.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Install Type</Label>
        <Select value={form.installType} onValueChange={(v) => update({ installType: v as InstallType })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="sse">SSE</SelectItem>
            <SelectItem value="stdio">stdio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.installType !== 'stdio' ? (
        <>
          <div className="space-y-1.5">
            <Label>Target URL <span className="text-destructive">*</span></Label>
            <Input
              value={form.target}
              placeholder="https://mcp.example.com/mcp"
              onChange={(e) => update({ target: e.target.value })}
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
                  <Input
                    value={row.key}
                    placeholder="KEY"
                    className="w-2/5"
                    onChange={(e) => setHeaderKey(i, e.target.value)}
                  />
                  <Input
                    value={row.value}
                    placeholder="value"
                    className="flex-1"
                    onChange={(e) => setHeaderVal(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => removeHeader(i)}
                    disabled={form.headerRows.length <= 1}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
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
                  <Input
                    value={row.key}
                    placeholder="KEY"
                    className="w-2/5"
                    onChange={(e) => setEnvKey(i, e.target.value)}
                  />
                  <Input
                    value={row.value}
                    placeholder="value"
                    className="flex-1"
                    onChange={(e) => setEnvVal(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => removeEnv(i)}
                    disabled={form.envRows.length <= 1}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildPayload(form: MCPForm) {
  const env: Record<string, string> = {};
  form.envRows.forEach((r) => { if (r.key.trim()) env[r.key.trim()] = r.value; });
  const headers = form.headerRows
    .filter((r) => r.key.trim() !== '')
    .map((r) => `${r.key.trim()}: ${r.value}`);
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    installType: form.installType,
    target: form.installType !== 'stdio' ? form.target.trim() : undefined,
    headers: form.installType !== 'stdio' && headers.length > 0 ? headers : undefined,
    command: form.installType === 'stdio'
      ? form.command.trim().split(/\s+/).filter(Boolean)
      : undefined,
    env: form.installType === 'stdio' && Object.keys(env).length > 0 ? env : undefined,
  };
}

function validateForm(form: MCPForm, toast: { error: (msg: string) => void }): boolean {
  if (!form.name.trim()) { toast.error('Name is required'); return false; }
  if (form.installType !== 'stdio' && !form.target.trim()) { toast.error('Target URL is required'); return false; }
  if (form.installType === 'stdio' && !form.command.trim()) { toast.error('Command is required'); return false; }
  return true;
}

function installTarget(install: MCPInstallConfig): string {
  if (install.command && install.command.length > 0) return install.command.join(' ');
  return install.target ?? '';
}

export function ClaudeMcp() {
  const qc = useQueryClient();
  const toast = useToast();
  const [addForm, setAddForm] = useState<MCPForm>({ ...emptyForm });
  const [adding, setAdding] = useState(false);
  const [editForm, setEditForm] = useState<MCPForm>({ ...emptyForm });
  const [editing, setEditing] = useState<string | null>(null);
  const [manageForm, setManageForm] = useState<MCPForm>({ ...emptyForm });
  const [managing, setManaging] = useState(false);

  const { data, isLoading, error } = useQuery<MCPListPayload>({
    queryKey: ['claude', 'mcp', 'list'],
    queryFn: () => apiGet<MCPListPayload>('/api/claude/mcp/list'),
    refetchInterval: 3000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['claude', 'mcp', 'list'] });

  const activeOpsMap = new Map<string, 'installing' | 'uninstalling'>(
    (data?.activeOps ?? []).map((op) => [op.name, op.action]),
  );

  const presetInstall = useMutation({
    mutationFn: (name: string) =>
      apiPost('/api/claude/mcp/preset/install', { name, scope: 'user' }),
    onSuccess: () => { toast.success('Installed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const presetRemove = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/mcp/preset/remove', { name, scope: 'all' }),
    onSuccess: () => { toast.success('Uninstalled'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPreset = useMutation({
    mutationFn: (form: MCPForm) => apiPost('/api/claude/mcp/preset/create', buildPayload(form)),
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
    mutationFn: (form: MCPForm) =>
      apiPost<{ reinstalled: Array<{ scope: string; ok: boolean; error: string }> }>(
        '/api/claude/mcp/preset/update',
        buildPayload(form),
      ),
    onSuccess: (data) => {
      const reinstalled = data?.reinstalled ?? [];
      if (reinstalled.length === 0) {
        toast.success('MCP updated');
      } else {
        const failed = reinstalled.filter((r) => !r.ok);
        if (failed.length > 0) {
          toast.error(`Updated but reinstall failed (${failed.map((r) => r.scope).join(', ')})`);
        } else {
          toast.success(`MCP updated and reinstalled (${reinstalled.map((r) => r.scope).join(', ')})`);
        }
      }
      setEditing(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePreset = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/mcp/preset/delete', { name }),
    onSuccess: () => { toast.success('MCP deleted'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCreate = (form: MCPForm) => {
    if (!validateForm(form, toast)) return;
    createPreset.mutate(form);
  };

  const handleUpdate = (form: MCPForm) => {
    if (!validateForm(form, toast)) return;
    updatePreset.mutate(form);
  };

  const openEdit = (p: PresetStatus) => {
    setEditForm(presetToForm(p));
    setEditing(p.name);
  };

  const openManage = (name: string) => {
    const install = data?.otherConfigs?.[name];
    const form = install ? installConfigToForm(name, install) : { ...emptyForm, name };
    setManageForm(form);
    setManaging(true);
  };

  const handleManage = (form: MCPForm) => {
    if (!validateForm(form, toast)) return;
    createPreset.mutate(form);
  };

  const removeOther = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/mcp/remove', { name }),
    onSuccess: () => { toast.success('Removed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

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
            const installedAny = p.installedLocal || p.installedProject || p.installedUser;
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
                    ) : installedAny ? (
                      <Badge className="bg-green-600 text-white">Installed</Badge>
                    ) : (
                      <Badge variant="secondary">Not installed</Badge>
                    )}
                  </div>
                  {p.description ? (
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground font-mono truncate max-w-sm">
                    {installTarget(p.install)}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {installedAny || op === 'installing' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => presetRemove.mutate(p.name)}
                      disabled={!!op}
                    >
                      {op === 'uninstalling' ? 'Uninstalling...' : 'Uninstall'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => presetInstall.mutate(p.name)}
                      disabled={!!op}
                    >
                      Install
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)} disabled={!!op}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Delete MCP preset "${p.name}"?`)) {
                        deletePreset.mutate(p.name);
                      }
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

      {/* Other installed MCPs not in presets */}
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
                    onClick={() => { if (window.confirm(`Remove MCP "${name}"?`)) removeOther.mutate(name); }}
                    disabled={removeOther.isPending}
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
          <MCPFormFields form={addForm} onChange={setAddForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdding(false); setAddForm({ ...emptyForm }); }}>Cancel</Button>
            <Button onClick={() => handleCreate(addForm)} disabled={createPreset.isPending}>
              {createPreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit MCP</DialogTitle></DialogHeader>
          <MCPFormFields form={editForm} onChange={setEditForm} lockName />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => handleUpdate(editForm)} disabled={updatePreset.isPending}>
              {updatePreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage dialog (add unmanaged MCP to presets) */}
      <Dialog open={managing} onOpenChange={(o) => { if (!o) { setManaging(false); setManageForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add to MCP Presets</DialogTitle></DialogHeader>
          <MCPFormFields form={manageForm} onChange={setManageForm} lockName />
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
