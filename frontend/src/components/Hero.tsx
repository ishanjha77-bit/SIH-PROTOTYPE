import { ArrowRight } from 'lucide-react'
import { N, STATIONS, isFault, type Metrics } from '../engine/engine'
import { CountUp } from '../intro/CountUp'
import { reveal } from '../intro/reveal'
import type { Disagreement, Insight } from '../lib/insights'
import { clock, pct, stamp, statusOf } from '../lib/present'
import { useConsole } from '../state/console'
import { Button, StatCard, cx } from './ui'

interface Summary { trusted: number; faulty: number; storming: string[]; warn: number; m: Metrics }

/** The opening statement: what this is, why it matters, what to do. One idea, set large. */
export function Opening({ summary: s }: { summary: Summary }) {
  const { engine: E, k, playing, toggle, setTour } = useConsole()
  return (
    <section aria-labelledby="hero-h" {...reveal(100)} className="grid gap-x-16 gap-y-12 pb-20 pt-14 sm:pt-20 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <p className="eyebrow">Quality control for automatic weather stations</p>
        <h1 id="hero-h" className="t-display mt-5 max-w-[15ch] text-ink">Tells a broken sensor from a real storm.</h1>
        <p className="t-lead mt-7 max-w-[56ch] text-ink-2">
          Forecasts depend on readings from automatic weather stations. Rule-based checks can't tell a faulty sensor
          from extreme weather, so they discard storm data and miss slow failures. WeatherGuard checks every reading
          against physics, neighbouring stations, radar and satellite, and explains each decision.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button variant="primary" onClick={() => setTour(0)}>Take the two-minute tour</Button>
          <Button variant="link" onClick={toggle} iconRight={<ArrowRight size={14} />}>{playing ? 'Pause the replay' : 'Play the replay'}</Button>
        </div>
      </div>

      {/* Right now, stated plainly. */}
      <aside aria-label="Network status" className="self-end lg:col-span-4 lg:border-l lg:border-line lg:pl-10">
        <p className="eyebrow tnum">Now · {stamp(k)} IST</p>
        <p className="mt-4 flex items-baseline gap-2">
          <span className="t-figure text-[56px] text-ink">{s.trusted}</span>
          <span className="t-lead text-muted">of {N}</span>
        </p>
        <p className="t-small mt-2 text-ink-2">stations reporting trustworthy data</p>
        <ul className="mt-5 flex max-w-[240px] gap-[3px]" aria-label="Status of each station">
          {E.OUT[k].map((d, i) => (
            <li key={i} title={`${STATIONS[i].name}: ${statusOf(d).label}`} aria-label={`${STATIONS[i].name}: ${statusOf(d).label}`}
              className="h-5 flex-1 rounded-[1px]" style={{ background: isFault(d.cls) ? 'var(--fault)' : d.cls === 'SEVERE' ? 'var(--storm)' : d.warn ? 'var(--warn)' : 'var(--line-strong)' }} />
          ))}
        </ul>
        <dl className="t-small mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
          <dt className="text-muted">Severe weather</dt><dd className="text-ink">{s.storming.length ? s.storming.join(', ') : 'None'}</dd>
          <dt className="text-muted">Sensor faults</dt><dd className="tnum text-ink">{s.faulty}</dd>
          <dt className="text-muted">Early warnings</dt><dd className="tnum text-ink">{s.warn}</dd>
        </dl>
      </aside>
    </section>
  )
}

/**
 * The proof, as a spread: one real reading, the verdict each system gave it.
 * Typography carries the contrast; there are no boxes, badges or glows.
 */
