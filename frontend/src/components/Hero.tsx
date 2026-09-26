import { ArrowRight } from 'lucide-react'
import { STATIONS, type Metrics } from '../engine/engine'
import { reveal } from '../intro/reveal'
import type { Disagreement, Insight } from '../lib/insights'
import { clock } from '../lib/present'
import { useConsole } from '../state/console'
import { Button } from './ui'

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
