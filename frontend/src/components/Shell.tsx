import { Menu, Moon, Pause, Play, RotateCcw, Sun } from 'lucide-react'
import { useTourSeen } from '../lib/tourSeen'
import { useState } from 'react'
import { STEPS, isFault } from '../engine/engine'
import { intro } from '../intro/store'
import { reveal } from '../intro/reveal'
import { stamp } from '../lib/present'
import { useConsole, type View } from '../state/console'
import { Mark } from './Mark'
import { Drawer, IconButton, Segmented, cx } from './ui'

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'station', label: 'Diagnosis' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'lab', label: 'Fault lab' },
  { id: 'evaluation', label: 'Evaluation' },
  { id: 'architecture', label: 'Architecture' },
]

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={20} className="text-ink" />
      <span className="text-[15px] font-medium tracking-[-0.015em] text-ink">WeatherGuard</span>
    </span>
  )
}

function ThemeButton() {
  const { theme, toggleTheme } = useConsole()
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  )
}

/** Which engine produced what's on screen, stated plainly. */
export function EngineStatus({ long = false }: { long?: boolean }) {
  const { backend: b } = useConsole()
  const onApi = b.source === 'api'
  const text = b.busy ? 'Computing on server…' : onApi ? (long ? `Server · ST-GNN + LSTM autoencoder · ${b.computeMs ?? '—'} ms` : 'Server')
    : b.status === 'checking' ? 'Connecting…' : b.waking ? 'Waking server…' : long ? 'In-browser engine (server unreachable)' : 'Browser'
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted" title={onApi ? 'Verdicts computed by the FastAPI backend' : 'Verdicts computed in this browser'}>
      <span className={cx('h-1.5 w-1.5 rounded-full', onApi ? 'bg-ok' : 'bg-off')} />{text}
    </span>
  )
}

export function Clock() {
  const { k, playing } = useConsole()
  return (
    <span className="tnum inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-2" title="Replay time">
      {playing && <span className="breathe h-1.5 w-1.5 rounded-full bg-ok" />}
      {stamp(k)} <span className="text-muted">IST</span>
    </span>
  )
}

