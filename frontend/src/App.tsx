import { Sidebar, TimelineDock, TopBar } from './components/Shell'
import { Tour, TourButton } from './components/Tour'
import { ConsoleProvider, useConsole, type View } from './state/console'
import { Overview } from './views/Overview'
import { Station } from './views/Station'
import { Architecture, Evaluation, FaultLab, Maintenance } from './views/Others'

const COPY: Record<View, { title: string; subtitle: string }> = {
  overview: { title: 'Network overview', subtitle: 'Every 15-minute observation from 12 automatic weather stations, checked against physics, neighbours, radar and satellite.' },
  station: { title: 'Explainable diagnosis', subtitle: 'Why one observation was accepted, kept as severe weather, or replaced, gate by gate.' },
  evaluation: { title: 'Evaluation', subtitle: 'WeatherGuard and legacy rule-based QC scored against known injected faults.' },
  maintenance: { title: 'Maintenance', subtitle: 'Work orders raised automatically, with root cause and the parts to carry.' },
  lab: { title: 'Fault lab', subtitle: 'Break any station live and watch the system catch it.' },
  architecture: { title: 'Architecture', subtitle: 'The five-tier pipeline, and what runs in this build today.' },
}

function Screen() {
  const { view } = useConsole()
  const c = COPY[view]
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-40 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[1280px]">
          <TopBar title={c.title} subtitle={c.subtitle} actions={<TourButton />} />
          <div className="mt-7" key={view}>
            {view === 'overview' && <Overview />}
            {view === 'station' && <Station />}
            {view === 'evaluation' && <Evaluation />}
            {view === 'maintenance' && <Maintenance />}
            {view === 'lab' && <FaultLab />}
            {view === 'architecture' && <Architecture />}
          </div>
          <p className="mt-10 max-w-[90ch] text-[12px] leading-relaxed text-muted">
            Prototype for Smart India Hackathon 2026 · Team Nex_GenX. Observations come from a deterministic simulator of the Konkan–Western Ghats network with faults injected at known times. Station positions are approximate. All checks run on past and present data only.
          </p>
        </div>
      </main>
      <TimelineDock />
      <Tour />
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
