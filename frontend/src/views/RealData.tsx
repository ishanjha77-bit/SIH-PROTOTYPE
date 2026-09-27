import { scaleLinear } from 'd3-scale'
import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardHead, Chip, EmptyState, Select, SkeletonRows, StatCard, cx } from '../components/ui'
import { CLASS_TONE, loadRealData, type RealCase, type RealData } from '../lib/realdata'
import { TONE, pct } from '../lib/present'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function RealData() {
  const [data, setData] = useState<RealData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [station, setStation] = useState('mahabaleshwar')
  const [month, setMonth] = useState(3) // April (0-based)
  const [focus, setFocus] = useState<string | null>(null)
  const explorer = useRef<HTMLElement>(null)

  useEffect(() => { loadRealData().then(setData, (e: Error) => setError(e.message)) }, [])

  if (error) return <EmptyState title="Couldn't load the real-data results">The file realdata/konkan-2023.json is missing ({error}). Build it with <span className="font-mono">python -m app.realdata.build --year 2023</span>.</EmptyState>
  if (!data) return <div className="py-10"><SkeletonRows rows={6} /></div>

  const s = data.summary
  const hero = data.showcase.find((c) => c.cls === 'WEATHER' && c.noaa && c.evidence.some((e) => e.includes('thunderstorm'))) ?? data.showcase[0]
  const open = (c: RealCase) => {
    setStation(c.station); setMonth(new Date(c.t).getUTCMonth()); setFocus(c.t)
    explorer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex flex-col gap-20">
      {/* Provenance first: judges should know exactly what this is. */}
      <p className="t-small -mt-4 max-w-[80ch] text-ink-2">
        <span className="mr-2 rounded-[3px] border border-ink/60 px-1.5 py-px text-[11.5px] text-ink">Real observations</span>
        {data.stations.length} IMD synoptic stations, every 3-hourly report of {data.source.year}, from the{' '}
        <a href={data.source.url} target="_blank" rel="noreferrer" className="link">NOAA Integrated Surface Database</a>.
        The same stations the simulation models.
      </p>

      <section aria-label="Results on real data" className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
        {[
          { v: s.readings.toLocaleString('en-IN'), l: 'real readings checked', f: `${data.stations.length} stations · ${data.source.year}` },
          { v: String(s.noaaFlags), l: 'flagged "suspect" by NOAA\'s rule-based QC', f: 'the legacy baseline' },
          { v: String(s.noaaOnly), l: 'of those consistent with their neighbours', f: s.noaaOnlyMedianZ != null ? `median ${s.noaaOnlyMedianZ}σ from the neighbour estimate; ${pct(s.noaaOnlyWithinZ2)} within 2σ` : undefined },
          { v: String(s.byClass.WEATHER ?? 0), l: 'extreme readings kept as real weather', f: `${s.weatherNoaaFlagged} of them NOAA had flagged` },
        ].map((c, i) => (
          <StatCard key={c.l} value={c.v} label={c.l} foot={c.f}
            className={cx('py-10 pr-6', i % 2 === 1 && 'border-l border-line pl-6', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l lg:pl-6')} />
        ))}
      </section>

      {/* The case in point, from real data */}
      {hero && (
        <section aria-labelledby="real-case-h" className="border-t border-line pt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <h2 id="real-case-h" className="eyebrow">A real storm, a real false alarm</h2>
            <p className="tnum t-small text-muted">{hero.name} · {hero.when} · reported {hero.T.toFixed(1)} °C, neighbours predict {hero.expected?.toFixed(1)} °C</p>
          </div>
          <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-0">
            <div className="md:pr-12">
              <p className="t-small text-muted">NOAA automated QC</p>
              <p className="t-headline mt-3 text-muted">Marked suspect.</p>
              <p className="t-small mt-4 max-w-[44ch] text-muted">A {Math.abs((hero.expected ?? hero.T) - hero.T).toFixed(0)} °C drop against the neighbours looks like a sensor error to a rule.</p>
            </div>
            <div className="border-t border-line pt-10 md:border-l md:border-t-0 md:pl-12 md:pt-0">
              <p className="t-small flex items-center gap-2 text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-storm" />WeatherGuard</p>
              <p className="t-headline mt-3 text-ink">Kept as real weather.</p>
              <ul className="t-small mt-4 max-w-[48ch] text-ink-2">
                {hero.evidence.map((e) => <li key={e} className="border-b border-line py-1.5 first:pt-0">{e.charAt(0).toUpperCase() + e.slice(1)}</li>)}
              </ul>
            </div>
          </div>
          <p className="t-lead mt-10 max-w-[70ch] text-ink">
            Pre-monsoon thunderstorms cool the Western Ghats sharply. Rule-based QC throws those readings away; independent
            reports of cumulonimbus cloud, thunderstorms and rain show they are real, so WeatherGuard keeps them.
          </p>
        </section>
      )}

      {/* Everything notable WeatherGuard found */}
      <section aria-labelledby="findings-h" className="grid gap-x-16 gap-y-8 border-t border-line pt-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="findings-h" className="t-h1 text-ink">What it found</h2>
          <dl className="t-small mt-6 grid grid-cols-[1fr_auto] gap-y-2">
            {data.classes.filter((c) => c.code !== 'OK').map((c) => (
              <div key={c.code} className="contents">
                <dt className="text-ink-2"><Chip tone={CLASS_TONE[c.code]}>{c.label}</Chip></dt>
                <dd className="tnum text-right text-ink">{s.byClass[c.code] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <p className="t-caption mt-6 text-muted">Outlier line {data.thresholds.zOutlier}σ from a robust neighbour estimate. Weather evidence searched within {data.thresholds.weatherRadiusKm} km.</p>
        </div>
        <ul className="border-t border-line lg:col-span-8">
          {data.showcase.map((c) => (
            <li key={c.station + c.t}>
              <button type="button" onClick={() => open(c)}
                className="group grid w-full grid-cols-[10px_1fr_auto] items-baseline gap-x-4 gap-y-1 border-b border-line py-4 text-left transition-colors duration-150 hover:bg-sunken/60 sm:-mx-2 sm:px-2">
                <span className="h-1.5 w-1.5 translate-y-[-2px] rounded-full" style={{ background: TONE[CLASS_TONE[c.cls]].hex }} />
                <span className="min-w-0">
                  <span className="t-h3 block text-ink">{c.name}: {c.label.toLowerCase()}</span>
                  <span className="t-small mt-0.5 block text-muted">{c.reason}{c.evidence.length > 0 && ` Evidence: ${c.evidence.slice(0, 2).join('; ')}.`}</span>
                </span>
                <span className="tnum t-caption text-right text-muted">
                  {c.when.replace(', ', ' · ')}
                  <span className="block">{c.T.toFixed(1)} °C · {c.z != null ? `${c.z > 0 ? '+' : ''}${c.z}σ` : '—'}{c.noaa && <span className="text-ink-2"> · NOAA flagged</span>}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Explorer ref={explorer} data={data} station={station} setStation={setStation} month={month} setMonth={setMonth} focus={focus} />

      <Card>
        <CardHead title="What this does and doesn't show" />
        <div className="grid gap-x-16 gap-y-6 text-[14px] md:grid-cols-2">
          <ul className="flex flex-col gap-2 text-ink-2">
            <li><span className="text-ink">Real:</span> every observation, every NOAA flag, every thunderstorm and rain report.</li>
            <li><span className="text-ink">Runs here:</span> the physics, stuck-sensor, spike and neighbour-consistency checks, and weather evidence from station reports in place of radar.</li>
          </ul>
          <ul className="flex flex-col gap-2 text-ink-2">
            <li><span className="text-ink">Not claimed:</span> real data has no ground truth, so these are inconsistencies, not confirmed faults.</li>
            <li><span className="text-ink">Not yet applied:</span> the ST-GNN and LSTM autoencoder were trained on simulated 15-minute data. Retraining on real series is the next step. <a href={data.source.url} target="_blank" rel="noreferrer" className="link">Data source <ArrowUpRight size={12} className="inline" /></a></li>
          </ul>
        </div>
      </Card>
    </div>
  )
}

/* ---------------- One station, one month: reading vs neighbour estimate, with every flag ---------------- */
function Explorer({ ref, data, station, setStation, month, setMonth, focus }: {
  ref: React.Ref<HTMLElement>; data: RealData; station: string; setStation: (s: string) => void; month: number; setMonth: (m: number) => void; focus: string | null
}) {
  const t0 = useMemo(() => new Date(data.t0).getTime(), [data.t0])
  const ser = data.series[station]
  const idx = useMemo(() => ser.T.map((_, i) => i).filter((i) => new Date(t0 + i * 3 * 3600e3).getUTCMonth() === month), [ser, t0, month])
  const pts = idx.filter((i) => ser.T[i] != null)
  const codes = data.classes.map((c) => c.code)
  const focusI = focus ? Math.round((new Date(focus).getTime() - t0) / (3 * 3600e3)) : -1

  const W = 1000, H = 300, L = 40, R = 990, TOP = 16, BOT = 270
  const vals = pts.flatMap((i) => [ser.T[i]!, ser.E[i] ?? ser.T[i]!])
  const y = scaleLinear().domain(vals.length ? [Math.min(...vals) - 1, Math.max(...vals) + 1] : [0, 1]).nice(5).range([BOT, TOP])
  const x = scaleLinear().domain([idx[0] ?? 0, idx[idx.length - 1] ?? 1]).range([L, R])
  // Bridge gaps of up to 12 h (many stations skip night reports); longer gaps break the line.
  const line = (key: 'T' | 'E') => {
    let d = '', last = -99
    for (const i of idx) {
      const v = ser[key][i]
      if (v == null) continue
      d += `${i - last <= 4 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; last = i
    }
    return d
  }
  const flagged = pts.filter((i) => ser.C[i] != null && codes[ser.C[i]!] !== 'OK')
  const noaa = pts.filter((i) => ser.N[i])

  return (
    <section ref={ref} aria-labelledby="explorer-h" className="scroll-mt-16 border-t border-line pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 id="explorer-h" className="t-h1 text-ink">Explore the real record</h2>
          <p className="t-small mt-2 max-w-[60ch] text-muted">Each station's reported temperature against what its neighbours predict for it, with WeatherGuard's findings and NOAA's flags.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Station" value={station} onChange={(e) => setStation(e.target.value)} className="min-w-[180px]">
            {data.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(+e.target.value)} className="min-w-[140px]">
            {MONTHS.map((m, i) => <option key={m} value={i}>{m} {data.source.year}</option>)}
          </Select>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-2"><span className="h-px w-5 bg-ink" />Reported</span>
        <span className="inline-flex items-center gap-2"><span className="w-5 border-t border-dashed border-muted" />Neighbour estimate</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-storm" />Real weather, kept</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-fault" />Rejected</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-warn" />Review</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border border-ink-2" />NOAA flagged</span>
      </div>
      {pts.length < 5 ? (
        <EmptyState title="Too few reports">This station sent too few 3-hourly reports in {MONTHS[month]} to chart.</EmptyState>
      ) : (
        <div className="scroll-soft mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[560px]" role="img" aria-label={`Temperature at ${station} in ${MONTHS[month]}`}>
            {y.ticks(5).map((v) => (
              <g key={v}>
                <line x1={L} x2={R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)' }} />
                <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--muted)' }}>{v}°</text>
              </g>
            ))}
            {idx.filter((i) => new Date(t0 + i * 3 * 3600e3).getUTCHours() === 0 && new Date(t0 + i * 3 * 3600e3).getUTCDate() % 5 === 1).map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>{new Date(t0 + i * 3 * 3600e3).getUTCDate()}</text>
            ))}
            {focusI >= idx[0] && focusI <= idx[idx.length - 1] && <line x1={x(focusI)} x2={x(focusI)} y1={TOP} y2={BOT} style={{ stroke: 'var(--accent)' }} strokeDasharray="3 3" />}
            <path d={line('E')} fill="none" style={{ stroke: 'var(--muted)' }} strokeWidth="1.2" strokeDasharray="4 4" />
            <path d={line('T')} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.2" strokeLinejoin="round" />
            {pts.map((i) => <circle key={`p${i}`} cx={x(i)} cy={y(ser.T[i]!)} r="1.6" style={{ fill: 'var(--ink)' }} />)}
            {noaa.map((i) => <circle key={`n${i}`} cx={x(i)} cy={y(ser.T[i]!)} r="6" fill="none" style={{ stroke: 'var(--ink-2)' }} strokeWidth="1.2" />)}
            {flagged.map((i) => {
              const c = codes[ser.C[i]!]
              return <circle key={`f${i}`} cx={x(i)} cy={y(ser.T[i]!)} r="3.5" style={{ fill: TONE[CLASS_TONE[c]].hex }}><title>{c}</title></circle>
            })}
          </svg>
        </div>
      )}
      <p className="tnum t-caption mt-3 text-muted">{pts.length} reports this month · {flagged.length} flagged by WeatherGuard · {noaa.length} flagged by NOAA</p>
    </section>
  )
}
