import { ArrowUpRight, CloudLightning, ShieldCheck, Sparkles, Timer, Waves } from 'lucide-react'
import { N, STATIONS, isFault, metrics } from '../engine/engine'
import { EventFeed, StationList } from '../components/Blocks'
import { MapLegend, NetworkMap } from '../components/NetworkMap'
import { Card, CardHead, CompareBars, Segmented } from '../components/ui'
import { LeafletMap } from '../components/LeafletMap'
import { useState } from 'react'
import { TONE, pct } from '../lib/present'
import { useConsole } from '../state/console'

export function Overview() {
  const { engine: E, k, setView } = useConsole()
  const [mapStyle, setMapStyle] = useState<'schematic' | 'street'>(() => { try { return (localStorage.getItem('wg-map') as 'street') || 'schematic' } catch { return 'schematic' } })
  const setMap = (v: 'schematic' | 'street') => { setMapStyle(v); try { localStorage.setItem('wg-map', v) } catch { /* storage blocked */ } }
  const m = metrics(E, k)
  const bursting = E.OUT[k].filter((d) => d.edge?.burst).length
  const now = E.OUT[k]
  const storming = STATIONS.filter((_, i) => now[i].cls === 'SEVERE').map((s) => s.name.split(' ')[0])
  const faulty = now.filter((d) => isFault(d.cls)).length
  const warn = now.filter((d) => d.warn).length
  const clean = N - faulty
  const legacyFalseNow = now.filter((d, i) => E.LEG[k][i].flag && !isFault(d.cls)).length

  const headline = storming.length
    ? `A squall line is over ${storming.slice(0, 3).join(', ')}${storming.length > 3 ? ` and ${storming.length - 3} more` : ''}. Those readings are extreme but real, so they stay in the record.`
    : faulty ? `Skies are calm. ${faulty} station${faulty > 1 ? 's need' : ' needs'} attention and ${faulty > 1 ? 'are' : 'is'} being filled by virtual sensors.`
      : 'All stations are reporting clean, physically consistent data.'

  return (
    <div className="fade-in flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)' }} />
          <div className="relative">
            <div className="eyebrow">Right now</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tnum text-[56px] font-semibold leading-none tracking-tight">{clean}<span className="text-muted">/{N}</span></span>
              <span className="text-[15px] text-ink-2">stations sending trustworthy data</span>
            </div>
            <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-ink">{headline}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Pill icon={CloudLightning} tone="storm" label={`${storming.length} under severe weather`} />
              <Pill icon={Waves} tone="fault" label={`${faulty} sensor faults`} />
              {warn > 0 && <Pill icon={Sparkles} tone="warn" label={`${warn} predictive warning${warn > 1 ? 's' : ''}`} />}
              {bursting > 0 && <Pill icon={Timer} tone="storm" label={`${bursting} in 1-min burst mode`} />}
              {legacyFalseNow > 0 && <Pill icon={ShieldCheck} tone="ok" label={`${legacyFalseNow} legacy false alarm${legacyFalseNow > 1 ? 's' : ''} overruled`} />}
            </div>
          </div>
        </Card>
        <Card>
          <CardHead title="WeatherGuard vs legacy QC" hint="Scored live against injected ground truth"
            right={<button type="button" onClick={() => setView('evaluation')} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">Details <ArrowUpRight size={14} /></button>} />
          <div className="grid gap-5">
            <Metric label="Faults caught" hint="recall">
              <CompareBars wg={m.wg.rec ?? 0} legacy={m.lg.rec ?? 0} max={1} fmt={(v) => pct(v)} />
            </Metric>
            <Metric label="Good data wrongly rejected" hint="false alarms, lower is better">
              <CompareBars wg={m.wg.fp} legacy={m.lg.fp} max={Math.max(m.wg.fp, m.lg.fp, 1)} fmt={(v) => String(v)} better="low" />
            </Metric>
            <Metric label="Storm observations kept" hint={m.storm ? `${m.storm} so far` : 'storm not arrived yet'}>
              <CompareBars wg={m.storm ? 1 - m.stormWg / m.storm : 1} legacy={m.storm ? 1 - m.stormLeg / m.storm : 1} max={1} fmt={(v) => pct(v)} />
            </Metric>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHead title="Konkan–Ghats network" hint="Live Doppler radar with station verdicts"
            right={<Segmented label="Map style" value={mapStyle} onChange={setMap} options={[{ value: 'schematic', label: 'Schematic' }, { value: 'street', label: 'Street map' }]} />} />
          {mapStyle === 'street' ? <LeafletMap /> : <NetworkMap />}
          <div className="mt-5"><MapLegend /></div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHead title="Stations" hint="Select one to open its diagnosis" />
            <StationList />
          </Card>
          <Card>
            <CardHead title="Recent activity" />
            <EventFeed limit={7} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2"><span className="text-[13.5px] font-medium">{label}</span><span className="text-[11.5px] text-muted">{hint}</span></div>
      {children}
    </div>
  )
}

function Pill({ icon: Icon, tone, label }: { icon: typeof Waves; tone: 'storm' | 'fault' | 'warn' | 'ok'; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-medium ${TONE[tone].bg} ${TONE[tone].fg}`}>
      <Icon size={14} />{label}
    </span>
  )
}
