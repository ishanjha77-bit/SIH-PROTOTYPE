import { Suspense, lazy, useEffect, useRef } from 'react'
import { BusyBar, MobileNav, Sidebar, TimelineDock, TopBar } from './components/Shell'
import { Toaster, toast } from './components/Toast'
import { Tour, TourButton } from './components/Tour'
import { ConsoleProvider, useConsole, type View } from './state/console'
import { Overview } from './views/Overview'
import { PageSkeleton } from './components/ui'

// Secondary screens load on demand; the overview (first paint) stays in the main bundle.
const Station = lazy(() => import('./views/Station').then((m) => ({ default: m.Station })))
const Evaluation = lazy(() => import('./views/Others').then((m) => ({ default: m.Evaluation })))
const Maintenance = lazy(() => import('./views/Others').then((m) => ({ default: m.Maintenance })))
const FaultLab = lazy(() => import('./views/Others').then((m) => ({ default: m.FaultLab })))
const Architecture = lazy(() => import('./views/Others').then((m) => ({ default: m.Architecture })))

const COPY: Record<View, { title?: string; subtitle?: string }> = {
  overview: {},
  station: { title: 'Diagnosis', subtitle: 'Why one observation was accepted, kept as severe weather, or replaced, check by check.' },
  evaluation: { title: 'Evaluation', subtitle: 'WeatherGuard and legacy rule-based QC, scored against faults injected at known times.' },
  maintenance: { title: 'Maintenance', subtitle: 'Work orders raised automatically, with root cause and the parts to carry.' },
  lab: { title: 'Fault lab', subtitle: 'Break any station and watch the pipeline catch it.' },
  architecture: { title: 'Architecture', subtitle: 'The five-tier pipeline, and what runs in this build today.' },
}

/** Surfaces backend transitions (connected / failed) as toasts. */
function BackendWatcher() {
  const { backend: b } = useConsole()
  const prev = useRef({ source: b.source, error: b.error })
  useEffect(() => {
    const p = prev.current
    if (p.source !== 'api' && b.source === 'api') {
      toast('Connected to the FastAPI backend', { body: `ST-GNN + LSTM-autoencoder on ONNX Runtime · ${b.computeMs ?? '—'} ms`, kind: 'info' })
    }
    if (!p.error && b.error) {
      toast('Server run failed', { kind: 'error', body: 'Showing results from the in-browser engine instead.', action: { label: 'Retry', run: b.retry } })
    }
    prev.current = { source: b.source, error: b.error }
  }, [b.source, b.error, b.computeMs, b.retry])
  return null
}

function Screen() {
  const { view } = useConsole()
  const c = COPY[view]
  return (
    <div className="flex min-h-screen">
      <BusyBar />
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+128px)] sm:px-6 lg:px-10 lg:pb-32">
        <div className="mx-auto max-w-[1240px]">
          <TopBar title={c.title} subtitle={c.subtitle} actions={view === 'overview' ? undefined : <TourButton />} />
          <div className={view === 'overview' ? 'mt-4 lg:mt-5' : 'mt-7'} key={view}>
            <Suspense fallback={<PageSkeleton />}>
            {view === 'overview' && <Overview />}
            {view === 'station' && <Station />}
            {view === 'evaluation' && <Evaluation />}
            {view === 'maintenance' && <Maintenance />}
            {view === 'lab' && <FaultLab />}
            {view === 'architecture' && <Architecture />}
            </Suspense>
          </div>
          <p className="t-caption mt-12 max-w-[90ch] text-muted">
            Prototype for Smart India Hackathon 2026 · Team Nex_GenX. Observations come from a deterministic simulator of the Konkan–Western Ghats network with faults injected at known times. Station positions are approximate. All checks use past and present data only.
          </p>
        </div>
      </main>
      {view !== 'architecture' && <TimelineDock />}
      <MobileNav />
      <Tour />
      <Toaster />
      <BackendWatcher />
    </div>
  )
}

export default function App() {
  return (
    <ConsoleProvider>
      <Screen />
    </ConsoleProvider>
  )
}
