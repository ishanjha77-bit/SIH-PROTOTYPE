import { ChevronLeft, ChevronRight, MapPin, Mountain } from 'lucide-react'
import { N, STATIONS, isFault } from '../engine/engine'
import { GateStepper, ReadingsTable } from '../components/Blocks'
import { TraceChart } from '../components/TraceChart'
import { AIBadge, Card, CardHead, Chip, IconButton, Select, cx } from '../components/ui'
import { TONE, WMO_MEANING, confidence, narrative, stamp, statusOf, wmoFlags } from '../lib/present'
import { useConsole } from '../state/console'

export function Station() {
  const { engine: E, k, sel: i, select, backend } = useConsole()
  const s = STATIONS[i], d = E.OUT[k][i], o = E.RAW[k][i], leg = E.LEG[k][i]
  const st = statusOf(d), story = narrative(i, d, o)
  const truthFault = E.TRUTH[k][i].length > 0
  const wgFault = isFault(d.cls)

  const legacyVerdict = leg.flag
    ? { label: 'Rejected', note: leg.why, tone: truthFault ? 'ok' as const : 'fault' as const, tag: truthFault ? 'correct' : 'false alarm' }
    : { label: 'Accepted', note: truthFault ? 'Fault slipped through' : 'No rule triggered', tone: truthFault ? 'fault' as const : 'ok' as const, tag: truthFault ? 'missed fault' : 'correct' }
  const wgVerdict = wgFault
    ? { label: `Flagged · ${st.label}`, note: 'Value replaced by virtual sensor', tone: truthFault ? 'ok' as const : 'fault' as const, tag: truthFault ? 'correct' : 'false alarm' }
    : { label: d.cls === 'SEVERE' ? 'Kept · weather alert raised' : 'Accepted', note: d.cls === 'SEVERE' ? 'Radar and satellite confirm the event' : 'All gates passed', tone: truthFault ? 'fault' as const : 'ok' as const, tag: truthFault ? 'missed fault' : 'correct' }

  const step = (dir: number) => select((i + dir + N) % N)

  return (
    <div className="fade-in flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <IconButton label="Previous station" onClick={() => step(-1)} className="border border-line"><ChevronLeft size={16} /></IconButton>
                <Select value={i} onChange={(e) => select(+e.target.value)} aria-label="Station" className="min-w-[180px]">
                  {STATIONS.map((x, j) => <option key={x.id} value={j}>{x.name}</option>)}
                </Select>
                <IconButton label="Next station" onClick={() => step(1)} className="border border-line"><ChevronRight size={16} /></IconButton>
              </div>
              <h2 className="t-h1 mt-5">{s.name}</h2>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
                <span className="inline-flex items-center gap-1.5"><MapPin size={13} />{s.lat.toFixed(2)}°N {s.lon.toFixed(2)}°E</span>
                <span className="inline-flex items-center gap-1.5"><Mountain size={13} />{s.elev} m above sea level</span>
                <span className="tnum font-mono">{stamp(k)}</span>
              </div>
            </div>
            <Chip tone={st.tone} size="md">{st.label}</Chip>
          </div>

          <div key={`${i}-${d.cls}`} className="ai-edge rise mt-6 rounded-xl bg-surface-2 p-4 sm:p-5">
            <div className="flex items-center gap-2"><AIBadge>AI explanation</AIBadge></div>
            <h3 className={cx('t-h3 mt-3', TONE[st.tone].fg)}>{story.title}</h3>
            <p className="t-body mt-1.5 text-ink">{story.body}</p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            {(() => {
              const fl = wmoFlags(d), conf = confidence(d)
              return [
                ['Confidence', `${Math.round(conf * 100)}%`, 'trust in the value sent on'],
                ['WMO QC flag', `${fl.raw} → ${fl.clean}`, `${WMO_MEANING[fl.raw]} → ${WMO_MEANING[fl.clean]}`],
                ['Edge RTU', d.edge?.burst ? '1-min burst' : '15-min batch', d.edge?.flags.length ? `flags: ${d.edge.flags.join(', ')}` : 'no local flags'],
              ].map(([a, b, c]) => (
                <div key={a} className="min-w-0 rounded-xl bg-sunken px-3 py-3">
                  <div className="t-caption text-muted">{a}</div>
                  <div className="t-num mt-1 text-[18px] text-ink">{b}</div>
                  <div className="t-caption truncate text-ink-2" title={c}>{c}</div>
                </div>
              ))
            })()}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[['Legacy rule-based QC', legacyVerdict], ['WeatherGuard AI', wgVerdict]].map(([name, v]) => {
              const vv = v as typeof legacyVerdict
              return (
                <div key={name as string} className={cx('rounded-xl border p-4', name === 'WeatherGuard AI' ? 'border-accent/30' : 'border-line')}>
                  <div className="flex items-center justify-between gap-2"><span className="t-caption text-muted">{name as string}</span><Chip tone={vv.tone} dot={false}>{vv.tag}</Chip></div>
                  <div className="t-h3 mt-2">{vv.label}</div>
                  <div className="t-caption mt-0.5 text-ink-2">{vv.note}</div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <CardHead title="Five checks, in order" hint="How this observation was judged. Any gate can stop, keep or repair it." />
          <GateStepper />
          <div className="mt-6 rounded-xl bg-sunken p-4">
            <div className="flex items-center justify-between text-[12.5px]"><span className="text-ink-2">Multivariate anomaly score</span><span className="tnum font-mono text-ink">{o ? d.score.toFixed(1) : '—'}</span></div>
            <div className="relative mt-2 h-2 rounded-full bg-surface">
              <span className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (d.score / 10) * 100)}%`, background: d.score > 6.5 ? 'var(--fault)' : 'var(--accent)' }} />
              <span className="absolute -top-1 -bottom-1 w-px bg-fault" style={{ left: '65%' }} title="Review threshold" />
            </div>
            <p className="mt-2 text-[11.5px] text-muted">{backend.scorer === 'lstm' ? `LSTM-autoencoder reconstruction error over the last 4 hours of ${backend.spatial === 'st-gnn' ? 'ST-GNN' : 'neighbour'} residuals, calibrated so the line is the 99.9th percentile of normal behaviour.` : 'PCA-whitened residuals learned in the first 9 hours. Line marks the review threshold.'}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Reported vs expected" hint={backend.spatial === 'st-gnn' ? 'Expected values come from the ST-GNN (neighbours, terrain, previous step) and radar' : 'Expected values come from altitude-corrected neighbours and radar'} />
        <ReadingsTable />
      </Card>

      <Card>
        <CardHead title="Last 24 hours" hint="Did the sensor stray from what its neighbours predict? Reported values, the expected band, and the cleaned series sent downstream."
          right={<div className="flex flex-wrap gap-3 text-[12px] text-ink-2">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-ink" />Reported</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded bg-accent/15" />Expected ±2σ</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-accent" />Cleaned</span>
          </div>} />
        <TraceChart />
      </Card>
    </div>
  )
}
