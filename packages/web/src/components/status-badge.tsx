import { Badge } from './ui/badge';

export function StatusBadge({ running }: { running: boolean }) {
  return running ? (
    <Badge className="bg-green-600 text-white hover:bg-green-700">运行中</Badge>
  ) : (
    <Badge variant="secondary">未启动</Badge>
  );
}
