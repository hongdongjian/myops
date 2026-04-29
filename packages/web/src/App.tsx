import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { cn } from './lib/cn';
import { Copilot } from './routes/copilot';
import { Mcp } from './routes/mcp';

const navs = [
  { to: '/copilot', label: 'Copilot' },
  { to: '/mcp', label: 'MCP' },
  { to: '/claude', label: 'Claude' },
  { to: '/codex', label: 'Codex' },
  { to: '/scheduler', label: '调度' },
  { to: '/assets', label: '资产' },
  { to: '/sync', label: '同步' },
];

export function App() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-52 border-r border-border p-4 space-y-1">
        <div className="text-lg font-semibold mb-4 px-2">my-ops</div>
        {navs.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              cn(
                'block rounded px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )
            }
          >
            {n.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/copilot" replace />} />
          <Route path="/copilot/*" element={<Copilot />} />
          <Route path="/mcp/*" element={<Mcp />} />
          <Route path="/claude/*" element={<div className="text-muted-foreground">claude (placeholder)</div>} />
          <Route path="/codex/*" element={<div className="text-muted-foreground">codex (placeholder)</div>} />
          <Route path="/scheduler/*" element={<div className="text-muted-foreground">scheduler (placeholder)</div>} />
          <Route path="/assets/*" element={<div className="text-muted-foreground">assets (placeholder)</div>} />
          <Route path="/sync/*" element={<div className="text-muted-foreground">sync (placeholder)</div>} />
        </Routes>
      </main>
    </div>
  );
}