export function TopNav() {
  const { view, setView, setTour, engine, k } = useConsole()
  const tourSeen = useTourSeen()
  const [menu, setMenu] = useState(false)
  const faults = engine.OUT[k].filter((d) => isFault(d.cls)).length
  const go = (v: View) => { setView(v); setMenu(false) }
  return (
    <header {...reveal(0)} className="sticky top-0 z-40 border-b border-line bg-bg/95 pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-8 px-5 sm:px-8">
        <button type="button" onClick={() => go('overview')} className="shrink-0 rounded-md" aria-label="WeatherGuard, overview"><Logo /></button>

        <nav aria-label="Sections" className="hidden h-full items-center gap-5 lg:flex">
          {NAV.map((n) => (
            <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={view === n.id ? 'page' : undefined}
              className={cx('nav-link flex h-full items-center whitespace-nowrap text-[14px] transition-colors duration-150', view === n.id ? 'text-ink' : 'text-muted hover:text-ink')}>
              {n.label}
              {n.id === 'maintenance' && faults > 0 && <span className="tnum ml-1.5 text-[12px] text-fault">{faults}</span>}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-5">
          <span className="hidden whitespace-nowrap 2xl:inline-flex"><EngineStatus /></span>
          <span className="hidden sm:inline-flex"><Clock /></span>
          <button type="button" onClick={() => setTour(0)}
            className="hidden h-8 items-center gap-2 whitespace-nowrap rounded-md border border-ink/80 px-3 text-[13.5px] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-bg lg:inline-flex">
            {!tourSeen && <span className="breathe h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
            <Play size={11} fill="currentColor" />Guided demo
          </button>
          <span className="hidden lg:inline-flex"><ThemeButton /></span>
          <IconButton label="Menu" onClick={() => setMenu(true)} className="lg:hidden"><Menu size={18} /></IconButton>
        </div>
      </div>

      <Drawer open={menu} onClose={() => setMenu(false)} side="top" label="Menu" title={<Logo />}>
        <nav aria-label="Sections" className="flex flex-col">
          {NAV.map((n) => (
            <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={view === n.id ? 'page' : undefined}
              className={cx('flex items-baseline justify-between border-b border-line py-3.5 text-left text-[22px] tracking-[-0.02em]', view === n.id ? 'text-ink' : 'text-muted')}>
              {n.label}
              {n.id === 'maintenance' && faults > 0 && <span className="tnum text-[13px] text-fault">{faults} open</span>}
            </button>
          ))}
        </nav>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5"><Clock /><EngineStatus long /></div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { setMenu(false); setTour(0) }} className="mr-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent"><Play size={11} fill="currentColor" />Guided demo</button>
            <ThemeButton />
          </div>
        </div>
      </Drawer>
    </header>
  )
}

/** Thin indeterminate bar while the server recomputes the run. */
export function BusyBar() {
  const { backend } = useConsole()
  if (!backend.busy) return null
  return <div className="progress-indeterminate fixed inset-x-0 top-0 z-[55] h-0.5 bg-line" role="progressbar" aria-label="Server is computing" />
}

/** Page header for secondary views: title and one line of purpose, nothing else. */
export function TopBar({ title, subtitle }: { title?: string; subtitle?: string; actions?: unknown }) {
  if (!title) return null
  return (
    <header className="pb-10 pt-12 sm:pt-16">
      <h1 className="t-headline text-ink">{title}</h1>
      {subtitle && <p className="t-lead mt-3 max-w-[60ch] text-ink-2">{subtitle}</p>}
    </header>
  )
}

/** Replay transport: a solid strip along the bottom edge. */
export function TimelineDock() {
  const { k, setK, playing, toggle, speed, setSpeed, engine, reset } = useConsole()
  const pctOf = (x: number) => `${(x / (STEPS - 1)) * 100}%`
  return (
    <div {...reveal(150)} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom,0px)]">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-5 sm:gap-6 sm:px-8">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause replay' : 'Play replay'}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-bg transition-opacity duration-150 hover:opacity-85">
          {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="tnum hidden w-[108px] shrink-0 text-[13px] text-ink-2 sm:inline">{stamp(k)}</span>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-line">
            <span className="absolute inset-y-0 bg-storm/35" style={{ left: pctOf(118), width: `calc(${pctOf(200)} - ${pctOf(118)})` }} title="Storm window" />
            <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: pctOf(k) }} />
          </div>
          {engine.faults.map((f, i) => (
            <span key={i} className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2" title={f.type}
              style={{ left: pctOf(f.k0), background: f.user ? 'var(--accent)' : 'var(--fault)' }} />
          ))}
          <input className="wg-range" type="range" min={0} max={STEPS - 1} value={k} onChange={(e) => setK(+e.target.value)} aria-label="Replay time" aria-valuetext={stamp(k)} />
        </div>
        <span className="tnum shrink-0 text-[12.5px] text-muted sm:hidden">{stamp(k).replace('Day ', 'D')}</span>
        <div className="hidden md:block"><Segmented label="Playback speed" value={speed} onChange={setSpeed} options={[{ value: 1, label: '15 min/s' }, { value: 4, label: '1 h/s' }]} /></div>
        <IconButton label="Reset replay" onClick={reset}><RotateCcw size={15} /></IconButton>
      </div>
    </div>
  )
}

/** Quiet footer: provenance, and the intro for anyone who wants to see it again. */
export function Footer() {
  return (
    <footer className="mt-24 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-t border-line pt-6 text-[12.5px] text-muted">
      <p className="max-w-[80ch]">
        Prototype for Smart India Hackathon 2026 · Team Nex_GenX. Observations come from a deterministic simulator of the
        Konkan–Western Ghats network with faults injected at known times. All checks use past and present data only.
      </p>
      <button type="button" onClick={intro.replay} className="text-ink-2 transition-colors hover:text-ink">Replay intro</button>
    </footer>
  )
}
