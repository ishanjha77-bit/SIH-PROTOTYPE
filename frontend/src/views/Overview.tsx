import { Suspense, lazy, useState } from 'react'
import { EventFeed, StationList } from '../components/Blocks'
import { Case, Figures, Opening } from '../components/Hero'
import { InsightDrawer, InsightRow } from '../components/Insights'
import { MapLegend, NetworkMap } from '../components/NetworkMap'
import { Button, Segmented, Skeleton } from '../components/ui'
import { reveal } from '../intro/reveal'
import { disagreement, insights, networkSummary } from '../lib/insights'
import { stamp } from '../lib/present'
import { useConsole } from '../state/console'

// Leaflet (~150 KB) only loads if someone switches to the street map.
const LeafletMap = lazy(() => import('../components/LeafletMap').then((m) => ({ default: m.LeafletMap })))

/**
 * The overview reads top to bottom like a short report:
 * statement → one piece of proof → the numbers → what needs attention → where → the log.
 */
export function Overview() {
  const { engine: E, k, handled } = useConsole()
  const [mapStyle, setMapStyle] = useState<'schematic' | 'street'>(() => { try { return (localStorage.getItem('wg-map') as 'street') || 'schematic' } catch { return 'schematic' } })
  const setMap = (v: 'schematic' | 'street') => { setMapStyle(v); try { localStorage.setItem('wg-map', v) } catch { /* storage blocked */ } }
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const s = networkSummary(E, k)
  // Anything already acted on sinks to the bottom.
  const all = insights(E, k).sort((a, b) => Number(a.id in handled) - Number(b.id in handled))
  const done = all.filter((x) => x.id in handled).length

  // The spread shows one real disagreement; its finding lives there, so the list doesn't repeat it.
  const duel = disagreement(E, k)
  const found = !duel ? null
    : all.find((x) => x.id === (duel.kind === 'storm' ? 'storm-network' : `fault-${duel.i}`)) ?? all.find((x) => x.i === duel.i) ?? null
  // Anchor the reasoning to the station the spread shows, so the drawer continues the same story.
  const duelInsight = found && duel ? { ...found, i: duel.i } : null
  const list = all.filter((x) => x.id !== found?.id)
  const visible = showAll ? list : list.slice(0, 5)
  const open = openId && openId === duelInsight?.id ? duelInsight : all.find((x) => x.id === openId) ?? null

  return (
    <div className="fade-in">
      <Opening summary={s} />
      <Case duel={duel} insight={duelInsight} onExplain={setOpenId} m={s.m} />
      <Figures m={s.m} warn={s.warn} />

      {/* What needs attention: a list, ranked by what legacy QC gets wrong. */}
      <section aria-labelledby="attention-h" {...reveal(450)} className="grid gap-x-16 gap-y-8 border-t border-line pt-14 pb-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="attention-h" className="t-h1 text-ink">Needs attention</h2>
          <p className="t-small mt-3 max-w-[36ch] text-muted">
            Ranked by what rule-based QC gets wrong: real weather it rejects, faults it misses, failures it can't see coming.
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

      {/* Where: the map is the page's one large visual; the table sits beside it. */}
      <section {...reveal(600)} aria-labelledby="network-h" className="mt-16 border-t border-line pt-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 id="network-h" className="t-h1 text-ink">The network</h2>
            <p className="t-small mt-3 max-w-[56ch] text-muted">Twelve stations across the Konkan coast and Western Ghats, over live Doppler radar. Select a station to see its full diagnosis.</p>
          </div>
          <Segmented label="Map style" value={mapStyle} onChange={setMap} options={[{ value: 'schematic', label: 'Schematic' }, { value: 'street', label: 'Street' }]} />
        </div>
        <div className="mt-10 grid gap-x-16 gap-y-12 lg:grid-cols-12">
          <figure className="lg:col-span-6">
            {mapStyle === 'street' ? <Suspense fallback={<Skeleton className="h-[560px] w-full" />}><LeafletMap /></Suspense> : <NetworkMap />}
            <figcaption className="mt-5"><MapLegend /></figcaption>
          </figure>
          <div className="min-w-0 lg:col-span-6">
            <StationList />
            <div className="mt-14">
              <h3 className="t-h3 text-ink">Log</h3>
              <p className="t-caption mt-1 text-muted">Every change in a station's verdict, newest first.</p>
              <div className="mt-4"><EventFeed limit={6} /></div>
            </div>
          </div>
        </div>
      </section>

      <InsightDrawer insight={open} onClose={() => setOpenId(null)} />
    </div>
  )
}
