import { Suspense, lazy, useEffect, useRef } from 'react'
import { BusyBar, Footer, TimelineDock, TopBar, TopNav } from './components/Shell'
import { Toaster, toast } from './components/Toast'
import { Tour } from './components/Tour'
import { IntroSequence } from './intro/IntroSequence'
import { ConsoleProvider, useConsole, type View } from './state/console'
import { Overview } from './views/Overview'
import { PageSkeleton } from './components/ui'

// Secondary screens load on demand; the overview (first paint) stays in the main bundle.
const RealData = lazy(() => import('./views/RealData').then((m) => ({ default: m.RealData })))
const Station = lazy(() => import('./views/Station').then((m) => ({ default: m.Station })))
const Evaluation = lazy(() => import('./views/Others').then((m) => ({ default: m.Evaluation })))
const Maintenance = lazy(() => import('./views/Others').then((m) => ({ default: m.Maintenance })))
const FaultLab = lazy(() => import('./views/Others').then((m) => ({ default: m.FaultLab })))
const Architecture = lazy(() => import('./views/Others').then((m) => ({ default: m.Architecture })))

const COPY: Record<View, { title?: string; subtitle?: string }> = {
  overview: {},
  real: { title: 'Real data', subtitle: 'The same checks on a full year of real observations from these stations, compared with the rule-based QC in use today.' },
  station: { title: 'Diagnosis', subtitle: 'Why one observation was accepted, kept as severe weather, or replaced, check by check.' },
  evaluation: { title: 'Evaluation', subtitle: 'Every flag scored against faults injected at known times, beside legacy rule-based QC.' },
  maintenance: { title: 'Maintenance', subtitle: 'Work orders raised automatically, with the root cause and the parts to carry.' },
  lab: { title: 'Fault lab', subtitle: 'Break any station, then watch the pipeline find it.' },
  architecture: { title: 'Architecture', subtitle: 'The five-tier pipeline, and exactly what runs in this build today.' },
}

/** Surfaces a failed server run as a toast. (Connection state lives quietly in the nav.) */
function BackendWatcher() {
  const { backend: b } = useConsole()
  const prev = useRef({ source: b.source, error: b.error })
  useEffect(() => {
    const p = prev.current
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
    <div className="min-h-screen">
      <BusyBar />
      <TopNav />
      <main className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+104px)] sm:px-8">
        <div className="mx-auto max-w-[1240px]">
          <TopBar title={c.title} subtitle={c.subtitle} />
          <div key={view} className="fade-in">
            <Suspense fallback={<PageSkeleton />}>
            {view === 'overview' && <Overview />}
            {view === 'real' && <RealData />}
            {view === 'station' && <Station />}
            {view === 'evaluation' && <Evaluation />}
            {view === 'maintenance' && <Maintenance />}
            {view === 'lab' && <FaultLab />}
            {view === 'architecture' && <Architecture />}
            </Suspense>
          </div>
          <Footer />
        </div>
      </main>
      {view !== 'architecture' && view !== 'real' && <TimelineDock />}
      <Tour />
      <Toaster />
      <BackendWatcher />
    </div>
  )
}

export default function App() {
  return (
    <>
      <ConsoleProvider>
        <Screen />
      </ConsoleProvider>
      <IntroSequence />
    </>
  )
}
