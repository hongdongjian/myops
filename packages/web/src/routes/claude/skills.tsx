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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/toast';

interface SkillItem {
  name: string;
  desc: string;
  repo: string;
  skill?: string;
  installed: boolean;
  pending?: string;
  error?: string;
}

interface SkillListPayload {
  skills: SkillItem[];
  others: string[];
}

interface SkillContent {
  name: string;
  content: string;
}

interface SkillForm {
  name: string;
  desc: string;
  repo: string;
  skill: string;
}

const emptyForm: SkillForm = { name: '', desc: '', repo: '', skill: '' };

function SkillFormFields({
  form,
  onChange,
  lockName,
}: {
  form: SkillForm;
  onChange: (f: SkillForm) => void;
  lockName?: boolean;
}) {
  const update = (patch: Partial<SkillForm>) => onChange({ ...form, ...patch });
  return (
    <div className="grid gap-4">
      <div className="space-y-1.5">
        <Label>Name <span className="text-destructive">*</span></Label>
        <Input
          value={form.name}
          placeholder="e.g. superpowers"
          disabled={lockName}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          value={form.desc}
          onChange={(e) => update({ desc: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Repo <span className="text-destructive">*</span></Label>
        <Input
          value={form.repo}
          placeholder="npm-package or https://github.com/org/repo"
          onChange={(e) => update({ repo: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">npm package name or git repo URL</p>
      </div>
      <div className="space-y-1.5">
        <Label>Skill Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          value={form.skill}
          placeholder="specific skill name within repo"
          onChange={(e) => update({ skill: e.target.value })}
        />
      </div>
    </div>
  );
}

function validateSkillForm(form: SkillForm, toast: { error: (msg: string) => void }): boolean {
  if (!form.name.trim()) { toast.error('Name is required'); return false; }
  if (!form.repo.trim()) { toast.error('Repo is required'); return false; }
  return true;
}

function buildSkillPayload(form: SkillForm) {
  return {
    name: form.name.trim(),
    desc: form.desc.trim() || undefined,
    repo: form.repo.trim(),
    skill: form.skill.trim() || undefined,
  };
}

export function ClaudeSkills() {
  const qc = useQueryClient();
  const toast = useToast();

  const [addForm, setAddForm] = useState<SkillForm>({ ...emptyForm });
  const [adding, setAdding] = useState(false);
  const [editForm, setEditForm] = useState<SkillForm>({ ...emptyForm });
  const [editing, setEditing] = useState<string | null>(null);
  const [manageForm, setManageForm] = useState<SkillForm>({ ...emptyForm });
  const [managing, setManaging] = useState(false);
  const [viewing, setViewing] = useState<SkillContent | null>(null);

  const { data, isLoading, error } = useQuery<SkillListPayload>({
    queryKey: ['claude', 'skills'],
    queryFn: () => apiGet<SkillListPayload>('/api/claude/skills/list'),
    refetchInterval: 3000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['claude', 'skills'] });

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/install', { name }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const uninstall = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/uninstall', { name }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSingle = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/update-single', { name }),
    onSuccess: () => { toast.success('Update started'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateAll = useMutation({
    mutationFn: () => apiPost('/api/claude/skills/update'),
    onSuccess: (res: any) => { toast.success(res?.message ?? 'Updated'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPreset = useMutation({
    mutationFn: (form: SkillForm) => apiPost('/api/claude/skills/preset/create', buildSkillPayload(form)),
    onSuccess: () => {
      toast.success('Skill added');
      setAdding(false);
      setAddForm({ ...emptyForm });
      setManaging(false);
      setManageForm({ ...emptyForm });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePreset = useMutation({
    mutationFn: (form: SkillForm) => apiPost('/api/claude/skills/preset/update', buildSkillPayload(form)),
    onSuccess: () => {
      toast.success('Skill updated');
      setEditing(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePreset = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/skills/preset/delete', { name }),
    onSuccess: () => { toast.success('Skill deleted'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = async (name: string) => {
    try {
      const res = await apiGet<SkillContent>(`/api/claude/skills/content?name=${encodeURIComponent(name)}`);
      setViewing(res);
    } catch (e) {
      setViewing({ name, content: `Load failed: ${(e as Error).message}` });
    }
  };

  const openEdit = (s: SkillItem) => {
    setEditForm({ name: s.name, desc: s.desc ?? '', repo: s.repo, skill: s.skill ?? '' });
    setEditing(s.name);
  };

  const openManage = (name: string) => {
    setManageForm({ ...emptyForm, name });
    setManaging(true);
  };

  const otherNames = data?.others ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Skills</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateAll.mutate()}
                disabled={updateAll.isPending}
              >
                {updateAll.isPending ? 'Updating...' : 'Update All'}
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>+ Add Skill</Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
          {isLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
          {(data?.skills ?? []).map((s) => (
            <div
              key={s.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <button
                    className="hover:underline disabled:no-underline"
                    onClick={() => s.installed && !s.pending && view(s.name)}
                    disabled={!s.installed || !!s.pending}
                  >
                    {s.name}
                  </button>
                  {s.pending ? (
                    <Badge variant="secondary">{s.pending}...</Badge>
                  ) : s.installed ? (
                    <Badge className="bg-green-600 text-white">Installed</Badge>
                  ) : (
                    <Badge variant="secondary">Not installed</Badge>
                  )}
                </div>
                {s.desc ? <div className="text-xs text-muted-foreground">{s.desc}</div> : null}
                <div className="text-xs text-muted-foreground font-mono truncate max-w-sm">
                  {s.repo}
                </div>
                {s.error ? <div className="text-xs text-destructive">{s.error}</div> : null}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {s.installed ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateSingle.mutate(s.name)}
                      disabled={!!s.pending}
                    >
                      Update
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => uninstall.mutate(s.name)}
                      disabled={!!s.pending}
                    >
                      Uninstall
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => install.mutate(s.name)}
                    disabled={!!s.pending}
                  >
                    Install
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => openEdit(s)} disabled={!!s.pending}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`Delete skill preset "${s.name}"?`)) {
                      deletePreset.mutate(s.name);
                    }
                  }}
                  disabled={!!s.pending || deletePreset.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!isLoading && (data?.skills ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No skill presets configured</div>
          ) : null}
        </CardContent>
      </Card>

      {otherNames.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Other Installed Skills</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherNames.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2"
              >
                <code className="text-sm">{name}</code>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Uninstall skill "${name}"?`)) {
                        uninstall.mutate(name);
                      }
                    }}
                  >
                    Uninstall
                  </Button>
                  <Button size="sm" onClick={() => openManage(name)}>Manage</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add dialog */}
      <Dialog open={adding} onOpenChange={(o) => { if (!o) { setAdding(false); setAddForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Skill</DialogTitle></DialogHeader>
          <SkillFormFields form={addForm} onChange={setAddForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdding(false); setAddForm({ ...emptyForm }); }}>
              Cancel
            </Button>
            <Button
              onClick={() => { if (validateSkillForm(addForm, toast)) createPreset.mutate(addForm); }}
              disabled={createPreset.isPending}
            >
              {createPreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Skill</DialogTitle></DialogHeader>
          <SkillFormFields form={editForm} onChange={setEditForm} lockName />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => { if (validateSkillForm(editForm, toast)) updatePreset.mutate(editForm); }}
              disabled={updatePreset.isPending}
            >
              {updatePreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage dialog (add unmanaged skill to presets) */}
      <Dialog open={managing} onOpenChange={(o) => { if (!o) { setManaging(false); setManageForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add to Skill Presets</DialogTitle></DialogHeader>
          <SkillFormFields form={manageForm} onChange={setManageForm} lockName />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setManaging(false); setManageForm({ ...emptyForm }); }}>
              Cancel
            </Button>
            <Button
              onClick={() => { if (validateSkillForm(manageForm, toast)) createPreset.mutate(manageForm); }}
              disabled={createPreset.isPending}
            >
              {createPreset.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View skill content dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded border border-border bg-muted/30">
            <pre className="p-3 font-mono text-xs whitespace-pre-wrap">{viewing?.content}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
