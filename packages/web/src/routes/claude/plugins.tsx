import { useState } from 'react';
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

type PluginOpAction = 'installing' | 'enabling' | 'disabling' | 'updating' | 'uninstalling';

interface PluginActiveOp {
  package: string;
  action: PluginOpAction;
  startedAt: number;
}

interface PluginPresetStatus {
  name: string;
  description: string;
  package: string;
  marketplace: string;
  scope: string;
  source?: string;
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
}

interface PluginsPayload {
  supported: PluginPresetStatus[];
  installed: InstalledPlugin[];
  others: string[];
  activeOps: PluginActiveOp[];
}

interface PresetForm {
  name: string;
  package: string;
  description: string;
  source: string;
  link: string;
}

const emptyForm: PresetForm = { name: '', package: '', description: '', source: '', link: '' };

const actionLabel: Record<PluginOpAction, string> = {
  installing: 'Installing...',
  enabling: 'Enabling...',
  disabling: 'Disabling...',
  updating: 'Updating...',
  uninstalling: 'Uninstalling...',
};

function PresetDialog({
  open,
  title,
  form,
  onChange,
  onSubmit,
  onClose,
  isPending,
  lockPackage,
}: {
  open: boolean;
  title: string;
  form: PresetForm;
  onChange: (f: PresetForm) => void;
  onSubmit: () => void;
  onClose: () => void;
  isPending: boolean;
  lockPackage?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.name}
              placeholder="e.g. My Plugin"
              onChange={(e) => onChange({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Package</Label>
            <Input
              value={form.package}
              placeholder="plugin-name@marketplace"
              disabled={lockPackage}
              onChange={(e) => onChange({ ...form, package: e.target.value })}
            />
            {!lockPackage && (
              <p className="text-xs text-muted-foreground">Format: <code>plugin-id@marketplace-name</code></p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Marketplace Source <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.source}
              placeholder="https://..."
              onChange={(e) => onChange({ ...form, source: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Link <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              value={form.link}
              placeholder="https://..."
              onChange={(e) => onChange({ ...form, link: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClaudePlugins() {
  const qc = useQueryClient();
  const toast = useToast();

  const [addForm, setAddForm] = useState<PresetForm>({ ...emptyForm });
  const [adding, setAdding] = useState(false);

  const [editForm, setEditForm] = useState<PresetForm>({ ...emptyForm });
  const [editing, setEditing] = useState<string | null>(null); // package being edited

  const [manageForm, setManageForm] = useState<PresetForm>({ ...emptyForm });
  const [managing, setManaging] = useState(false);

  const { data, isLoading, error } = useQuery<PluginsPayload>({
    queryKey: ['claude', 'plugins'],
    queryFn: () => apiGet<PluginsPayload>('/api/claude/plugins'),
    refetchInterval: 3000,
  });

  const activeOpsMap = new Map<string, PluginOpAction>(
    (data?.activeOps ?? []).map((op) => [op.package, op.action]),
  );

  // user-scope installed but not managed
  const managedSet = new Set((data?.supported ?? []).map((p) => p.package));
  const otherPlugins = (data?.installed ?? []).filter(
    (p) => p.scope === 'user' && !managedSet.has(p.id),
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ['claude', 'plugins'] });

  const mkMutation = (endpoint: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useMutation({
      mutationFn: (pkg: string) => apiPost(endpoint, { package: pkg }),
      onSuccess: refresh,
      onError: (e: Error) => toast.error(e.message),
    });

  const install = mkMutation('/api/claude/plugins/install');
  const enable = mkMutation('/api/claude/plugins/enable');
  const disable = mkMutation('/api/claude/plugins/disable');
  const update = mkMutation('/api/claude/plugins/update');
  const uninstall = mkMutation('/api/claude/plugins/uninstall');

  const removePreset = useMutation({
    mutationFn: (pkg: string) => apiPost('/api/claude/plugins/remove-preset', { package: pkg }),
    onSuccess: () => { toast.success('Plugin removed'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPreset = useMutation({
    mutationFn: (f: PresetForm) => apiPost('/api/claude/plugins/add-preset', f),
    onSuccess: () => {
      setAdding(false);
      setAdding(false);
      setAddForm({ ...emptyForm });
      toast.success('Plugin added');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePreset = useMutation({
    mutationFn: (f: PresetForm) => apiPost('/api/claude/plugins/update-preset', f),
    onSuccess: () => {
      setEditing(null);
      toast.success('Plugin updated');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managePreset = useMutation({
    mutationFn: (f: PresetForm) => apiPost('/api/claude/plugins/add-preset', f),
    onSuccess: () => {
      setManaging(false);
      setManageForm({ ...emptyForm });
      toast.success('Plugin added to managed');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAdd = () => {
    if (!addForm.name.trim()) { toast.error('name is required'); return; }
    if (!addForm.package.trim()) { toast.error('package is required'); return; }
    addPreset.mutate(addForm);
  };

  const handleEdit = () => {
    if (!editForm.name.trim()) { toast.error('name is required'); return; }
    updatePreset.mutate(editForm);
  };

  const handleManage = () => {
    if (!manageForm.name.trim()) { toast.error('name is required'); return; }
    if (!manageForm.package.trim()) { toast.error('package is required'); return; }
    managePreset.mutate(manageForm);
  };

  const openEdit = (p: PluginPresetStatus) => {
    setEditForm({ name: p.name, package: p.package, description: p.description, source: p.source ?? '', link: p.link ?? '' });
    setEditing(p.package);
  };

  const openManage = (p: InstalledPlugin) => {
    setManageForm({ name: p.id, package: p.id, description: '', source: '', link: '' });
    setManaging(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Plugins</span>
            <Button size="sm" onClick={() => setAdding(true)}>+ Add Plugin</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
          {(data?.supported ?? []).map((p) => {
            const op = activeOpsMap.get(p.package);
            return (
              <div key={p.package} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-medium">
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer" className="hover:underline">{p.name}</a>
                    ) : p.name}
                    {p.installed ? (
                      p.enabled
                        ? <Badge className="bg-green-600 text-white">Enabled</Badge>
                        : <Badge variant="secondary">Installed</Badge>
                    ) : null}
                  </div>
                  {p.description ? <div className="text-xs text-muted-foreground">{p.description}</div> : null}
                  <div className="text-xs text-muted-foreground">
                    <code>{p.package}</code>
                    {p.version ? ` · v${p.version}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!p.installed ? (
                    <Button size="sm" onClick={() => install.mutate(p.package)} disabled={!!op}>
                      {op === 'installing' ? actionLabel.installing : 'Install'}
                    </Button>
                  ) : (
                    <>
                      {p.enabled ? (
                        <Button size="sm" variant="outline" onClick={() => disable.mutate(p.package)} disabled={!!op}>
                          {op === 'disabling' ? actionLabel.disabling : 'Disable'}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => enable.mutate(p.package)} disabled={!!op}>
                          {op === 'enabling' ? actionLabel.enabling : 'Enable'}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => update.mutate(p.package)} disabled={!!op}>
                        {op === 'updating' ? actionLabel.updating : 'Update'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => uninstall.mutate(p.package)} disabled={!!op}>
                        {op === 'uninstalling' ? actionLabel.uninstalling : 'Uninstall'}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)} disabled={!!op}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Remove plugin preset "${p.name}"?`)) removePreset.mutate(p.package);
                    }}
                    disabled={!!op || removePreset.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
          {!isLoading && (data?.supported ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No plugins configured</div>
          ) : null}
        </CardContent>
      </Card>

      {otherPlugins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Other Installed (user scope)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherPlugins.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                <div className="flex items-center gap-2">
                  <code className="text-sm">{p.id}</code>
                  {p.version ? <span className="text-xs text-muted-foreground">v{p.version}</span> : null}
                  {p.enabled
                    ? <Badge className="bg-green-600 text-white">Enabled</Badge>
                    : <Badge variant="secondary">Disabled</Badge>}
                </div>
                <Button size="sm" onClick={() => openManage(p)}>
                  Manage
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add dialog */}
      <PresetDialog
        open={adding}
        title="Add Plugin"
        form={addForm}
        onChange={setAddForm}
        onSubmit={handleAdd}
        onClose={() => { setAdding(false); setAddForm({ ...emptyForm }); }}
        isPending={addPreset.isPending}
      />

      {/* Edit dialog */}
      <PresetDialog
        open={!!editing}
        title="Edit Plugin"
        form={editForm}
        onChange={setEditForm}
        onSubmit={handleEdit}
        onClose={() => setEditing(null)}
        isPending={updatePreset.isPending}
        lockPackage
      />

      {/* Manage (add unmanaged to presets) dialog */}
      <PresetDialog
        open={managing}
        title="Add to Managed Plugins"
        form={manageForm}
        onChange={setManageForm}
        onSubmit={handleManage}
        onClose={() => { setManaging(false); setManageForm({ ...emptyForm }); }}
        isPending={managePreset.isPending}
        lockPackage
      />
    </div>
  );
}
