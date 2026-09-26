import { Activity, Cpu, FlaskConical, Gauge, LayoutGrid, Layers, Loader2, Moon, Pause, Play, RotateCcw, Server, Sun, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { N, STEPS, isFault } from '../engine/engine'
import { stamp } from '../lib/present'
import { useConsole, type View } from '../state/console'
import { cx, Segmented } from './ui'

const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'station', label: 'Diagnosis', icon: Activity },
  { id: 'evaluation', label: 'Evaluation', icon: Gauge },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'lab', label: 'Fault lab', icon: FlaskConical },
  { id: 'architecture', label: 'Architecture', icon: Layers },
]

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-ink">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.8l7 2.6v5.2c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V5.4z" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7.6 12.4h2.2l1.3-3 1.8 5.2 1.3-3h2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">WeatherGuard</div>
        <div className="text-[11.5px] text-muted">AWS quality intelligence</div>
      </div>
    </div>
  )
}

function ThemeButton() {
  const { theme, toggleTheme } = useConsole()
  return (
    <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink">
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

export function EngineBadge({ compact = false }: { compact?: boolean }) {
  const { backend: b } = useConsole()
  const onApi = b.source === 'api'
  const label = b.busy ? 'Running on server…' : onApi ? `FastAPI · ${b.spatial === 'st-gnn' ? 'ST-GNN + ' : ''}${b.scorer === 'lstm' ? 'LSTM-AE' : 'PCA'}` : 'In-browser engine'
  return (
    <div className={cx('rounded-2xl bg-sunken', compact ? 'px-3 py-2' : 'p-4')}>
      {!compact && <div className="eyebrow">Detection engine</div>}
      <div className={cx('flex items-center gap-2 text-[13px]', !compact && 'mt-1.5')}>
        {b.busy ? <Loader2 size={14} className="animate-spin text-accent" /> : onApi ? <Server size={14} className="text-ok" /> : <Cpu size={14} className="text-muted" />}
        <span className="font-medium text-ink">{label}</span>
      </div>
      {!compact && (
        <>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">
            {onApi ? `Computed in ${b.computeMs ?? '—'} ms by the Python backend.` : b.status === 'checking' ? 'Looking for the backend…' : b.waking ? 'Waking the server. The browser engine runs meanwhile; this switches over automatically.' : b.status === 'offline' ? 'Backend not reachable. Running the full pipeline in your browser.' : 'Using the TypeScript engine.'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Segmented label="Engine" value={b.want} onChange={b.setWant}
              options={[{ value: 'api', label: 'Server' }, { value: 'browser', label: 'Browser' }]} />
            {b.status === 'offline' && <button type="button" onClick={b.retry} className="text-[12px] text-accent hover:underline">Retry</button>}
          </div>
        </>
      )}
    </div>
  )
}

export function Sidebar() {
  const { view, setView, engine, k } = useConsole()
  const clean = engine.OUT[k].filter((d) => !isFault(d.cls)).length
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-surface/70 px-4 py-6 backdrop-blur lg:flex">
      <div className="px-2"><Logo /></div>
      <nav className="mt-8 flex flex-col gap-1" aria-label="Sections">
        {NAV.map((n) => (
          <button key={n.id} type="button" onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
            className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors',
              view === n.id ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-sunken')}>
            <n.icon size={17} strokeWidth={1.8} className={view === n.id ? 'text-accent' : 'text-muted'} />
            {n.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
      <EngineBadge />
      <div className="rounded-2xl bg-sunken p-4">
        <div className="eyebrow">Network health</div>
        <div className="mt-1 flex items-baseline gap-1.5"><span className="tnum text-2xl font-semibold">{clean}</span><span className="text-[13px] text-muted">of {N} stations clean</span></div>
        <div className="mt-3 flex gap-1">
          {engine.OUT[k].map((d, i) => (
            <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: isFault(d.cls) ? 'var(--fault)' : d.cls === 'SEVERE' ? 'var(--storm)' : 'var(--ok)' }} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-muted">Team Nex_GenX · SIH 2026</span>
          <ThemeButton />
        </div>
      </div>
      </div>
    </aside>
  )
}

export function TopBar({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  const { k, playing, view, setView } = useConsole()
  return (
    <header className="pt-5 sm:pt-8">
      <div className="mb-5 flex items-center justify-between lg:hidden">
        <Logo />
        <ThemeButton />
      </div>
      <div className="mb-4 lg:hidden"><EngineBadge compact /></div>
      <nav className="scroll-soft -mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden" aria-label="Sections">
        {NAV.map((n) => (
          <button key={n.id} type="button" onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
            className={cx('flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[13px]',
              view === n.id ? 'bg-accent-soft font-medium text-ink' : 'bg-surface text-ink-2')}>
            <n.icon size={15} className={view === n.id ? 'text-accent' : 'text-muted'} />{n.label}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">{title}</h1>
          <p className="mt-1 max-w-[62ch] text-[14px] text-ink-2">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px]">
            <span className={cx('h-2 w-2 rounded-full', playing ? 'breathe bg-ok' : 'bg-off')} />
            <span className="tnum font-mono text-ink">{stamp(k)}</span>
            <span className="text-muted">IST</span>
          </div>
        </div>
      </div>
    </header>
  )
}

export function TimelineDock() {
  const { k, setK, playing, toggle, speed, setSpeed, engine, reset } = useConsole()
  const pctOf = (x: number) => `${(x / (STEPS - 1)) * 100}%`
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] lg:pl-[260px]">
      <div className="pointer-events-auto mx-auto flex max-w-[980px] flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] border border-line bg-surface/90 px-3 py-2.5 shadow-soft backdrop-blur-xl sm:px-4">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause data stream' : 'Play data stream'}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:scale-[1.03]">
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="relative min-w-[180px] flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-sunken">
            <span className="absolute inset-y-0 rounded-full bg-storm-soft" style={{ left: pctOf(118), width: `calc(${pctOf(200)} - ${pctOf(118)})` }} />
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: pctOf(k) }} />
          </div>
          {engine.faults.map((f, i) => (
            <span key={i} className="pointer-events-none absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full" title={f.type}
              style={{ left: pctOf(f.k0), background: f.user ? 'var(--accent)' : 'var(--fault)', opacity: 0.7 }} />
          ))}
          <input className="wg-range" type="range" min={0} max={STEPS - 1} value={k} onChange={(e) => setK(+e.target.value)} aria-label="Observation time" />
          <div className="pointer-events-none flex justify-between text-[10.5px] text-muted">
            <span>Day 1</span><span className="text-storm">storm window</span><span>Day 3</span>
          </div>
        </div>
        <div className="hidden sm:block"><Segmented label="Playback speed" value={speed} onChange={setSpeed} options={[{ value: 1, label: '15 min/s' }, { value: 4, label: '1 h/s' }]} /></div>
        <button type="button" onClick={reset} aria-label="Reset demo" title="Reset demo"
          className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-sunken hover:text-ink">
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  )
}
