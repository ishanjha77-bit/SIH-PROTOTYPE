import { ChevronLeft, ChevronRight } from 'lucide-react'
import { N, STATIONS, isFault } from '../engine/engine'
import { GateStepper, ReadingsTable } from '../components/Blocks'
import { TraceChart } from '../components/TraceChart'
import { Card, CardHead, Chip, IconButton, Select, cx } from '../components/ui'
import { WMO_MEANING, confidence, narrative, stamp, statusOf, wmoFlags } from '../lib/present'
import { useConsole } from '../state/console'

export function Station() {
  const { engine: E, k, sel: i, select, backend } = useConsole()
  const s = STATIONS[i], d = E.OUT[k][i], o = E.RAW[k][i], leg = E.LEG[k][i]
  const st = statusOf(d), story = narrative(i, d, o)
  const truthFault = E.TRUTH[k][i].length > 0
  const wgFault = isFault(d.cls)
  const fl = wmoFlags(d)

  // Scored against the injected ground truth, so each verdict can be called right or wrong.
  const legacy = leg.flag
    ? { label: 'Rejected', note: leg.why, right: truthFault, wrong: 'False alarm' }
    : { label: 'Accepted', note: truthFault ? 'The fault slipped through.' : 'No rule triggered.', right: !truthFault, wrong: 'Missed the fault' }
  const wg = wgFault
    ? { label: `Flagged: ${st.label.toLowerCase()}`, note: 'Value replaced by the virtual sensor.', right: truthFault, wrong: 'False alarm' }
    : { label: d.cls === 'SEVERE' ? 'Kept as severe weather' : 'Accepted', note: d.cls === 'SEVERE' ? 'Radar and satellite confirm the event.' : 'All five checks passed.', right: !truthFault, wrong: 'Missed the fault' }

  const step = (dir: number) => select((i + dir + N) % N)

  return (
    <div className="flex flex-col gap-20">
      <div className="grid gap-x-16 gap-y-14 lg:grid-cols-12">
        {/* The verdict, told as a short story */}
        <div className="min-w-0 lg:col-span-7">
          <div className="flex items-center gap-1.5">
            <IconButton label="Previous station" onClick={() => step(-1)}><ChevronLeft size={16} /></IconButton>
            <Select value={i} onChange={(e) => select(+e.target.value)} aria-label="Station" className="min-w-[200px]">
              {STATIONS.map((x, j) => <option key={x.id} value={j}>{x.name}</option>)}
            </Select>
            <IconButton label="Next station" onClick={() => step(1)}><ChevronRight size={16} /></IconButton>
          </div>

          <h2 className="t-headline mt-10 text-ink">{s.name}</h2>
          <p className="tnum t-small mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
            <Chip tone={st.tone} size="md">{st.label}</Chip>
            <span>{s.lat.toFixed(2)}°N {s.lon.toFixed(2)}°E</span><span>{s.elev} m</span><span>{stamp(k)} IST</span>
          </p>

          <div key={`${i}-${d.cls}`} className="rise mt-10 border-t border-line pt-8">
            <p className="t-h1 text-ink">{story.title}</p>
            <p className="t-lead mt-4 max-w-[62ch] text-ink-2">{story.body}</p>
          </div>

          <dl className="mt-10 grid grid-cols-3 border-t border-line">
            {[
              ['Confidence', `${Math.round(confidence(d) * 100)}%`, 'trust in the value sent on'],
              ['WMO flag', `${fl.raw} → ${fl.clean}`, `${WMO_MEANING[fl.raw]} → ${WMO_MEANING[fl.clean]}`],
              ['Sampling', d.edge?.burst ? '1 min' : '15 min', d.edge?.flags.length ? `edge flags: ${d.edge.flags.join(', ')}` : 'no edge flags'],
            ].map(([a, b, c], n) => (
              <div key={a} className={cx('min-w-0 py-6', n > 0 && 'border-l border-line pl-5')}>
                <dt className="t-caption text-muted">{a}</dt>
                <dd className="t-figure mt-2 text-[28px] text-ink">{b}</dd>
                <dd className="t-caption mt-2 truncate text-muted" title={c}>{c}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-8 border-t border-line pt-8 sm:grid-cols-2">
            {([['Legacy rule-based QC', legacy, false], ['WeatherGuard', wg, true]] as const).map(([name, v, us]) => (
              <div key={name}>
                <p className="t-caption text-muted">{name}</p>
                <p className={cx('t-h2 mt-2', us ? 'text-ink' : 'text-ink-2')}>{v.label}</p>
                <p className="t-small mt-1.5 text-muted">{v.note}</p>
                <p className={cx('t-caption mt-3', v.right ? 'text-ok' : 'text-fault')}>{v.right ? 'Correct' : v.wrong}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How it was judged */}
        <aside className="min-w-0 lg:col-span-5 lg:border-l lg:border-line lg:pl-12">
          <h2 className="t-h2 text-ink">Five checks, in order</h2>
          <p className="t-small mt-1.5 text-muted">Any check can stop, keep or repair the reading.</p>
          <div className="mt-8"><GateStepper /></div>
          <div className="mt-8 border-t border-line pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-small text-ink-2">Multivariate anomaly score</span>
              <span className="t-figure text-[22px] text-ink">{o ? d.score.toFixed(1) : '—'}</span>
            </div>
            <div className="relative mt-3 h-[3px] bg-line">
              <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${Math.min(100, (d.score / 10) * 100)}%`, background: d.score > 6.5 ? 'var(--fault)' : 'var(--ink)' }} />
              <span className="absolute -bottom-1.5 -top-1.5 w-px bg-ink-2" style={{ left: '65%' }} title="Review threshold" />
            </div>
            <p className="t-caption mt-3 text-muted">{backend.scorer === 'lstm' ? `LSTM autoencoder reconstruction error over the last four hours of ${backend.spatial === 'st-gnn' ? 'ST-GNN' : 'neighbour'} residuals. The mark is the 99.9th percentile of normal behaviour.` : 'PCA-whitened residuals learned in the first nine hours. The mark is the review threshold.'}</p>
          </div>
        </aside>
      </div>

      <Card>
        <CardHead title="Reported against expected" hint={backend.spatial === 'st-gnn' ? 'Expected values come from the ST-GNN (neighbours, terrain, previous step) and radar.' : 'Expected values come from altitude-corrected neighbours and radar.'} />
        <ReadingsTable />
      </Card>

      <Card>
        <CardHead title="The last 24 hours" hint="Did the sensor stray from what its neighbours predict?"
          right={<div className="flex flex-wrap gap-5 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-2"><span className="h-px w-5 bg-ink" />Reported</span>
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-5 bg-ink/10" />Expected ±2σ</span>
            <span className="inline-flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-accent" />Sent downstream</span>
          </div>} />
        <TraceChart />
      </Card>
    </div>
  )
}
