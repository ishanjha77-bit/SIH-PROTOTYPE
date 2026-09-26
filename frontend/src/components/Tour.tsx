import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect } from 'react'
import { stationIndex } from '../engine/engine'
import { useConsole, type View } from '../state/console'
import { Button, IconButton } from './ui'

interface Step { view: View; k: number; st?: string; title: string; body: string }

const STEPS: Step[] = [
  { view: 'overview', k: 108, title: 'The problem', body: 'IMD\'s Automatic Weather Stations send a reading every 15 minutes. Rule-based QC can\'t tell a broken sensor from a real storm, so it throws away good extreme-weather data and misses slow faults. This console shows 12 stations along the Konkan coast and Western Ghats.' },
  { view: 'overview', k: 149, title: 'A real storm arrives', body: 'A squall line is crossing the Ghats. Temperature drops fast and wind gusts, so legacy QC rejects these readings (dashed red rings). WeatherGuard checks Doppler radar and INSAT cloud-top, confirms the storm is real, keeps the data and raises a CAP alert.' },
  { view: 'station', k: 150, st: 'lonavala', title: 'Every verdict is explained', body: 'Five gates run in order: electrical, physics (Clausius–Clapeyron, Magnus–Tetens), temporal, radar & satellite, and the ST-GNN spatial check. Forecasters see why a reading was kept, its confidence and its WMO quality flag.' },
  { view: 'station', k: 150, st: 'pune', title: 'Slow faults legacy QC never sees', body: 'Pune\'s humidity probe is drifting upward a little every hour. Range checks pass it, but the ST-GNN knows what Pune should read from its neighbours and terrain. The dashed blue line is the corrected value sent downstream.' },
  { view: 'station', k: 146, st: 'mahabaleshwar', title: 'Fix it before it fails', body: 'Mahabaleshwar\'s battery is draining faster than the rest of the network. WeatherGuard predicts when readings will go bad and raises a work order hours before any data is corrupted.' },
  { view: 'evaluation', k: 287, title: 'Measured, not claimed', body: 'Every flag is scored against faults injected at known times. Over three days WeatherGuard catches far more faulty readings than legacy QC with zero false alarms, and beats Isolation Forest, LOF and One-Class SVM trained on the same data.' },
  { view: 'maintenance', k: 287, title: 'From anomaly to action', body: 'Work orders name the root cause and the spare parts to carry. A shift report is written for the forecaster, and clean data exports as NetCDF, CSV or JSON with WMO quality flags for NWP models.' },
  { view: 'lab', k: 150, title: 'Your turn', body: 'Break any station yourself. Pick a failure, press play, and watch the pipeline find it. The models run on ONNX Runtime, the same 22–107 KB files an edge device would run.' },
]

export function Tour() {
  const { tour, setTour, setView, setK, select, playing, toggle } = useConsole()
  const step = tour == null ? null : STEPS[tour]

  useEffect(() => {
    if (!step) return
    if (playing) toggle()
    setView(step.view)
    setK(step.k)
    if (step.st) select(stationIndex(step.st))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour])

  useEffect(() => {
    if (tour == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTour(null)
      if (e.key === 'ArrowRight' && tour < STEPS.length - 1) setTour(tour + 1)
      if (e.key === 'ArrowLeft' && tour > 0) setTour(tour - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, setTour])

  if (!step || tour == null) return null
  return (
    <div role="dialog" aria-label="Guided tour" key={tour}
      className="rise fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] right-3 z-40 w-[min(420px,calc(100vw-24px))] rounded-lg border border-line bg-bg p-6 shadow-lift sm:right-8">
      <div className="flex items-center justify-between gap-3">
        <span className="tnum eyebrow">Tour · {tour + 1} of {STEPS.length}</span>
        <IconButton label="Close tour" onClick={() => setTour(null)} className="-mr-2 -mt-2"><X size={16} /></IconButton>
      </div>
      <h3 className="t-h2 mt-3 text-ink">{step.title}</h3>
      <p className="t-small mt-2.5 text-ink-2">{step.body}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex gap-1" aria-hidden="true">{STEPS.map((_, i) => <span key={i} className={`h-px w-4 transition-colors duration-300 ${i <= tour ? 'bg-ink' : 'bg-line-strong'}`} />)}</div>
        <div className="flex gap-2">
          {tour > 0 && <Button size="sm" variant="ghost" onClick={() => setTour(tour - 1)} icon={<ArrowLeft size={14} />}>Back</Button>}
          {tour < STEPS.length - 1
            ? <Button size="sm" variant="primary" onClick={() => setTour(tour + 1)} iconRight={<ArrowRight size={14} />}>Next</Button>
            : <Button size="sm" variant="primary" onClick={() => setTour(null)}>Start exploring</Button>}
        </div>
      </div>
    </div>
  )
}

export function TourButton() {
  const { setTour } = useConsole()
  return (
    <Button variant="secondary" onClick={() => setTour(0)}>Take the tour</Button>
  )
}
