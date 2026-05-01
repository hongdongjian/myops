import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { cn } from './lib/cn';
import { Copilot } from './routes/copilot';
import { Mcp } from './routes/mcp';
import { Claude } from './routes/claude';
import { Codex } from './routes/codex';
import { CronJobs } from './routes/cron';
import { Clash } from './routes/clash';

interface NavItem {
  to: string;
  label: string;
  hint?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'AGENTS',
    items: [
      { to: '/copilot', label: 'Copilot', hint: 'cp' },
      { to: '/claude', label: 'Claude', hint: 'cl' },
      { to: '/codex', label: 'Codex', hint: 'cx' },
      { to: '/mcp', label: 'MCP', hint: 'mc' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { to: '/cron', label: 'Cron', hint: 'cr' },
      { to: '/clash', label: 'Clash', hint: 'ch' },
    ],
  },
];

export function App() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <aside className="relative flex w-60 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-sm">
        {/* Brand mark */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-sm bg-primary/15 ring-1 ring-primary/40">
            <span className="font-mono text-[11px] font-semibold tracking-tight text-primary text-glow">
              {'>'}_
            </span>
          </div>
          <div className="leading-none">
            <div className="font-display text-xl italic">myops</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              operator console
            </div>
          </div>
        </div>

        <div className="divider-fade mx-5" />

        {/* Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navSections.map((section, i) => (
            <div key={section.title} className={cn('mb-5', i === 0 && 'reveal reveal-1', i === 1 && 'reveal reveal-2')}>
              <div className="mb-1.5 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-all',
                        isActive
                          ? 'bg-foreground/[0.06] text-foreground'
                          : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-sm transition-all',
                            isActive ? 'bg-primary opacity-100' : 'bg-primary opacity-0 group-hover:opacity-40',
                          )}
                        />
                        <span className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              'font-mono text-[10px] uppercase tracking-wider',
                              isActive ? 'text-primary' : 'text-muted-foreground/60',
                            )}
                          >
                            {n.hint}
                          </span>
                          <span className={cn(isActive && 'font-medium')}>{n.label}</span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            'font-mono text-[10px] text-muted-foreground/50 transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                          )}
                        >
                          →
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer status */}
        <div className="border-t border-border/80 px-5 py-3">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="live-dot" />
              <span>online</span>
            </span>
            <span className="tabular">v0.0.0</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/copilot" replace />} />
            <Route path="/copilot/*" element={<Copilot />} />
            <Route path="/mcp/*" element={<Mcp />} />
            <Route path="/claude/*" element={<Claude />} />
            <Route path="/codex/*" element={<Codex />} />
            <Route path="/cron/*" element={<CronJobs />} />
            <Route path="/clash/*" element={<Clash />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
