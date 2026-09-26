import { Activity, Cpu, FlaskConical, Gauge, LayoutGrid, Layers, Loader2, Moon, MoreHorizontal, Pause, Play, RotateCcw, Server, Sun, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { N, STEPS, isFault } from '../engine/engine'
import { stamp } from '../lib/present'
import { useConsole, type View } from '../state/console'
import { Drawer, IconButton, Segmented, cx } from './ui'

type NavItem = { id: View; label: string; icon: typeof Activity }
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Monitor', items: [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'station', label: 'Diagnosis', icon: Activity },
  ] },
  { label: 'Operate', items: [
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'lab', label: 'Fault lab', icon: FlaskConical },
  ] },
  { label: 'Prove', items: [
    { id: 'evaluation', label: 'Evaluation', icon: Gauge },
    { id: 'architecture', label: 'Architecture', icon: Layers },
  ] },
]
const NAV = NAV_GROUPS.flatMap((g) => g.items)
const MOBILE_PRIMARY: View[] = ['overview', 'station', 'maintenance', 'lab']

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink shadow-[0_0_24px_-6px_var(--accent)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.8l7 2.6v5.2c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V5.4z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7.6 12.4h2.2l1.3-3 1.8 5.2 1.3-3h2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="text-[14.5px] font-semibold tracking-tight">WeatherGuard</div>
        {!compact && <div className="text-[11px] text-muted">Weather-station QC</div>}
      </div>
    </div>
  )
}

function ThemeButton() {
  const { theme, toggleTheme } = useConsole()
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  )
}

/** Which engine produced what's on screen: the server or the in-browser fallback. */
export function EngineBadge({ expanded = false }: { expanded?: boolean }) {
  const { backend: b } = useConsole()
  const onApi = b.source === 'api'
  const label = b.busy ? 'Running on server…' : onApi ? `${b.spatial === 'st-gnn' ? 'ST-GNN + ' : ''}${b.scorer === 'lstm' ? 'LSTM-AE' : 'PCA'}` : 'In-browser engine'
  const note = onApi ? `FastAPI · ${b.computeMs ?? '—'} ms` : b.status === 'checking' ? 'Looking for the server…' : b.waking ? 'Waking the server…' : b.status === 'offline' ? 'Server unreachable' : 'TypeScript engine'
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-2.5">
        <span className={cx('grid h-7 w-7 place-items-center rounded-lg', onApi ? 'bg-ok-soft text-ok' : 'bg-sunken text-muted')}>
          {b.busy ? <Loader2 size={14} className="animate-spin text-accent" /> : onApi ? <Server size={14} /> : <Cpu size={14} />}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12.5px] font-medium text-ink">{label}</div>
          <div className="t-caption truncate text-muted">{note}</div>
        </div>
      </div>
      {expanded && (
        <>
          <p className="t-caption mt-2.5 text-muted">
            {onApi ? 'Every verdict on screen was computed by the Python backend with ONNX Runtime.' : b.waking ? 'The browser engine runs meanwhile and switches over automatically.' : 'The full pipeline is running in your browser instead.'}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Segmented label="Engine" value={b.want} onChange={b.setWant} options={[{ value: 'api', label: 'Server' }, { value: 'browser', label: 'Browser' }]} />
            {b.status === 'offline' && <button type="button" onClick={b.retry} className="text-[12px] font-medium text-accent hover:underline">Retry</button>}
          </div>
        </>
      )}
    </div>
  )
}

function NavButton({ n, active, onClick }: { n: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cx('group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150',
        active ? 'bg-sunken font-medium text-ink' : 'text-ink-2 hover:bg-sunken/60 hover:text-ink')}>
      {active && <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
      <n.icon size={16} strokeWidth={1.8} className={active ? 'text-accent' : 'text-muted group-hover:text-ink-2'} />
      {n.label}
    </button>
  )
}

