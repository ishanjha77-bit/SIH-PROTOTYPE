import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_FAULTS, STEPS, runEngine, stationIndex, type EngineResult } from '../engine/engine'
import type { Fault, FaultType } from '../engine/types'
import { API_URL, api, type ModelCard } from '../api/client'

export type View = 'overview' | 'station' | 'evaluation' | 'maintenance' | 'lab' | 'architecture'
export const VIEWS: View[] = ['overview', 'station', 'evaluation', 'maintenance', 'lab', 'architecture']

interface ConsoleState {
  engine: EngineResult
  k: number
  setK: (k: number) => void
  playing: boolean
  toggle: () => void
  speed: 1 | 4
  setSpeed: (s: 1 | 4) => void
  sel: number
  select: (i: number, open?: boolean) => void
  view: View
  setView: (v: View) => void
  inject: (st: string, type: FaultType) => void
  reset: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  backend: Backend
  tour: number | null
  setTour: (n: number | null) => void
  /** Insight ids the operator has acted on (dispatched / confirmed), with the step it happened. */
  handled: Record<string, number>
  handle: (id: string) => void
}

export interface Backend {
  url: string
  status: 'checking' | 'online' | 'offline'
  source: 'api' | 'browser'          // which engine produced what you see
  want: 'api' | 'browser'            // user's choice
  setWant: (w: 'api' | 'browser') => void
  scorer: string                     // 'lstm' | 'pca'
  spatial: string                    // 'st-gnn' | 'idw'
  busy: boolean
  error: string | null
  computeMs: number | null
  model: ModelCard | null
  retry: () => void
  waking: boolean
}

const Ctx = createContext<ConsoleState | null>(null)
// Day 2 14:45: squall over three stations and legacy QC has already rejected 11 real storm readings.
const START_K = 155

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [faults, setFaults] = useState<Fault[]>(DEFAULT_FAULTS)
  // In-browser engine: always available, used as fallback and for instant first paint.
  const local = useMemo(() => runEngine(faults), [faults])
  const fkey = useMemo(() => JSON.stringify(faults.map(({ st, type, k0, steps }) => ({ st, type, k0, steps }))), [faults])

  // FastAPI backend (LSTM-autoencoder). Auto-detected; falls back to the browser engine if unreachable.
  const [status, setStatus] = useState<Backend['status']>('checking')
  const [want, setWant] = useState<'api' | 'browser'>('api')
  const [model, setModel] = useState<ModelCard | null>(null)
  const [remote, setRemote] = useState<{ key: string; data: EngineResult; ms: number; scorer: string; spatial: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState(0)

  const [waking, setWaking] = useState(false)
  useEffect(() => {
    let live = true
    if (probe === 0) setStatus('checking')
    api.health()
      .then(() => { if (!live) return; setStatus('online'); setWaking(false); api.model().then((m) => live && setModel(m)).catch(() => {}) })
      .catch(() => { if (live) setStatus('offline') })
    return () => { live = false }
  }, [probe])
  // Free hosting tiers sleep when idle and take ~1 min to wake: keep probing for a few minutes,
  // show the in-browser engine meanwhile, then switch to the server automatically.
  useEffect(() => {
    if (status !== 'offline' || probe >= 14) { if (probe >= 14) setWaking(false); return }
    setWaking(true)
    const t = setTimeout(() => setProbe((p) => p + 1), probe === 0 ? 3000 : 12000)
    return () => clearTimeout(t)
  }, [status, probe])

  useEffect(() => {
    if (status !== 'online' || want !== 'api' || remote?.key === fkey) return
    let live = true
    setBusy(true); setError(null)
    api.run(faults)
      .then((r) => { if (live) setRemote({ key: fkey, data: r, ms: r.meta.compute_ms, scorer: r.meta.scorer, spatial: r.meta.spatial }) })
      .catch((e: Error) => { if (live) { setError(e.message); setStatus('offline') } })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [status, want, fkey, faults, remote?.key])

  const useRemote = want === 'api' && status === 'online' && remote?.key === fkey
  const engine = useRemote ? remote!.data : local
  const backend: Backend = {
    url: API_URL, status, want, setWant, busy, error, model,
    source: useRemote ? 'api' : 'browser',
    scorer: useRemote ? remote!.scorer : 'pca',
    spatial: useRemote ? remote!.spatial : 'idw',
    computeMs: useRemote ? remote!.ms : null,
    retry: () => setProbe((p) => p + 1),
    waking,
  }
  const [k, setK] = useState(START_K)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 4>(1)
  const [sel, setSel] = useState(stationIndex('lonavala'))
  const initialView = (() => {
    const h = typeof location !== 'undefined' ? location.hash.slice(1) : ''
    return (VIEWS as string[]).includes(h) ? (h as View) : 'overview'
  })()
  const [view, setViewState] = useState<View>(initialView)
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light')

  useEffect(() => {
    const onHash = () => { const h = location.hash.slice(1); if ((VIEWS as string[]).includes(h)) setViewState(h as View) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const [tour, setTour] = useState<number | null>(null)
  const [handled, setHandled] = useState<Record<string, number>>({})
  const kRef = useRef(k)
  kRef.current = k

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setK((x) => {
        if (x >= STEPS - 1) { setPlaying(false); return x }
        return x + 1
      })
    }, speed === 4 ? 220 : 650)
    return () => clearInterval(id)
  }, [playing, speed])

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && kRef.current >= STEPS - 1) setK(0)
      return !p
    })
  }, [])

  const setView = useCallback((v: View) => {
    setViewState(v)
    try { history.replaceState(null, '', '#' + v) } catch { /* sandboxed */ }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const select = useCallback((i: number, open = false) => {
    setSel(i)
    if (open) setView('station')
  }, [setView])

  const inject = useCallback((st: string, type: FaultType) => {
    const k0 = Math.min(kRef.current + 1, STEPS - 1)
    setFaults((f) => [...f, { st, type, k0, user: true, steps: [k0, k0 + 6, k0 + 13] }])
    setSel(stationIndex(st))
  }, [])

  const reset = useCallback(() => {
    setPlaying(false); setFaults(DEFAULT_FAULTS); setK(START_K); setSel(stationIndex('lonavala')); setHandled({})
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('dark', n === 'dark')
      try { localStorage.setItem('wg-theme', n) } catch { /* storage blocked */ }
      return n
    })
  }, [])

  const handle = useCallback((id: string) => setHandled((h) => (id in h ? h : { ...h, [id]: kRef.current })), [])

  const value: ConsoleState = { engine, k, setK, playing, toggle, speed, setSpeed, sel, select, view, setView, inject, reset, theme, toggleTheme, backend, tour, setTour, handled, handle }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConsole() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConsole must be used inside ConsoleProvider')
  return c
}
