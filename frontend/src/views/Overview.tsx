import { Pause, Play, ShieldCheck, Sparkles } from 'lucide-react'
import { Suspense, lazy, useState } from 'react'
import { N, STATIONS, isFault } from '../engine/engine'
import { EventFeed, StationList } from '../components/Blocks'
import { Clock } from '../components/Shell'
import { InsightCard, InsightDrawer } from '../components/Insights'
import { MapLegend, NetworkMap } from '../components/NetworkMap'
import { AIBadge, Button, Card, CardHead, EmptyState, ProgressBar, Segmented, Skeleton, StatCard } from '../components/ui'
import { greeting, insights, networkSummary, type Insight } from '../lib/insights'
import { pct, stamp, statusOf } from '../lib/present'
import { useConsole } from '../state/console'

// Leaflet (~150 KB) only loads if someone switches to the street map.
const LeafletMap = lazy(() => import('../components/LeafletMap').then((m) => ({ default: m.LeafletMap })))

export function Overview() {
  const { engine: E, k, setTour, playing, toggle, handled } = useConsole()
  const [mapStyle, setMapStyle] = useState<'schematic' | 'street'>(() => { try { return (localStorage.getItem('wg-map') as 'street') || 'schematic' } catch { return 'schematic' } })
  const setMap = (v: 'schematic' | 'street') => { setMapStyle(v); try { localStorage.setItem('wg-map', v) } catch { /* storage blocked */ } }
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const s = networkSummary(E, k)
  // Anything already acted on sinks to the bottom; the top finding is always something still open.
  const all = insights(E, k).sort((a, b) => Number(a.id in handled) - Number(b.id in handled))
  const done = all.filter((x) => x.id in handled).length
  const open = all.find((x) => x.id === openId) ?? null
  const [lead, ...rest] = all
  const visibleRest = showAll ? rest : rest.slice(0, 3)
  const now = E.OUT[k]

  return (
    <div className="fade-in flex flex-col gap-8">
      {/* ---------- Hero: the one thing to know ---------- */}
      <section className="hero-glow relative overflow-hidden rounded-2xl border border-line lg:mt-3 bg-surface px-5 py-7 shadow-soft sm:px-8 sm:py-9">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="eyebrow">{greeting(k)} · Konkan–Ghats network</span>
            </div>
            <h1 className="t-h1 mt-3 max-w-[22ch] text-ink sm:text-[34px]">{s.title}</h1>
            <p className="t-body mt-3 max-w-[56ch] text-ink-2">{s.headline}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setTour(0)} icon={<Sparkles size={15} />}>Take the 2-minute tour</Button>
              <Button onClick={toggle} icon={playing ? <Pause size={14} /> : <Play size={14} />}>{playing ? 'Pause stream' : 'Play live stream'}</Button>
            </div>
          </div>

          <div className="min-w-0 lg:justify-self-end lg:text-right">
            <div className="mb-6 hidden lg:flex lg:justify-end"><Clock /></div>
            <div className="t-caption text-muted">Stations sending trustworthy data</div>
            <div className="t-display mt-2 text-ink">{s.trusted}<span className="text-muted">/{N}</span></div>
            <ul className="mt-4 flex gap-1 lg:ml-auto lg:max-w-[280px]" aria-label="Status of each station">
              {now.map((d, i) => (
                <li key={i} title={`${STATIONS[i].name}: ${statusOf(d).label}`} aria-label={`${STATIONS[i].name}: ${statusOf(d).label}`}
                  className="h-1.5 flex-1 rounded-full transition-colors duration-300"
                  style={{ background: isFault(d.cls) ? 'var(--fault)' : d.cls === 'SEVERE' ? 'var(--storm)' : d.warn ? 'var(--warn)' : 'var(--ok)' }} />
              ))}
            </ul>
            <div className="t-caption mt-2 text-muted">{s.storming.length} severe · {s.faulty} faulty · {s.warn} warning{s.warn === 1 ? '' : 's'}</div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line pt-6 md:grid-cols-4">
          <StatCard label="Faulty readings caught" value={pct(s.m.wg.rec)} foot={`vs ${pct(s.m.lg.rec)} with legacy QC`} />
          <StatCard label="Good readings wrongly rejected" value={s.m.wg.fp} foot={`vs ${s.m.lg.fp} with legacy QC`} />
          <StatCard label="Storm readings kept" value={s.m.storm ? pct(1 - s.m.stormWg / s.m.storm) : '—'}
            foot={s.m.storm ? `vs ${pct(1 - s.m.stormLeg / s.m.storm)} with legacy QC` : 'Storm has not arrived yet'} />
          <StatCard label="Failures predicted early" value={s.warn} unit={s.warn === 1 ? 'station' : 'stations'} foot="Legacy QC can't predict" />
        </div>
      </section>

      {/* ---------- AI insights: the wow moment ---------- */}
      <section aria-labelledby="insights-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5"><h2 id="insights-h" className="t-h2">What needs your attention</h2><AIBadge>{all.length} AI findings</AIBadge></div>
            <p className="t-small mt-1 text-muted">Findings from the five-gate pipeline, ranked by what legacy QC gets wrong.</p>
          </div>
          <div className="flex items-center gap-4">
            {done > 0 && (
              <div className="flex items-center gap-2.5" role="status">
                <ProgressBar value={done / all.length} tone="ok" className="w-20" label="Findings handled" />
                <span className="t-caption tnum text-ink-2">{done} of {all.length} handled</span>
              </div>
            )}
            {rest.length > 3 && <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${all.length}`}</Button>}
          </div>
        </div>
        {lead ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <InsightCard key={lead.id} insight={lead} featured onExplain={() => setOpenId(lead.id)} />
            <div className="flex flex-col gap-3">
              {visibleRest.map((n: Insight, j) => (
                <InsightCard key={n.id} insight={n} onExplain={() => setOpenId(n.id)} style={{ animationDelay: `${60 + j * 50}ms` }} />
              ))}
              {!visibleRest.length && (
                <EmptyState icon={<ShieldCheck size={18} />} title="Nothing else to flag">The rest of the network passed every check at {stamp(k)}.</EmptyState>
              )}
            </div>
          </div>
        ) : (
          <EmptyState icon={<ShieldCheck size={18} />} title="All clear">
            Every station passed all five checks at {stamp(k)}. Drag the timeline into the storm window, or break a station in the Fault lab.
          </EmptyState>
        )}
      </section>

      {/* ---------- Where, and the full picture ---------- */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Card>
          <CardHead title="Network map" hint="Live Doppler radar with each station's verdict. Select a station to inspect it."
            right={<Segmented label="Map style" value={mapStyle} onChange={setMap} options={[{ value: 'schematic', label: 'Schematic' }, { value: 'street', label: 'Street' }]} />} />
          {mapStyle === 'street' ? <Suspense fallback={<Skeleton className="h-[560px] w-full !rounded-[22px]" />}><LeafletMap /></Suspense> : <NetworkMap />}
          <div className="mt-5"><MapLegend /></div>
        </Card>
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHead title="Stations" hint="Latest reading and verdict. Select one for its full diagnosis." />
            <StationList />
          </Card>
          <Card>
            <CardHead title="Recent activity" hint="Every change in a station's verdict, newest first" />
            <EventFeed limit={6} />
          </Card>
        </div>
      </div>

      <InsightDrawer insight={open} onClose={() => setOpenId(null)} />
    </div>
  )
}
