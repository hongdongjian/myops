import { useEffect, useState } from 'react';
import YAML from 'yaml';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ClashProxy extends Record<string, unknown> {
  name: string;
}

interface ProxyDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: ClashProxy | null;
  onSubmit: (p: ClashProxy) => void;
}

const PLACEHOLDER = `name: "日本自建节点"
type: vmess
server: example.com
port: 443
uuid: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
alterId: 0
cipher: auto
tls: true
skip-cert-verify: true
network: ws
ws-opts:
  path: /your-uuid
  headers:
    Host: example.com
udp: true
tfo: false`;

export function ProxyDialog({ open, onOpenChange, initial, onSubmit }: ProxyDialogProps) {
  const [yamlText, setYamlText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setYamlText(initial ? YAML.stringify(initial).trim() : '');
      setError('');
    }
  }, [open, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let parsed: unknown;
    try {
      parsed = YAML.parse(yamlText);
    } catch (err) {
      setError(`YAML 解析失败: ${(err as Error).message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('内容必须是一个 YAML 对象');
      return;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      setError('缺少必填字段: name');
      return;
    }
    onSubmit(obj as ClashProxy);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑节点' : '添加节点'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>节点配置 (YAML 格式)</Label>
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              spellCheck={false}
              rows={16}
              className="w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={PLACEHOLDER}
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
