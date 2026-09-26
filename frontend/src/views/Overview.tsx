import { useState } from 'react'
import { CommandCenter, CommandHeader } from '../components/CommandCenter'
import { Case } from '../components/Hero'
import { InsightDrawer, InsightRow } from '../components/Insights'
import { Button } from '../components/ui'
import { reveal } from '../intro/reveal'
import { disagreement, insights, networkSummary } from '../lib/insights'
import { stamp } from '../lib/present'
import { useConsole } from '../state/console'

/**
 * The command centre, in the order a judge needs it:
 * problem and live status → live network → inject a fault → detection → validation → decision → impact,
 * then the second proof (real storms are kept) and the open work queue.
 */
export function Overview() {
  const { engine: E, k, handled } = useConsole()
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const s = networkSummary(E, k)
  const all = insights(E, k).sort((a, b) => Number(a.id in handled) - Number(b.id in handled))
  const done = all.filter((x) => x.id in handled).length

  // The storm spread shows one real disagreement; its finding lives there, so the list doesn't repeat it.
  const duel = disagreement(E, k)
  const found = !duel ? null
    : all.find((x) => x.id === (duel.kind === 'storm' ? 'storm-network' : `fault-${duel.i}`)) ?? all.find((x) => x.i === duel.i) ?? null
  const duelInsight = found && duel ? { ...found, i: duel.i } : null
  const list = all.filter((x) => x.id !== found?.id)
  const visible = showAll ? list : list.slice(0, 5)
  const open = openId && openId === duelInsight?.id ? duelInsight : all.find((x) => x.id === openId) ?? null

  return (
    <div className="fade-in">
      <CommandHeader />
      <CommandCenter />

      {/* The other half of the problem: WeatherGuard also keeps what is real. */}
      <div className="mt-20">
        <Case duel={duel} insight={duelInsight} onExplain={setOpenId} m={s.m} />
      </div>

      <section aria-labelledby="attention-h" {...reveal(450)} className="grid gap-x-16 gap-y-8 border-t border-line pb-6 pt-14 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="attention-h" className="t-h1 text-ink">Needs attention</h2>
          <p className="t-small mt-3 max-w-[36ch] text-muted">
            Everything the pipeline has found right now, ranked by what rule-based QC gets wrong.
          </p>
          <p className="tnum t-small mt-6 text-ink-2">
            {list.length} open{done > 0 && <span className="text-muted"> · {done} handled</span>}
          </p>
        </div>
        <div className="lg:col-span-8">
          {visible.length ? (
            <ul className="border-t border-line">
              {visible.map((n, j) => <InsightRow key={n.id} insight={n} onOpen={() => setOpenId(n.id)} style={{ animationDelay: `${j * 40}ms` }} />)}
            </ul>
          ) : (
            <p className="t-lead border-t border-line py-8 text-ink-2">Nothing else to flag. Every other station passed all five checks at {stamp(k)}.</p>
          )}
          {list.length > 5 && (
            <div className="pt-5"><Button variant="link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${list.length}`}</Button></div>
          )}
        </div>
      </section>

      <InsightDrawer insight={open} onClose={() => setOpenId(null)} />
    </div>
  )
}
