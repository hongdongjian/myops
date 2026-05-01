import { LogPanel } from '@/components/log-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CopilotLog() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <LogPanel path="/api/copilot/logs?lines=500" clearPath="/api/copilot/logs/clear" />
      </CardContent>
    </Card>
  );
}
