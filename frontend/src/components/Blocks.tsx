import { AlertTriangle, Check, CloudLightning, Minus, Timer, Zap } from 'lucide-react'
import { FAULT_LABEL, STATIONS, events, isFault, latencies } from '../engine/engine'
import type { EngineResult, Latency } from '../engine/engine'
import type { GateStatus } from '../engine/types'
import { CLS_META, TONE, WORK_ORDER, hours, stamp, statusOf } from '../lib/present'
import { useConsole } from '../state/console'
import { Chip, cx, Empty } from './ui'

export function StationList({ compact = false }: { compact?: boolean }) {
  const { engine, k, sel, select } = useConsole()
  return (
    <ul className="divide-y divide-line">
      {STATIONS.map((s, i) => {
        const d = engine.OUT[k][i], o = engine.RAW[k][i], st = statusOf(d), lf = engine.LEG[k][i].flag && !isFault(d.cls)
        return (
          <li key={s.id}>
            <button type="button" onClick={() => select(i, !compact)} aria-current={i === sel}
              className={cx('grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors sm:grid-cols-[1fr_64px_52px_auto]',
                i === sel ? 'bg-accent-soft' : 'hover:bg-sunken')}>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium text-ink">{s.name}</span>
                <span className="block text-[11.5px] text-muted">{s.elev} m{d.edge?.burst && <span className="text-storm"> · <Timer size={11} className="inline -mt-0.5" /> 1-min burst</span>}{lf && <span className="text-fault"> · legacy false alarm</span>}</span>
              </span>
              <span className="tnum hidden text-right font-mono text-[13px] text-ink-2 sm:block">{o ? `${o.T.toFixed(1)}°` : '—'}</span>
              <span className="tnum hidden text-right font-mono text-[13px] text-muted sm:block">{o ? `${o.RH.toFixed(0)}%` : '—'}</span>
              <span className="justify-self-end"><Chip tone={st.tone}>{st.label}</Chip></span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const EVENT_ICON = { storm: CloudLightning, fault: AlertTriangle, power: Zap, warn: Zap, ok: Check, off: Minus }

export function EventFeed({ limit = 12 }: { limit?: number }) {
  const { engine, k, select } = useConsole()
  const ev = events(engine, k).slice(0, limit)
  if (!ev.length) return <Empty>No anomalies yet. Press play to stream observations.</Empty>
  return (
    <ol className="flex flex-col gap-1">
      {ev.map((e, n) => {
        const s = STATIONS[e.i], o = engine.RAW[e.k][e.i]
        const tone = e.cls === 'WARN' ? 'warn' : CLS_META[e.cls].tone
        const Icon = EVENT_ICON[tone]
        const text = (() => {
          switch (e.cls) {
            case 'SEVERE': return `Squall confirmed at ${s.name}. CAP alert issued to IMD and NDMA${engine.LEG[e.k][e.i].flag ? '; legacy QC would have rejected it' : ''}.`
            case 'BLOCKAGE': return `${s.name} gauge dry under a ${e.d.ctx.dbz.toFixed(0)} dBZ echo. Radar value substituted.`
            case 'FLATLINE': return `${s.name} temperature frozen at ${o?.T.toFixed(1)} °C. Virtual sensor on.`
            case 'DRIFT': return `${s.name} humidity drifting ${o ? (o.RH - e.d.exp.RH).toFixed(1) : ''}% high.`
            case 'SPIKE': return `${s.name} spike of ${e.d.dT.toFixed(1)} °C removed.`
            case 'ELECTRICAL': return `${s.name} battery at ${o?.V.toFixed(2)} V. Channels quarantined.`
            case 'MISSING': return `${s.name} went offline. Gap filled.`
            case 'SOILING': return `${s.name} pyranometer ${((e.d.att ?? 0) * 100).toFixed(0)}% attenuated.`
            case 'BEARING': return `${s.name} anemometer bearing worn. Wind filled by virtual sensor.`
            case 'WARN': return e.d.warn?.kind === 'bearing' ? `${s.name} anemometer degrading. Out of tolerance in ~${e.d.warn.hrs.toFixed(0)} h.` : `${s.name} battery trending down. Failure in ~${e.d.warn?.hrs.toFixed(1)} h.`
            default: return `${s.name}: ${CLS_META[e.cls].label}.`
          }
        })()
        return (
          <li key={`${e.k}-${e.i}-${n}`}>
            <button type="button" onClick={() => select(e.i, true)} className="flex w-full items-start gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-sunken">
              <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', TONE[tone].bg, TONE[tone].fg)}><Icon size={14} /></span>
              <span className="min-w-0">
                <span className="block text-[13px] text-ink">{text}</span>
                <span className="tnum block font-mono text-[11px] text-muted">{stamp(e.k)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

const GATE_STYLE: Record<GateStatus, { tone: keyof typeof TONE; label: string }> = {
  pass: { tone: 'ok', label: 'Passed' }, flag: { tone: 'fault', label: 'Flagged' }, warn: { tone: 'warn', label: 'Warning' },
  severe: { tone: 'storm', label: 'Weather' }, skip: { tone: 'off', label: 'Skipped' },
}
const GATE_SUB: Record<string, string> = { E: 'Battery & ADC', P: 'Clausius–Clapeyron · Magnus–Tetens', T: 'Step & flatline', R: 'DWR radar · INSAT', S: 'Buddy check · CUSUM' }

export function GateStepper() {
  const { engine, k, sel } = useConsole()
  const gates = engine.OUT[k][sel].gates
  return (
    <ol className="relative flex flex-col">
      {gates.map((gt, n) => {
        const s = GATE_STYLE[gt.status]
        return (
          <li key={n} className="relative grid grid-cols-[28px_1fr] gap-3 pb-4 last:pb-0">
            {n < gates.length - 1 && <span className="absolute left-[13.5px] top-7 bottom-0 w-px bg-line" />}
            <span className={cx('relative z-10 mt-0.5 grid h-7 w-7 place-items-center rounded-full text-[12px] font-semibold', TONE[s.tone].bg, TONE[s.tone].fg)}>
              {gt.status === 'pass' ? <Check size={14} strokeWidth={2.4} /> : gt.status === 'skip' ? <Minus size={14} /> : gt.status === 'severe' ? <CloudLightning size={14} /> : <AlertTriangle size={13} />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-ink">{gt.name}</span>
                <span className="text-[11.5px] text-muted">{gt.name === 'Mechanical decay' ? 'Wind vs neighbour trend' : gt.name === 'Solar consistency' ? 'Clear-sky index' : GATE_SUB[gt.id]}</span>
                <span className={cx('ml-auto text-[11.5px] font-medium', TONE[s.tone].fg)}>{s.label}</span>
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{gt.text}</p>
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
      <table className="w-full min-w-[480px] text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] text-muted">
            <th className="pb-2 font-normal">Sensor</th><th className="pb-2 text-right font-normal">Reported</th>
            <th className="pb-2 text-right font-normal">Expected</th><th className="pb-2 text-right font-normal">z</th><th className="pb-2 text-right font-normal">Clean</th>
          </tr>
        </thead>
        <tbody className="tnum font-mono">
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-line">
              <td className="py-2 font-sans text-ink-2">{r[0]}</td>
              <td className="py-2 text-right text-ink">{r[1]}</td>
              <td className="py-2 text-right text-muted">{r[2]}</td>
              <td className="py-2 text-right">{r[3]}</td>
              <td className="py-2 text-right text-ink">{r[4]}</td>
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

export function WorkOrderCard({ l }: { l: Latency }) {
  const { select } = useConsole()
  const w = WORK_ORDER[l.fault.type], s = STATIONS[l.i]
  const kd = l.fault.type === 'power' && l.predictive >= 0 ? l.predictive : l.wg
  const predictive = l.fault.type === 'power' && l.predictive >= 0 && (l.onset < 0 || l.predictive < l.onset)
  const lead = predictive && l.onset >= 0 ? `${hours(l.onset - l.predictive)} before failure` : predictive ? 'before failure' : `${hours(Math.max(0, l.wg - l.onset))} after onset`
  const tone = w.priority === 'P1' ? 'fault' : w.priority === 'P2' ? 'warn' : 'off'
  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="tnum font-mono text-[11.5px] text-muted">WO-{String(2601 + l.fi).padStart(5, '0')}</span>
        <Chip tone={tone} dot={false}>{w.priority}{predictive ? ' · predictive' : ''}</Chip>
      </div>
      <div>
        <h3 className="text-[16px] font-semibold tracking-tight">{w.title}</h3>
        <button type="button" onClick={() => select(l.i, true)} className="text-[13px] text-accent hover:underline">{s.name}</button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted">Root cause</dt><dd className="text-ink">{FAULT_LABEL[l.fault.type]}</dd>
        <dt className="text-muted">Detected</dt><dd className="text-ink">{stamp(kd)} <span className="text-muted">· {lead}</span></dd>
        <dt className="text-muted">Legacy QC</dt><dd className={l.lg >= 0 ? 'text-ink' : 'text-fault'}>{l.lg >= 0 ? `caught ${hours(l.lg - l.onset)} after onset` : 'not detected'}</dd>
        <dt className="text-muted">Carry</dt><dd className="text-ink-2">{w.parts}</dd>
      </dl>
      {l.fault.user && <span className="text-[11.5px] text-accent">Injected from the Fault lab</span>}
    </article>
  )
}
