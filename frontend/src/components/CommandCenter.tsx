import { ArrowRight, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { N, STATIONS, STEPS, isFault, metrics, stationIndex } from '../engine/engine'
import type { Cls, FaultType } from '../engine/types'
import { reveal } from '../intro/reveal'
import { CHANNEL, DBZ_CONVECTIVE, SCORE_REVIEW, SIM_FAULTS, T_STEP, V_ADC, Z_SPATIAL, findDetection, impactFor, minutes, stagesFor, type Stage } from '../lib/investigate'
import { CLS_META, pct, stamp, statusOf } from '../lib/present'
import { useConsole } from '../state/console'
import { MapLegend, NetworkMap } from './NetworkMap'
import { TourCTA } from './Tour'
import { Button, Chip, cx } from './ui'

const CRITICAL: Cls[] = ['ELECTRICAL', 'MISSING', 'FLATLINE', 'BLOCKAGE'] // the P1 work-order classes

/* ============================== Header: problem + live status ============================== */
export function CommandHeader() {
  const { engine: E, k, backend } = useConsole()
  const now = E.OUT[k]
  const active = now.filter((d) => isFault(d.cls)).length
  const critical = now.filter((d) => CRITICAL.includes(d.cls)).length
  const reliability = (N - active) / N
  const kpis: [string, string, string?][] = [
    ['Stations monitored', String(N)],
    ['Active anomalies', String(active), active ? 'text-fault' : undefined],
    ['Critical faults', String(critical), critical ? 'text-fault' : undefined],
    ['Network reliability', pct(reliability)],
  ]
  return (
    <section {...reveal(100)} aria-labelledby="cc-h" className="grid gap-x-16 gap-y-8 pb-8 pt-8 sm:pt-10 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <p className="eyebrow flex flex-wrap items-center gap-x-2">
          <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-line-strong px-1.5 py-px text-[11.5px] text-ink-2">Simulation</span>
          <span className="tnum">Konkan–Western Ghats · {stamp(k)} IST · {backend.source === 'api' ? 'FastAPI server' : 'in-browser engine'}</span>
        </p>
        <h1 id="cc-h" className="t-headline mt-3 text-ink">WeatherGuard</h1>
        <p className="t-h2 mt-1 text-ink-2">Real-time weather sensor intelligence.</p>
        <p className="t-small mt-3 max-w-[58ch] text-muted">
          Weather stations fail silently. Rule-based checks can't tell a broken sensor from a real storm, so bad
          readings reach forecasts and genuine extremes get thrown away. WeatherGuard checks every reading five
          independent ways and explains each decision.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <TourCTA />
          <span className="t-small text-muted">or pick a station and simulate a fault below</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 self-end border-t border-line sm:grid-cols-4 lg:col-span-6">
        {kpis.map(([label, value, cls], n) => (
          <div key={label} className={cx('py-5 pr-4', n > 0 && 'sm:border-l sm:border-line sm:pl-5', n % 2 === 1 && 'border-l border-line pl-5 sm:pl-5', n >= 2 && 'border-t border-line sm:border-t-0')}>
            <dd className={cx('t-figure text-[36px]', cls ?? 'text-ink')}>{value}</dd>
            <dt className="t-caption mt-2 text-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ============================== Investigation state machine ============================== */
type Phase = 'idle' | 'sending' | 'replaying' | 'validating' | 'done' | 'undetected'
interface Inv { phase: Phase; i: number; type: FaultType; k0: number; from: number; fi: number; at: number; stage: number }
const IDLE: Inv = { phase: 'idle', i: -1, type: 'spike', k0: 0, from: 0, fi: -1, at: -1, stage: -1 }
const STAGE_MS = 650, REPLAY_MS = 70

function useInvestigation() {
  const c = useConsole()
  const { engine: E, backend: b } = c
  const [inv, setInv] = useState<Inv>(IDLE)
  const t0 = useRef(0)

  const start = (type: FaultType) => {
    if (c.playing) c.toggle()
    const i = c.sel, k0 = Math.min(c.k + 1, STEPS - 1)
    c.inject(STATIONS[i].id, type)
    t0.current = performance.now()
    setInv({ ...IDLE, phase: 'sending', i, type, k0, from: c.k })
  }
  const clear = () => { c.reset(); setInv(IDLE) }

  // 1. Wait until the pipeline has processed the new fault (the server, if it's the active engine).
  useEffect(() => {
    if (inv.phase !== 'sending') return
    const fi = E.faults.findIndex((f) => f.user && f.st === STATIONS[inv.i].id && f.type === inv.type && f.k0 === inv.k0)
    const settled = b.want !== 'api' || b.status !== 'online' || (!b.busy && b.source === 'api')
    if (fi < 0 || !settled) return
    const t = window.setTimeout(() => {
      const det = findDetection(E, fi)
      setInv((s) => det ? { ...s, phase: 'replaying', fi, at: det.at } : { ...s, phase: 'undetected', fi })
    }, Math.max(0, 700 - (performance.now() - t0.current)))
    return () => clearTimeout(t)
  }, [inv.phase, inv.i, inv.type, inv.k0, E, b.want, b.status, b.busy, b.source])

  // 2. Replay the data forward until the moment WeatherGuard detects it.
  useEffect(() => {
    if (inv.phase !== 'replaying') return
    const id = window.setInterval(() => {
      if (c.k >= inv.at) { setInv((s) => ({ ...s, phase: 'validating', stage: 0 })); return }
      c.setK(Math.min(inv.at, c.k + 1))
    }, REPLAY_MS)
    return () => clearInterval(id)
  }, [inv.phase, inv.at, c])

  // 3. Walk through the validation stages, one at a time.
  useEffect(() => {
    if (inv.phase !== 'validating') return
    const id = window.setTimeout(() => setInv((s) => (s.stage >= 7 ? { ...s, phase: 'done' } : { ...s, stage: s.stage + 1 })), STAGE_MS)
    return () => clearTimeout(id)
  }, [inv.phase, inv.stage])

  return { inv, start, clear }
}

/* ============================== Live command centre ============================== */
export function CommandCenter() {
  const c = useConsole()
  const { sel } = c
  const { inv, start, clear } = useInvestigation()
  const [type, setType] = useState<FaultType>('flatline')
  const running = inv.phase !== 'idle'
  const i = running ? inv.i : sel
  const results = useRef<HTMLDivElement>(null)

  // Open on a calm, healthy station so the first simulated fault is unambiguous.
  useEffect(() => {
    const d = c.engine.OUT[c.k][c.sel]
    if (d.cls !== 'VALID' || d.warn || d.ctx.convective) c.select(stationIndex('alibag'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const live = useRef<HTMLElement>(null)
  // Keep the action on screen: the live panel when the fault is injected, the decision when it lands.
  useEffect(() => {
    if (inv.phase === 'sending') live.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (inv.phase === 'done') results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [inv.phase])

  return (
    <>
      <section ref={live} {...reveal(200)} aria-labelledby="live-h" className="scroll-mt-14 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="live-h" className="t-h2 text-ink">Live network</h2>
          <p className="t-small text-muted">Select a station on the map, then simulate a fault on it.</p>
        </div>
        <div className="mt-6 grid gap-x-14 gap-y-12 lg:grid-cols-12">
          <figure className="lg:col-span-5">
            <NetworkMap />
            <figcaption className="mt-4"><MapLegend /></figcaption>
          </figure>
          <div className="min-w-0 lg:col-span-7">
            <StationReadout i={i} compact={running} />
            {!running && <Simulator i={i} type={type} setType={setType} onStart={() => start(type)} />}
            {running && <Investigation inv={inv} onClear={clear} />}
          </div>
        </div>
      </section>

      <div ref={results} className="scroll-mt-20">
        {inv.phase === 'done' && <><Decision inv={inv} /><Why inv={inv} /></>}
        <Impact inv={inv} />
      </div>
    </>
  )
}

/* ------------------------------ Station readout ------------------------------ */
function StationReadout({ i, compact }: { i: number; compact: boolean }) {
  const { engine: E, k } = useConsole()
  const s = STATIONS[i], d = E.OUT[k][i], o = E.RAW[k][i], p = k > 0 ? E.RAW[k - 1][i] : null, st = statusOf(d)
  const rows: [string, string, 'T' | 'RH' | 'P' | 'W' | 'R' | 'V', string, number][] = [
    ['Temperature', 'T', 'T', '°C', 1], ['Humidity', 'RH', 'RH', '%', 1], ['Pressure', 'P', 'P', 'hPa', 1],
    ['Wind', 'W', 'W', 'm/s', 1], ['Rain', 'R', 'R', 'mm', 1], ['Battery', 'V', 'V', 'V', 2],
  ]
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="t-h1 text-ink">{s.name}</h3>
        <Chip tone={st.tone} size="md">{st.label}</Chip>
      </div>
      <p className="tnum t-caption mt-1 text-muted">{s.elev} m · {s.lat.toFixed(2)}°N {s.lon.toFixed(2)}°E · reading at {stamp(k)} IST</p>
      {!compact && <dl className="mt-4 grid grid-cols-3 border-t border-line sm:grid-cols-6">
        {rows.map(([label, , key, unit, dp], n) => {
          const v = o ? o[key] : null, pv = p ? p[key] : null, dv = v != null && pv != null ? v - pv : null
          return (
            <div key={key} className={cx('py-4 pr-3', n % 3 !== 0 && 'border-l border-line pl-3', n >= 3 && 'border-t border-line sm:border-t-0', n === 3 && 'sm:border-l sm:pl-3')}>
              <dt className="t-caption text-muted">{label}</dt>
              <dd className="t-figure mt-1.5 text-[22px] text-ink">{v != null ? v.toFixed(dp) : '—'}<span className="ml-1 text-[12px] text-muted">{unit}</span></dd>
              <dd className={cx('tnum t-caption mt-1', dv && Math.abs(dv) > (key === 'T' ? T_STEP : Infinity) ? 'text-fault' : 'text-muted')}>{dv == null ? '—' : `${dv >= 0 ? '+' : ''}${dv.toFixed(dp)} in 15 min`}</dd>
            </div>
          )
        })}
      </dl>}
    </div>
  )
}

/* ------------------------------ Fault simulator ------------------------------ */
function Simulator({ i, type, setType, onStart }: { i: number; type: FaultType; setType: (t: FaultType) => void; onStart: () => void }) {
  const { engine: E, k } = useConsole()
  const busyStation = isFault(E.OUT[k][i].cls)
  return (
    <div className="mt-6 rounded-lg border border-line p-5">
      <h3 className="t-h3 text-ink">Simulate a sensor fault at {STATIONS[i].name}</h3>
      <p className="t-small mt-1 text-muted">The fault is injected into the replay from the next reading and processed by the real pipeline. Nothing below is scripted.</p>
      <div role="radiogroup" aria-label="Fault type" className="mt-5 grid gap-2 sm:grid-cols-4">
        {SIM_FAULTS.map((f) => (
          <button key={f.type} type="button" role="radio" aria-checked={type === f.type} onClick={() => setType(f.type)}
            className={cx('rounded-md border px-3 py-2.5 text-left transition-colors duration-150', type === f.type ? 'border-ink bg-sunken' : 'border-line hover:border-line-strong')}>
            <span className="block text-[14px] text-ink">{f.label}</span>
            <span className="t-caption block text-muted">{f.hint}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={onStart} disabled={k >= STEPS - 2}>Simulate sensor fault</Button>
        {busyStation && <span className="t-caption text-muted">This station already has a fault; results will include both.</span>}
      </div>
    </div>
  )
}

/* ------------------------------ The pipeline, stage by stage ------------------------------ */
const STAGE_TONE: Record<Stage['status'], string> = { flag: 'text-fault', warn: 'text-warn', weather: 'text-storm', pass: 'text-ink-2', info: 'text-ink-2' }

function Investigation({ inv, onClear }: { inv: Inv; onClear: () => void }) {
  const { engine: E, k, backend } = useConsole()
  const ch = CHANNEL[inv.type]
  const before = E.RAW[inv.from]?.[inv.i], now = E.RAW[k][inv.i]
  const detected = inv.phase === 'validating' || inv.phase === 'done'
  const stages = inv.at >= 0 ? stagesFor(E, inv.at, inv.i, inv.type) : []
  const lastDone = inv.phase === 'done' ? 7 : inv.stage
  const status = inv.phase === 'sending' ? `Injecting the fault and running the pipeline on the ${backend.want === 'api' && backend.status === 'online' ? 'server' : 'in-browser engine'}…`
    : inv.phase === 'replaying' ? `Streaming readings… ${stamp(k)}`
      : inv.phase === 'undetected' ? 'Not detected before the replay ends. Reset and try earlier in the replay.'
        : `Detected at ${stamp(inv.at)}${inv.at > inv.k0 ? `, ${minutes(inv.at - inv.k0)} after the fault began` : ', on the first faulty reading'}`

  return (
    <div className="mt-6" aria-live="polite">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="eyebrow">{SIM_FAULTS.find((f) => f.type === inv.type)?.label} injected at {STATIONS[inv.i].name}</p>
          <p className="t-headline tnum mt-2 text-ink">
            {before ? (before[ch.key] as number).toFixed(ch.dp) : '—'}
            <span className="mx-3 text-muted">→</span>
            <span className={detected ? 'text-fault' : 'text-ink'}>{now ? (now[ch.key] as number).toFixed(ch.dp) : '—'}</span>
            <span className="ml-2 text-[18px] text-muted">{ch.unit}</span>
          </p>
          <p className="t-small mt-1 text-muted">{ch.label}</p>
        </div>
        <div className="text-right">
          {detected && <p className="text-[13px] font-semibold tracking-[0.04em] text-fault">ANOMALY DETECTED</p>}
          <p className="tnum t-caption mt-1 max-w-[34ch] text-muted">{status}</p>
        </div>
      </div>

      <ol className="mt-1">
        {(stages.length ? stages : placeholderStages).map((s, n) => {
          const done = detected && n <= inv.stage || inv.phase === 'done'
          const active = inv.phase === 'validating' && n === inv.stage + 1
          return (
            <li key={s.id} title={done ? s.detail : undefined}
              className={cx('grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 border-b border-line py-2.5 transition-opacity duration-300 sm:grid-cols-[20px_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center', !done && !active && 'opacity-35')}>
              <span className="tnum text-[12.5px] text-muted">{n + 1}</span>
              <span className="min-w-0 truncate text-[14px] text-ink">{s.name} <span className="t-caption ml-1.5 text-muted">{s.method}</span></span>
              <span className="col-start-2 sm:col-start-auto">{done && s.measure ? <Measure m={s.measure} status={s.status} /> : null}</span>
              <span className={cx('col-start-2 text-[13px] sm:col-start-auto sm:text-right', done ? STAGE_TONE[s.status] : 'text-muted')}>{done ? s.verdict : active ? 'Checking…' : 'Waiting'}</span>
              {done && n === lastDone && <p className="rise t-caption col-start-2 mt-1 text-muted sm:col-span-3">{s.detail}</p>}
            </li>
          )
        })}
      </ol>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="t-caption text-muted">Computed by the {backend.source === 'api' ? 'FastAPI server (ST-GNN + LSTM autoencoder)' : 'in-browser engine'} on simulated data.</span>
        {(inv.phase === 'done' || inv.phase === 'undetected') && <Button variant="ghost" size="sm" onClick={onClear} icon={<RotateCcw size={13} />}>Reset demo</Button>}
      </div>
    </div>
  )
}

const placeholderStages: Stage[] = ['Raw sensor', 'Sensor health and physics', 'Temporal consistency', 'Spatial correlation', 'Historical baseline', 'External validation', 'Anomaly score', 'Classification']
  .map((name, n) => ({ id: String(n), name, method: '', status: 'info', verdict: '', detail: '' }))

/** Measured value against its threshold, on a scale that runs to 3× the threshold. */
function Measure({ m, status }: { m: NonNullable<Stage['measure']>; status: Stage['status'] }) {
  const ratio = m.threshold ? m.value / m.threshold : 0
  const w = Math.min(1, ratio / 3)
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[3px] w-full max-w-[160px] bg-line">
        <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${w * 100}%`, background: status === 'flag' ? 'var(--fault)' : status === 'weather' ? 'var(--storm)' : 'var(--ink-2)' }} />
        <span className="absolute -bottom-1 -top-1 w-px bg-ink" style={{ left: `${100 / 3}%` }} title="Threshold" />
      </div>
      <span className="tnum t-caption whitespace-nowrap text-ink-2">{m.fmt(m.value)}{m.unit && ` ${m.unit}`} <span className="text-muted">vs {m.fmt(m.threshold)}</span></span>
    </div>
  )
}

/* ============================== Why was this reading rejected? ============================== */
function Why({ inv }: { inv: Inv }) {
  const { engine: E } = useConsole()
  const d = E.OUT[inv.at][inv.i], o = E.RAW[inv.at][inv.i]
  const ch = CHANNEL[inv.type]
  const z = Math.abs(d.z[(ch.key === 'RH' ? 'RH' : ch.key === 'W' ? 'W' : 'T') as 'T'] ?? 0)
  const gT = d.gates.find((g) => g.id === 'T' && g.status === 'flag'), gS = d.gates.find((g) => g.id === 'S' && g.status === 'flag')
  // Each factor is its measured value divided by the pipeline's own threshold (1x = exactly at the threshold).
  // When a rule fired on a different measurement (flatline, CUSUM drift), the factor quotes that rule instead.
  const factors: { id: string; name: string; text: string; ratio: number | null; hit: boolean }[] = [
    gT && Math.abs(d.dT) <= T_STEP
      ? { id: 'T', name: 'Temporal inconsistency', text: gT.text, ratio: null, hit: true }
      : { id: 'T', name: 'Temporal inconsistency', text: `${Math.abs(d.dT).toFixed(1)} °C change in 15 min; spike rule at ${T_STEP} °C`, ratio: Math.abs(d.dT) / T_STEP, hit: !!gT },
    gS && Math.abs(z) <= Z_SPATIAL
      ? { id: 'S', name: 'Spatial disagreement', text: gS.text, ratio: null, hit: true }
      : { id: 'S', name: 'Spatial disagreement', text: `${z.toFixed(1)}σ from the ST-GNN neighbour estimate; rule at ${Z_SPATIAL}σ`, ratio: z / Z_SPATIAL, hit: !!gS },
    { id: 'B', name: 'Historical deviation', text: `LSTM autoencoder error ${d.score.toFixed(1)}; review line ${SCORE_REVIEW}`, ratio: d.score / SCORE_REVIEW, hit: d.score > SCORE_REVIEW },
  ].sort((a, b) => Number(b.hit) - Number(a.hit) || (b.ratio ?? 0) - (a.ratio ?? 0))
  const flagGate = d.gates.find((g) => g.status === 'flag') ?? d.gates.find((g) => g.status === 'warn')
  const ext = d.ctx.convective
  const noneCross = factors.every((f) => (f.ratio ?? 0) < 1)
  const battFail = !!o && o.V < V_ADC
  return (
    <section aria-labelledby="why-h" className="mt-16 grid gap-x-16 gap-y-8 border-t border-line pt-12 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <h2 id="why-h" className="t-h1 text-ink">{isFault(d.cls) ? 'Why was this reading rejected?' : 'Why was this station flagged?'}</h2>
        <p className="t-small mt-3 text-muted">Each factor is its measured value divided by the threshold the pipeline uses. Past 1× the factor points to a fault on its own.</p>
      </div>
      <div className="lg:col-span-8">
        <ul className="border-t border-line">
          {factors.map((f) => (
            <li key={f.id} className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[200px_1fr_70px] sm:items-center">
              <span className="text-[14.5px] text-ink">{f.name}{f.hit && <span className="t-caption ml-2 text-fault">rule fired</span>}</span>
              <div>
                {f.ratio != null && (
                  <div className="relative mb-2 h-[3px] bg-line">
                    <span className="absolute inset-y-0 left-0 transition-[width] duration-700" style={{ width: `${Math.min(1, f.ratio / 3) * 100}%`, background: f.ratio >= 1 ? 'var(--fault)' : 'var(--ink-2)' }} />
                    <span className="absolute -bottom-1.5 -top-1.5 w-px bg-ink" style={{ left: `${100 / 3}%` }} />
                  </div>
                )}
                <p className="t-caption text-muted">{f.text}</p>
              </div>
              <span className={cx('tnum text-right text-[15px]', f.hit || (f.ratio ?? 0) >= 1 ? 'text-fault' : 'text-ink-2')}>{f.ratio == null ? 'Triggered' : `${f.ratio.toFixed(1)}×`}</span>
            </li>
          ))}
          <li className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[200px_1fr_70px] sm:items-center">
            <span className="text-[14.5px] text-ink">Sensor reliability</span>
            <p className="t-caption text-muted">{o ? `Battery ${o.V.toFixed(2)} V against the ${V_ADC} V ADC reference.` : 'No transmission.'}{d.warn?.kind === 'battery' ? ` Draining ${(-d.warn.slope * 4).toFixed(2)} V/h faster than the network; reaches ${V_ADC} V in about ${d.warn.hrs.toFixed(1)} h.` : ''}</p>
            <span className={cx('text-right text-[13px]', battFail || !o ? 'text-fault' : d.warn?.kind === 'battery' ? 'text-warn' : 'text-ink-2')}>{battFail || !o ? 'Failed' : d.warn?.kind === 'battery' ? 'Failing' : 'Healthy'}</span>
          </li>
          <li className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[200px_1fr_70px] sm:items-center">
            <span className="text-[14.5px] text-ink">External source</span>
            <p className="t-caption text-muted">Radar {d.ctx.maxDbz.toFixed(0)} dBZ, INSAT cloud-top {d.ctx.ctt.toFixed(0)} °C. {ext ? 'Convection is present, so extreme readings could be real weather.' : `No convection (needs over ${DBZ_CONVECTIVE} dBZ), so the weather cannot explain the reading.`}</p>
            <span className={cx('text-right text-[13px]', ext ? 'text-storm' : 'text-fault')}>{ext ? 'Could explain' : 'Contradicts'}</span>
          </li>
        </ul>
        {flagGate && <p className="t-small mt-5 text-ink-2"><span className="text-ink">Rule that fired:</span> {flagGate.name}. {flagGate.text}</p>}
        {noneCross && flagGate && <p className="t-small mt-2 text-ink-2">No single reading crosses a range or step threshold here. The fault only shows up as a pattern over time, which is why rule-based range and step checks miss it or catch it late.</p>}
      </div>
    </section>
  )
}

/* ============================== Decision ============================== */
function Decision({ inv }: { inv: Inv }) {
  const { engine: E } = useConsole()
  const d = E.OUT[inv.at][inv.i], ch = CHANNEL[inv.type]
  const clean = (d.clean as Record<string, number | undefined>)[ch.key]
  const stages = stagesFor(E, inv.at, inv.i, inv.type)
  const agree = stages.find((s) => s.id === 'score')?.detail
  const fault = isFault(d.cls), predicted = !fault && !!d.warn
  return (
    <section aria-labelledby="dec-h" className="mt-12 border-t-2 border-ink pt-10">
      <div className="grid gap-x-16 gap-y-6 lg:grid-cols-12">
        <p className="eyebrow lg:col-span-4">Decision · {STATIONS[inv.i].name} · {stamp(inv.at)} IST</p>
        <div className="lg:col-span-8">
          <h2 id="dec-h" className={cx('t-display', fault ? 'text-fault' : predicted ? 'text-warn' : 'text-ink')}>{fault ? 'Sensor fault.' : predicted ? 'Failure predicted.' : d.cls === 'SEVERE' ? 'Real weather.' : 'Valid.'}</h2>
          <p className="t-h2 mt-3 text-ink">{fault ? `${CLS_META[d.cls].label}. Reading rejected from downstream systems.` : predicted && d.warn ? `Readings are still valid. The ${d.warn.kind === 'bearing' ? 'anemometer' : 'battery'} will fail in about ${d.warn.hrs.toFixed(0)} h.` : 'Reading kept.'}</p>
          <dl className="t-small mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-[180px_1fr]">
            <dt className="text-muted">Evidence</dt><dd className="text-ink">{agree} Anomaly score {d.score.toFixed(1)} against a review line of {SCORE_REVIEW}.</dd>
            {fault && <><dt className="text-muted">Replaced with</dt><dd className="text-ink">{clean != null ? `${clean.toFixed(ch.dp)} ${ch.unit} from the ST-GNN virtual sensor` : 'All channels quarantined and filled from neighbours'} (WMO flag 4, corrected).</dd></>}
            <dt className="text-muted">Next</dt><dd className="text-ink">Work order raised for the field team. <a href="#maintenance" className="link">Open Maintenance</a></dd>
            <dt className="text-muted">Data</dt><dd className="text-muted">Simulated network with an injected fault. The pipeline's output is real; the sensor is not.</dd>
          </dl>
        </div>
      </div>
    </section>
  )
}

/* ============================== Impact ============================== */
function Impact({ inv }: { inv: Inv }) {
  const { engine: E, k, backend: b } = useConsole()
  const m = metrics(E, k)
  const det = inv.phase === 'done' && inv.fi >= 0 ? findDetection(E, inv.fi) : null
  const im = det ? impactFor(E, det, inv.type) : null
  const bm = b.status === 'online' ? b.model?.benchmarks : null
  return (
    <section aria-labelledby="impact-h" className="mt-20 border-t border-line pt-12">
      <div className="grid gap-x-16 gap-y-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2 id="impact-h" className="t-h1 text-ink">Impact</h2>
          <p className="t-small mt-3 text-muted">What reaches forecasters and weather models, with and without WeatherGuard. Measured on this replay, where every fault's timing is known.</p>
        </div>
        <div className="lg:col-span-8">
          {im ? (
            <div className="grid border-t border-line sm:grid-cols-2">
              {([['Without WeatherGuard', 'Legacy rule-based QC', false], ['With WeatherGuard', 'Five checks + models', true]] as const).map(([title, sub, us]) => (
                <div key={title} className={cx('py-6', us ? 'border-t border-line sm:border-l sm:border-t-0 sm:pl-8' : 'sm:pr-8')}>
                  <p className={cx('t-h3', us ? 'text-ink' : 'text-muted')}>{title}</p>
                  <p className="t-caption text-muted">{sub}</p>
                  <p className={cx('t-figure mt-5 text-[48px]', us ? 'text-ink' : 'text-fault')}>{us ? im.wgPassed : im.legacyPassed}<span className="ml-2 text-[16px] text-muted">of {im.bad}</span></p>
                  <p className="t-small mt-1 text-ink-2">bad readings reach forecasters in the next {im.hours} h</p>
                  <p className="t-small mt-4 text-ink-2">
                    {us ? (im.predictive ? 'Warned before any data went bad.' : `Detected ${im.wgLatency === 0 ? 'on the first bad reading' : `after ${minutes(im.wgLatency)}`}.`)
                      : im.lgLatency != null ? `Detected after ${minutes(im.lgLatency)}.` : 'Never detected.'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-lead border-t border-line py-6 text-ink-2">Simulate a fault above to see what it would have done downstream.</p>
          )}

          <div className="mt-10">
            <p className="t-h3 text-ink">Across this replay so far</p>
            <table className="mt-3 w-full text-[14px]">
              <thead><tr className="border-b border-line text-left text-[12.5px] text-muted"><th className="pb-2 font-normal"> </th><th className="pb-2 text-right font-normal">Legacy QC</th><th className="pb-2 text-right font-normal">WeatherGuard</th></tr></thead>
              <tbody className="tnum">
                {[
                  ['Faulty readings caught', pct(m.lg.rec), pct(m.wg.rec)],
                  ['Good readings wrongly rejected', String(m.lg.fp), String(m.wg.fp)],
                  ['Genuine storm readings kept', m.storm ? pct(1 - m.stormLeg / m.storm) : '—', m.storm ? pct(1 - m.stormWg / m.storm) : '—'],
                ].map(([a, l, w]) => (
                  <tr key={a} className="border-b border-line"><td className="py-3 text-ink-2">{a}</td><td className="py-3 text-right text-muted">{l}</td><td className="py-3 text-right font-medium text-ink">{w}</td></tr>
                ))}
              </tbody>
            </table>
            {bm && (
              <p className="t-caption mt-4 text-muted">
                Offline benchmark ({bm.observations.toLocaleString('en-IN')} observations, same 0.1% false-alarm budget): WeatherGuard recall {pct(bm.rows.find((r) => r.method.startsWith('WeatherGuard'))?.recall)} vs
                {' '}{bm.rows.filter((r) => !r.method.startsWith('WeatherGuard')).map((r) => `${r.method} ${pct(r.recall)}`).join(', ')}. <a href="#evaluation" className="link">Full evaluation <ArrowRight size={11} className="inline" /></a>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