export function Case({ duel: d, insight, onExplain, m }: { duel: Disagreement | null; insight: Insight | null; onExplain: (id: string) => void; m: Metrics }) {
  const { handled } = useConsole()
  if (!d) {
    return (
      <section {...reveal(200)} className="border-t border-line py-16">
        <p className="eyebrow">One reading, two verdicts</p>
        <p className="t-h1 mt-4 max-w-[30ch] text-ink">Legacy QC and WeatherGuard agree on every reading so far.</p>
        <p className="t-lead mt-3 text-ink-2">Play the replay into the Day 2 storm to see them split.</p>
      </section>
    )
  }
  const s = STATIONS[d.i], storm = d.kind === 'storm'
  const done = insight ? insight.id in handled : false
  const kept = m.storm - m.stormWg
  return (
    <section key={`${d.i}-${d.q}`} {...reveal(200)} aria-labelledby="case-h" className="border-t border-line py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 id="case-h" className="eyebrow">One reading, two verdicts</h2>
        <p className="tnum t-small text-muted">{s.name} · Day {Math.floor(d.q / 96) + 1}, {clock(d.q)} · {d.detail}</p>
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-0">
        <div className="md:pr-12">
          <p className="t-small text-muted">Legacy rule-based QC</p>
          <p className="t-headline mt-3 text-muted">{storm ? 'Rejected as a fault.' : 'Accepted as valid.'}</p>
          <p className="t-small mt-4 max-w-[44ch] text-muted">{d.legacy}</p>
        </div>
        <div className="border-t border-line pt-10 md:border-l md:border-t-0 md:pl-12 md:pt-0">
          <p className="t-small flex items-center gap-2 text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: storm ? 'var(--storm)' : 'var(--fault)' }} />WeatherGuard
          </p>
          <p className="t-headline mt-3 text-ink">{storm ? 'Kept as severe weather.' : 'Flagged and repaired.'}</p>
          <p className="t-small mt-4 max-w-[44ch] text-ink-2">{d.wg}.</p>
        </div>
      </div>

      <div className="mt-12 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        {storm && m.storm > 0 ? (
          <p className="t-lead max-w-[72ch] text-ink">
            In this replay, legacy QC has discarded <span className="tnum">{m.stormLeg}</span> genuine storm readings.{' '}
            <span className="text-muted">WeatherGuard kept <span className="tnum">{kept === m.storm ? `all ${m.storm}` : `${kept} of ${m.storm}`}</span>.</span>
          </p>
        ) : <p className="t-lead max-w-[60ch] text-ink">A drifting sensor passes every range check, so legacy QC lets it through.</p>}
        {insight && (
          <span className="flex items-center gap-4">
            {done && <span className="t-small text-ok">Confirmed</span>}
            <Button variant="link" onClick={() => onExplain(insight.id)} iconRight={<ArrowRight size={14} />}>{done ? 'Review the reasoning' : 'See the reasoning'}</Button>
          </span>
        )}
      </div>
    </section>
  )
}

/** Four figures, set like a report: numbers lead, hairlines separate. */
export function Figures({ m, warn }: { m: Metrics; warn: number }) {
  const cells = [
    { label: 'of faulty readings caught', value: <CountUp value={m.wg.rec ?? 0} format={pct} delay={300} />, foot: `Legacy QC: ${pct(m.lg.rec)}` },
    { label: 'good readings wrongly rejected', value: <CountUp value={m.wg.fp} format={(v) => String(Math.round(v))} delay={360} />, foot: `Legacy QC: ${m.lg.fp}` },
    { label: 'of storm readings kept', value: m.storm ? <CountUp value={1 - m.stormWg / m.storm} format={pct} delay={420} /> : '—', foot: m.storm ? `Legacy QC: ${pct(1 - m.stormLeg / m.storm)}` : 'Storm not yet arrived' },
    { label: warn === 1 ? 'station warned before failing' : 'stations warned before failing', value: <CountUp value={warn} format={(v) => String(Math.round(v))} delay={480} />, foot: 'Legacy QC cannot predict' },
  ]
  return (
    <section {...reveal(300)} aria-label="Results so far" className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
      {cells.map((c, i) => (
        <StatCard key={c.label} value={c.value} label={c.label} foot={c.foot}
          className={cx('py-10 pr-6', i % 2 === 1 && 'border-l border-line pl-6', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l lg:pl-6')} />
      ))}
    </section>
  )
}
