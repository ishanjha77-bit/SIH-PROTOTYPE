import { FAULT_LABEL, STATIONS, events, isFault, latencies } from '../engine/engine'
import type { EngineResult, Latency } from '../engine/engine'
import type { GateStatus } from '../engine/types'
import { CLS_META, TONE, WORK_ORDER, clock, dayOf, hours, stamp, statusOf } from '../lib/present'
import { useConsole } from '../state/console'
import { Chip, cx, EmptyState } from './ui'

/** The stations as a table: name, the two readings people scan for, and the verdict. */
export function StationList({ compact = false }: { compact?: boolean }) {
  const { engine, k, sel, select } = useConsole()
  return (
    <table className="w-full text-[14px]">
      <caption className="sr-only">Stations, latest reading and verdict</caption>
      <thead>
        <tr className="border-b border-line text-left text-[12.5px] text-muted">
          <th scope="col" className="pb-3 font-normal">Station</th>
          <th scope="col" className="hidden pb-3 text-right font-normal sm:table-cell">Temp</th>
          <th scope="col" className="hidden pb-3 text-right font-normal sm:table-cell">RH</th>
          <th scope="col" className="pb-3 pl-6 text-right font-normal">Verdict</th>
        </tr>
      </thead>
      <tbody>
        {STATIONS.map((s, i) => {
          const d = engine.OUT[k][i], o = engine.RAW[k][i], st = statusOf(d), lf = engine.LEG[k][i].flag && !isFault(d.cls)
          return (
            <tr key={s.id} onClick={() => select(i, !compact)} aria-current={i === sel ? 'true' : undefined}
              className={cx('cursor-pointer border-b border-line transition-colors duration-150 hover:bg-sunken/70', i === sel && 'bg-sunken')}>
              <td className="py-3 pr-4">
                <button type="button" onClick={(e) => { e.stopPropagation(); select(i, !compact) }} className="text-left text-ink">{s.name}</button>
                <span className="t-caption block text-muted">
                  {s.elev} m{d.edge?.burst && ' · 1-min sampling'}{lf && <span className="text-fault"> · legacy false alarm</span>}
                </span>
              </td>
              <td className="tnum hidden py-3 text-right text-ink-2 sm:table-cell">{o ? `${o.T.toFixed(1)}°` : '—'}</td>
              <td className="tnum hidden py-3 text-right text-muted sm:table-cell">{o ? `${o.RH.toFixed(0)}%` : '—'}</td>
              <td className="py-3 pl-6 text-right"><Chip tone={st.tone}>{st.label}</Chip></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** A plain log: time, then what changed. */
export function EventFeed({ limit = 12 }: { limit?: number; columns?: boolean }) {
  const { engine, k, select } = useConsole()
  const ev = events(engine, k).slice(0, limit)
  if (!ev.length) return <EmptyState title="Nothing unusual yet">Every observation so far has passed all five checks. Play the replay to stream more data.</EmptyState>
  return (
    <ol className="border-t border-line">
      {ev.map((e, n) => {
        const s = STATIONS[e.i], o = engine.RAW[e.k][e.i]
        const tone = e.cls === 'WARN' ? 'warn' : CLS_META[e.cls].tone
        const text = (() => {
          switch (e.cls) {
            case 'SEVERE': return `Squall confirmed at ${s.name}. CAP alert issued${engine.LEG[e.k][e.i].flag ? '; legacy QC would have rejected it' : ''}.`
            case 'BLOCKAGE': return `${s.name} gauge dry under a ${e.d.ctx.dbz.toFixed(0)} dBZ echo. Radar value substituted.`
            case 'FLATLINE': return `${s.name} temperature frozen at ${o?.T.toFixed(1)} °C. Virtual sensor on.`
            case 'DRIFT': return `${s.name} humidity drifting ${o ? (o.RH - e.d.exp.RH).toFixed(1) : ''}% high.`
            case 'SPIKE': return `${s.name} spike of ${e.d.dT.toFixed(1)} °C removed.`
            case 'ELECTRICAL': return `${s.name} battery at ${o?.V.toFixed(2)} V. Channels quarantined.`
            case 'MISSING': return `${s.name} went offline. Gap filled.`
            case 'SOILING': return `${s.name} solar sensor ${((e.d.att ?? 0) * 100).toFixed(0)}% attenuated.`
            case 'BEARING': return `${s.name} anemometer bearing worn. Wind filled by virtual sensor.`
            case 'WARN': return e.d.warn?.kind === 'bearing' ? `${s.name} anemometer degrading. Out of tolerance in about ${e.d.warn.hrs.toFixed(0)} h.` : `${s.name} battery trending down. Failure in about ${e.d.warn?.hrs.toFixed(1)} h.`
            default: return `${s.name}: ${CLS_META[e.cls].label}.`
          }
        })()
        return (
          <li key={`${e.k}-${e.i}-${n}`}>
            <button type="button" onClick={() => select(e.i, true)}
              className="grid w-full grid-cols-[76px_8px_1fr] items-baseline gap-3 border-b border-line py-3 text-left transition-colors duration-150 hover:bg-sunken/70">
              <span className="tnum text-[12.5px] text-muted">D{dayOf(e.k)} {clock(e.k)}</span>
              <span className="h-1.5 w-1.5 translate-y-[-2px] rounded-full" style={{ background: TONE[tone].hex }} />
              <span className="text-[13.5px] text-ink-2">{text}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

const GATE_STYLE: Record<GateStatus, { tone: keyof typeof TONE; label: string }> = {
  pass: { tone: 'ok', label: 'Passed' }, flag: { tone: 'fault', label: 'Flagged' }, warn: { tone: 'warn', label: 'Warning' },
  severe: { tone: 'storm', label: 'Real weather' }, skip: { tone: 'off', label: 'Skipped' },
}
const GATE_SUB: Record<string, string> = { E: 'Battery and ADC', P: 'Clausius–Clapeyron, Magnus–Tetens', T: 'Step and flatline', R: 'Doppler radar, INSAT', S: 'Neighbour check, CUSUM' }

/** The five checks as a numbered sequence. Only non-passing results take colour. */
export function GateStepper({ i }: { i?: number } = {}) {
  const { engine, k, sel } = useConsole()
  const gates = engine.OUT[k][i ?? sel].gates
  return (
    <ol className="flex flex-col">
      {gates.map((gt, n) => {
        const s = GATE_STYLE[gt.status], quiet = gt.status === 'pass' || gt.status === 'skip'
        return (
          <li key={n} className="grid grid-cols-[22px_1fr] gap-x-3 border-t border-line py-4 first:border-t-0 first:pt-0">
            <span className="tnum pt-px text-[13px] text-muted">{n + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[14px] font-medium text-ink">{gt.name}</span>
                <span className="t-caption text-muted">{gt.name === 'Mechanical decay' ? 'Wind against neighbour trend' : gt.name === 'Solar consistency' ? 'Clear-sky index' : GATE_SUB[gt.id]}</span>
                <span className={cx('ml-auto flex items-center gap-1.5 text-[12.5px]', quiet ? 'text-muted' : TONE[s.tone].fg)}>
                  {!quiet && <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE[s.tone].hex }} />}{s.label}
                </span>
              </div>
              <p className="t-small mt-1 text-ink-2">{gt.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ReadingsTable() {
  const { engine: E, k, sel: i } = useConsole()
  const d = E.OUT[k][i], o = E.RAW[k][i], tr = E.TRUE[k][i]
  const f = (v: number | undefined | null, dp: number) => (v == null || isNaN(v) ? '—' : v.toFixed(dp))
  const z = (v?: number) => v == null ? <span className="text-muted">—</span> :
    <span className={Math.abs(v) > 3 ? 'text-fault' : Math.abs(v) > 2 ? 'text-warn' : 'text-muted'}>{v >= 0 ? '+' : ''}{v.toFixed(1)}</span>
  const cl = (a: number | undefined, b: number | undefined, dp: number) =>
    a != null && b != null && Math.abs(a - b) > 0.05 ? <span className="font-medium text-accent">{f(b, dp)}</span> : f(b ?? a, dp)
  const rows: [string, string, string, React.ReactNode, React.ReactNode][] = [
    ['Air temperature', `${f(o?.T, 1)} °C`, `${f(d.exp.T, 1)} °C`, z(d.z.T), cl(o?.T, d.clean.T, 1)],
    ['Humidity', `${f(o?.RH, 1)} %`, `${f(d.exp.RH, 1)} %`, z(d.z.RH), cl(o?.RH, d.clean.RH, 1)],
    ['Pressure', `${f(o?.P, 1)} hPa`, `${f(d.exp.P, 1)} hPa`, z(d.z.P), f(o?.P, 1)],
    ['Rain', `${f(o?.R, 1)} mm`, `${f(d.ctx.radarR, 1)} mm radar`, <span className="text-muted">—</span>, cl(o?.R, d.clean.R, 1)],
    ['Wind', `${f(o?.W, 1)} m/s`, `${f(d.exp.W, 1)} m/s`, z(d.z.W), cl(o?.W, d.clean.W, 1)],
    ['Solar', `${f(o?.S, 0)} W/m²`, `${f(tr.cs, 0)} clear-sky`, <span className="text-muted">—</span>, cl(o?.S, d.clean.S, 0)],
    ['Battery', `${f(o?.V, 2)} V`, '11.6 – 13.5 V', <span className="text-muted">—</span>, f(o?.V, 2)],
    ['Cabinet temp', `${f(o?.C, 1)} °C`, '< 55 °C', <span className="text-muted">—</span>, f(o?.C, 1)],
  ]
  return (
    <div className="scroll-soft overflow-x-auto">
      <table className="w-full min-w-[340px] text-[13px] sm:text-[14px]">
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-muted">
            <th className="pb-3 font-normal">Sensor</th><th className="pb-3 text-right font-normal">Reported</th>
            <th className="pb-3 text-right font-normal">Expected</th><th className="pb-3 text-right font-normal">z</th><th className="pb-3 text-right font-normal">Sent on</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-line">
              <td className="py-3 text-ink-2">{r[0]}</td>
              <td className="py-3 text-right text-ink">{r[1]}</td>
              <td className="py-3 text-right text-muted">{r[2]}</td>
              <td className="py-3 text-right">{r[3]}</td>
              <td className="py-3 text-right text-ink">{r[4]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function openOrders(E: EngineResult, K: number): Latency[] {
  return latencies(E, K).filter((l) => l.wg >= 0 || l.predictive >= 0)
    .sort((a, b) => WORK_ORDER[a.fault.type].priority.localeCompare(WORK_ORDER[b.fault.type].priority))
}

/** A work order reads like a dispatch slip: what to do, where, why, what to carry. */
export function WorkOrderCard({ l }: { l: Latency }) {
  const { select, handled } = useConsole()
  const w = WORK_ORDER[l.fault.type], s = STATIONS[l.i]
  const doneAt = handled[`fault-${l.i}`] ?? handled[`warn-${l.i}`]
  const kd = l.fault.type === 'power' && l.predictive >= 0 ? l.predictive : l.wg
  const predictive = l.fault.type === 'power' && l.predictive >= 0 && (l.onset < 0 || l.predictive < l.onset)
  const lead = predictive && l.onset >= 0 ? `${hours(l.onset - l.predictive)} before failure` : predictive ? 'before failure' : `${hours(Math.max(0, l.wg - l.onset))} after onset`
  const tone = w.priority === 'P1' ? 'fault' : w.priority === 'P2' ? 'warn' : 'off'
  return (
    <article className="rise flex flex-col rounded-lg border border-line bg-surface p-5 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-baseline justify-between gap-3">
        <span className="tnum text-[12.5px] text-muted">WO-{String(2601 + l.fi).padStart(5, '0')}</span>
        <Chip tone={tone}>{w.priority}{predictive ? ' · predictive' : ''}</Chip>
      </div>
      <h3 className="t-h2 mt-4 text-ink">{w.title}</h3>
      <button type="button" onClick={() => select(l.i, true)} className="link mt-1 self-start text-[14px]">{s.name}</button>
      <dl className="t-small mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t border-line pt-4">
        <dt className="text-muted">Root cause</dt><dd className="text-ink">{FAULT_LABEL[l.fault.type]}</dd>
        <dt className="text-muted">Detected</dt><dd className="tnum text-ink">{stamp(kd)} <span className="text-muted">· {lead}</span></dd>
        <dt className="text-muted">Legacy QC</dt><dd className={l.lg >= 0 ? 'text-ink' : 'text-fault'}>{l.lg >= 0 ? `caught ${hours(l.lg - l.onset)} after onset` : 'not detected'}</dd>
        <dt className="text-muted">Carry</dt><dd className="text-ink-2">{w.parts}</dd>
      </dl>
      {(doneAt != null || l.fault.user) && (
        <p className="t-caption mt-4 border-t border-line pt-3 text-muted">
          {doneAt != null && <span className="text-ok">Dispatched {stamp(doneAt)}. </span>}
          {l.fault.user && 'Injected from the Fault lab.'}
        </p>
      )}
    </article>
  )
}
