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

interface RuleItem {
  name: string;
  installed: boolean;
}

interface RuleListPayload {
  rules: RuleItem[];
}

interface RuleContent {
  name: string;
  content: string;
}

interface RuleForm {
  name: string;
  content: string;
}

const emptyForm: RuleForm = { name: '', content: '' };

export function ClaudeRules() {
  const qc = useQueryClient();
  const toast = useToast();

  const [addForm, setAddForm] = useState<RuleForm>({ ...emptyForm });
  const [adding, setAdding] = useState(false);
  const [editForm, setEditForm] = useState<RuleForm>({ ...emptyForm });
  const [editing, setEditing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<RuleContent | null>(null);

  const { data, isLoading, error } = useQuery<RuleListPayload>({
    queryKey: ['claude', 'rules'],
    queryFn: () => apiGet<RuleListPayload>('/api/claude/rules/list'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['claude', 'rules'] });

  const install = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/rules/install', { name }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const uninstall = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/rules/uninstall', { name }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const createRule = useMutation({
    mutationFn: (form: RuleForm) => apiPost('/api/claude/rules/create', form),
    onSuccess: () => {
      toast.success('Rule created');
      setAdding(false);
      setAddForm({ ...emptyForm });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRule = useMutation({
    mutationFn: (form: RuleForm) => apiPost('/api/claude/rules/update', form),
    onSuccess: () => {
      toast.success('Rule updated');
      setEditing(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRule = useMutation({
    mutationFn: (name: string) => apiPost('/api/claude/rules/delete', { name }),
    onSuccess: () => { toast.success('Rule deleted'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const view = async (name: string) => {
    try {
      const res = await apiGet<RuleContent>(`/api/claude/rules/content?name=${encodeURIComponent(name)}`);
      setViewing(res);
    } catch (e) {
      setViewing({ name, content: `Load failed: ${(e as Error).message}` });
    }
  };

  const openEdit = async (name: string) => {
    try {
      const res = await apiGet<RuleContent>(`/api/claude/rules/content?name=${encodeURIComponent(name)}`);
      setEditForm({ name, content: res.content });
      setEditing(name);
    } catch (e) {
      toast.error(`Failed to load rule: ${(e as Error).message}`);
    }
  };

  const handleCreate = () => {
    if (!addForm.name.trim()) { toast.error('Name is required'); return; }
    createRule.mutate(addForm);
  };

  const handleUpdate = () => {
    updateRule.mutate(editForm);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Rules</span>
          <Button size="sm" onClick={() => setAdding(true)}>+ Add Rule</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <div className="text-xs text-destructive">{(error as Error).message}</div> : null}
        {isLoading ? <div className="text-xs text-muted-foreground">Loading...</div> : null}
        {(data?.rules ?? []).map((r) => (
          <div
            key={r.name}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2"
          >
            <div className="flex items-center gap-2">
              <button className="font-medium hover:underline" onClick={() => view(r.name)}>
                {r.name}
              </button>
              {r.installed
                ? <Badge className="bg-green-600 text-white">Installed</Badge>
                : <Badge variant="secondary">Not installed</Badge>}
            </div>
            <div className="flex gap-2">
              {r.installed ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => uninstall.mutate(r.name)}
                  disabled={uninstall.isPending}
                >
                  Uninstall
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => install.mutate(r.name)}
                  disabled={install.isPending}
                >
                  Install
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => openEdit(r.name)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Delete rule "${r.name}"?`)) deleteRule.mutate(r.name);
                }}
                disabled={deleteRule.isPending}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
        {!isLoading && (data?.rules ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No rules available</div>
        ) : null}
      </CardContent>

      {/* Add dialog */}
      <Dialog open={adding} onOpenChange={(o) => { if (!o) { setAdding(false); setAddForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Rule</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={addForm.name}
                placeholder="e.g. coding-style.md"
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <textarea
                className="w-full min-h-[300px] rounded border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                value={addForm.content}
                placeholder="# Rule content (Markdown)"
                onChange={(e) => setAddForm({ ...addForm, content: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAdding(false); setAddForm({ ...emptyForm }); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createRule.isPending}>
              {createRule.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Rule: {editing}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <textarea
              className="w-full min-h-[300px] rounded border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateRule.isPending}>
              {updateRule.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
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
    </Card>
  );
}