export function Sidebar() {
  const { view, setView, engine, k } = useConsole()
  const faults = engine.OUT[k].filter((d) => isFault(d.cls)).length
  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-5 backdrop-blur lg:flex">
      <div className="px-2.5"><Logo /></div>
      <nav className="mt-7 flex flex-col gap-5" aria-label="Sections">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="eyebrow mb-1.5 px-2.5">{g.label}</div>
            <div className="flex flex-col gap-0.5">
              {g.items.map((n) => (
                <div key={n.id} className="relative">
                  <NavButton n={n} active={view === n.id} onClick={() => setView(n.id)} />
                  {n.id === 'maintenance' && faults > 0 && (
                    <span className="tnum pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-fault-soft px-1.5 text-[11px] font-medium text-fault">{faults}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <EngineBadge expanded />
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="t-caption text-muted">Nex_GenX · SIH 2026</span>
          <ThemeButton />
        </div>
      </div>
    </aside>
  )
}

/** Thin indeterminate bar while the server recomputes the run. */
export function BusyBar() {
  const { backend } = useConsole()
  if (!backend.busy) return null
  return <div className="progress-indeterminate fixed inset-x-0 top-0 z-[55] h-0.5 bg-accent/15" role="progressbar" aria-label="Server is computing" />
}

export function Clock() {
  const { k, playing } = useConsole()
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12.5px]" title="Simulated observation time">
      <span className={cx('h-1.5 w-1.5 rounded-full', playing ? 'breathe bg-ok' : 'bg-off')} />
      <span className="tnum font-mono text-ink">{stamp(k)}</span>
      <span className="text-muted">IST</span>
    </div>
  )
}

export function TopBar({ title, subtitle, actions }: { title?: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="pt-4 sm:pt-7">
      <div className="mb-5 flex items-center justify-between gap-3 lg:hidden">
        <Logo compact />
        <div className="flex items-center gap-1"><Clock /><ThemeButton /></div>
      </div>
      {title && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="t-h1">{title}</h1>
            {subtitle && <p className="t-body mt-1.5 max-w-[64ch] text-ink-2">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <span className="hidden lg:inline-flex"><Clock /></span>
          </div>
        </div>
      )}
    </header>
  )
}

/** Mobile / tablet: bottom tab bar; secondary sections live in a sheet. */
export function MobileNav() {
  const { view, setView } = useConsole()
  const [more, setMore] = useState(false)
  const inMore = !MOBILE_PRIMARY.includes(view)
  return (
    <>
      <nav aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-[640px] grid-cols-5">
          {MOBILE_PRIMARY.map((id) => {
            const n = NAV.find((x) => x.id === id)!
            const on = view === id
            return (
              <button key={id} type="button" onClick={() => setView(id)} aria-current={on ? 'page' : undefined}
                className={cx('flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors', on ? 'text-accent' : 'text-muted')}>
                <n.icon size={19} strokeWidth={on ? 2.1 : 1.8} />{n.label}
              </button>
            )
          })}
          <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog"
            className={cx('flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] font-medium', inMore ? 'text-accent' : 'text-muted')}>
            <MoreHorizontal size={19} />More
          </button>
        </div>
      </nav>
      <Drawer open={more} onClose={() => setMore(false)} side="bottom" label="More sections" title={<span className="t-h2">More</span>}>
        <div className="flex flex-col gap-1">
          {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.id)).map((n) => (
            <NavButton key={n.id} n={n} active={view === n.id} onClick={() => { setView(n.id); setMore(false) }} />
          ))}
        </div>
        <div className="mt-5"><EngineBadge expanded /></div>
      </Drawer>
    </>
  )
}

export function TimelineDock() {
  const { k, setK, playing, toggle, speed, setSpeed, engine, reset } = useConsole()
  const pctOf = (x: number) => `${(x / (STEPS - 1)) * 100}%`
  const faults = engine.OUT[k].filter((d) => isFault(d.cls)).length
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+56px)] z-30 lg:bottom-0 lg:px-3 lg:pb-4 lg:pl-[244px]">
      {/* Phones/tablets: a slim strip docked to the tab bar. Desktop: a floating control bar. */}
      <div className="pointer-events-auto mx-auto flex items-center gap-3 border-t border-line bg-surface/90 px-3 py-1.5 backdrop-blur-xl sm:gap-4 lg:max-w-[920px] lg:rounded-2xl lg:border lg:bg-surface/85 lg:px-3 lg:py-2 lg:shadow-lift">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause data stream' : 'Play data stream'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95 lg:h-10 lg:w-10 lg:rounded-xl">
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-[14px] h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-sunken">
            <span className="absolute inset-y-0 bg-storm/25" style={{ left: pctOf(118), width: `calc(${pctOf(200)} - ${pctOf(118)})` }} />
            <span className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: pctOf(k) }} />
          </div>
          {engine.faults.map((f, i) => (
            <span key={i} className="pointer-events-none absolute top-[14px] h-3 w-[2px] -translate-y-1/2 rounded-full" title={f.type}
              style={{ left: pctOf(f.k0), background: f.user ? 'var(--accent)' : 'var(--fault)', opacity: 0.75 }} />
          ))}
          <input className="wg-range" type="range" min={0} max={STEPS - 1} value={k} onChange={(e) => setK(+e.target.value)} aria-label="Observation time" aria-valuetext={stamp(k)} />
          <div className="pointer-events-none -mt-0.5 hidden justify-between text-[10.5px] text-muted lg:flex">
            <span>Day 1</span><span className="text-storm">storm window</span><span className="hidden sm:inline">{faults} active fault{faults === 1 ? '' : 's'} · {N - faults}/{N} clean</span><span>Day 3</span>
          </div>
        </div>
        <span className="tnum shrink-0 font-mono text-[11.5px] text-ink-2 lg:hidden">{stamp(k).replace('Day ', 'D')}</span>
        <div className="hidden lg:block"><Segmented label="Playback speed" value={speed} onChange={setSpeed} options={[{ value: 1, label: '15 min/s' }, { value: 4, label: '1 h/s' }]} /></div>
        <IconButton label="Reset demo" onClick={reset}><RotateCcw size={16} /></IconButton>
      </div>
    </div>
  )
}
