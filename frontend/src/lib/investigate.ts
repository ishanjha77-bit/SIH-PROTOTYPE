/*
 * Turns real pipeline output into the command-centre walkthrough: validation stages, the factors behind
 * the decision, and the impact with and without WeatherGuard. Nothing here invents a number: every value
 * is read from the engine result (browser or FastAPI), and every threshold is the one the pipeline uses.
 */
import { FAULT_LABEL, STATIONS, STEPS, isFault, latencies, type EngineResult, type Latency } from '../engine/engine'
import type { Diagnosis, FaultType, Gate, GateId, Obs } from '../engine/types'
import { CLS_META, WMO_MEANING, stamp, wmoFlags } from './present'

// Thresholds used by the pipeline (engine.ts). Shown next to every measurement.
export const T_STEP = 4 // °C in 15 min, isolated-spike rule
export const Z_SPATIAL = 5 // σ from the ST-GNN neighbour estimate, spike rule
export const SCORE_REVIEW = 6.5 // LSTM-autoencoder review line
export const DBZ_CONVECTIVE = 32 // radar reflectivity above which weather can explain an extreme
export const V_ADC = 11.6 // V, ADC reference

/** The faults a judge can inject, and the channel each one corrupts. */
export const SIM_FAULTS: { type: FaultType; label: string; hint: string }[] = [
  { type: 'spike', label: 'Spike', hint: 'Temperature jumps about 9 °C in one reading' },
  { type: 'flatline', label: 'Stuck sensor', hint: 'Temperature freezes at one value' },
  { type: 'power', label: 'Failing battery', hint: 'Battery drains, then biases every channel' },
  { type: 'drift', label: 'Humidity drift', hint: 'Humidity creeps up 0.12% every 15 minutes' },
]
type Key = 'T' | 'RH' | 'V' | 'R' | 'W' | 'S'
export const CHANNEL: Record<FaultType, { key: Key; label: string; unit: string; dp: number }> = {
  spike: { key: 'T', label: 'Air temperature', unit: '°C', dp: 1 },
  flatline: { key: 'T', label: 'Air temperature', unit: '°C', dp: 1 },
  power: { key: 'V', label: 'Battery', unit: 'V', dp: 2 },
  drift: { key: 'RH', label: 'Relative humidity', unit: '%', dp: 1 },
  blockage: { key: 'R', label: 'Rain', unit: 'mm', dp: 1 },
  bearing: { key: 'W', label: 'Wind', unit: 'm/s', dp: 1 },
  soiling: { key: 'S', label: 'Solar', unit: 'W/m²', dp: 0 },
}

/** When (if ever) each system noticed the injected fault. */
export function findDetection(E: EngineResult, fi: number): (Latency & { at: number }) | null {
  const l = latencies(E, STEPS - 1)[fi]
  if (!l) return null
  const cands = [l.wg, l.fault.type === 'power' ? l.predictive : -1].filter((x) => x >= 0)
  return cands.length ? { ...l, at: Math.min(...cands) } : null
}

export type StageStatus = 'flag' | 'pass' | 'weather' | 'info' | 'warn'
export interface Stage {
  id: string
  name: string
  method: string
  status: StageStatus
  verdict: string
  detail: string
  /** measured value against the pipeline's threshold, when the stage has one */
  measure?: { value: number; threshold: number; unit: string; fmt: (v: number) => string }
}

const gate = (d: Diagnosis, id: GateId): Gate | undefined => d.gates.find((g) => g.id === id)
const statusOf = (g?: Gate): StageStatus => (!g ? 'info' : g.status === 'flag' ? 'flag' : g.status === 'severe' ? 'weather' : g.status === 'warn' ? 'warn' : g.status === 'pass' ? 'pass' : 'info')

/** The validation walkthrough for station i at step q: every stage from the pipeline's own output. */
export function stagesFor(E: EngineResult, q: number, i: number, type: FaultType): Stage[] {
  const d = E.OUT[q][i], o = E.RAW[q][i], p = q > 0 ? E.RAW[q - 1][i] : null, ch = CHANNEL[type]
  const val = (x: Obs | null) => (x ? (x[ch.key] as number).toFixed(ch.dp) : '—')
  const e = gate(d, 'E'), ph = gate(d, 'P'), t = gate(d, 'T'), r = gate(d, 'R'), s = gate(d, 'S')
  const z = d.z[(ch.key === 'V' || ch.key === 'R' || ch.key === 'S' ? 'T' : ch.key) as 'T' | 'RH' | 'W'] ?? 0
  const expV = ch.key === 'T' || ch.key === 'RH' || ch.key === 'W' ? d.exp[ch.key] : null
  const decidedBy = d.gates.find((g) => g.status === 'flag' || g.status === 'severe')
  const cls = CLS_META[d.cls]
  const checksAgainst = [
    e?.status === 'flag' || e?.status === 'warn', ph?.status === 'flag', t?.status === 'flag' || Math.abs(d.dT) > T_STEP,
    s?.status === 'flag' || Math.abs(z) > Z_SPATIAL, d.score > SCORE_REVIEW,
  ].filter(Boolean).length

  return [
    { id: 'raw', name: 'Raw sensor', method: 'Station RTU, 15-minute report', status: 'info',
      verdict: o ? `${val(o)} ${ch.unit}` : 'No transmission',
      detail: o ? `${ch.label} ${val(o)} ${ch.unit}; 15 minutes earlier ${val(p)} ${ch.unit}. Also T ${o.T.toFixed(1)} °C, RH ${o.RH.toFixed(0)}%, battery ${o.V.toFixed(2)} V.` : 'The logger sent nothing this interval.' },
    { id: 'health', name: 'Sensor health and physics', method: 'Battery, ADC; Clausius–Clapeyron, Magnus–Tetens', status: e?.status === 'flag' || ph?.status === 'flag' ? 'flag' : e?.status === 'warn' ? 'warn' : 'pass',
      verdict: e?.status === 'flag' ? 'Power fault' : ph?.status === 'flag' ? 'Physically impossible' : e?.status === 'warn' ? 'Battery degrading' : 'Healthy, physically possible',
      detail: [e?.text, ph?.text].filter(Boolean).join(' '),
      measure: o ? { value: o.V, threshold: V_ADC, unit: 'V', fmt: (v) => v.toFixed(2) } : undefined },
    { id: 'temporal', name: 'Temporal consistency', method: 'Step, flatline and spike rules', status: t?.status === 'flag' ? 'flag' : Math.abs(d.dT) > T_STEP ? 'warn' : statusOf(t) === 'info' ? 'info' : 'pass',
      verdict: t?.status === 'flag' ? 'Inconsistent over time' : 'Consistent over time',
      detail: t?.text ?? `15-minute change ${d.dT >= 0 ? '+' : ''}${d.dT.toFixed(1)} °C.`,
      measure: { value: Math.abs(d.dT), threshold: T_STEP, unit: '°C / 15 min', fmt: (v) => v.toFixed(1) } },
    { id: 'spatial', name: 'Spatial correlation', method: 'ST-GNN estimate from terrain-corrected neighbours', status: s?.status === 'flag' || Math.abs(z) > Z_SPATIAL ? 'flag' : 'pass',
      verdict: Math.abs(z) > Z_SPATIAL ? 'Disagrees with neighbours' : s?.status === 'flag' ? 'Sustained drift from neighbours' : 'Agrees with neighbours',
      detail: `${expV != null ? `Neighbours and terrain predict ${expV.toFixed(ch.dp)} ${ch.unit}; the station reports ${val(o)} ${ch.unit}. ` : ''}${s?.text ?? ''}`,
      measure: { value: Math.abs(z), threshold: Z_SPATIAL, unit: 'σ', fmt: (v) => v.toFixed(1) } },
    { id: 'baseline', name: 'Historical baseline', method: 'LSTM autoencoder over the last 4 hours', status: d.score > SCORE_REVIEW ? 'flag' : 'pass',
      verdict: d.score > SCORE_REVIEW ? 'Unlike normal behaviour' : 'Within normal behaviour',
      detail: `Reconstruction error ${d.score.toFixed(1)}. The review line is ${SCORE_REVIEW}, the 99.9th percentile of error on held-out fault-free data.`,
      measure: { value: d.score, threshold: SCORE_REVIEW, unit: '', fmt: (v) => v.toFixed(1) } },
    { id: 'external', name: 'External validation', method: 'Doppler radar and INSAT cloud-top', status: r?.status === 'severe' ? 'weather' : r?.status === 'flag' ? 'flag' : d.ctx.convective ? 'weather' : 'info',
      verdict: r?.status === 'severe' ? 'Real weather explains it' : r?.status === 'flag' ? 'Contradicts the sensor' : d.ctx.convective ? 'Convection present' : 'No weather to explain it',
      detail: r?.status === 'flag' || r?.status === 'severe' ? r.text : `Radar ${d.ctx.maxDbz.toFixed(0)} dBZ (convection needs over ${DBZ_CONVECTIVE}), INSAT cloud-top ${d.ctx.ctt.toFixed(0)} °C.`,
      measure: { value: d.ctx.maxDbz, threshold: DBZ_CONVECTIVE, unit: 'dBZ', fmt: (v) => v.toFixed(0) } },
    { id: 'score', name: 'Anomaly score', method: 'Evidence combined', status: checksAgainst >= 2 || d.score > SCORE_REVIEW ? 'flag' : 'pass',
      verdict: `${d.score.toFixed(1)} · ${(d.score / SCORE_REVIEW).toFixed(1)}× review line`,
      detail: `${checksAgainst} of 5 independent checks point to a sensor problem.` },
    { id: 'class', name: 'Classification', method: decidedBy ? `Decided by: ${decidedBy.name}` : d.warn ? 'Decided by: trend against the network' : 'All checks passed',
      status: isFault(d.cls) ? 'flag' : d.cls === 'SEVERE' ? 'weather' : d.warn ? 'warn' : 'pass',
      verdict: isFault(d.cls) ? `Sensor fault: ${cls.label.toLowerCase()}` : d.cls === 'SEVERE' ? 'Severe weather, kept' : d.warn ? `Valid now; failure predicted in about ${d.warn.hrs.toFixed(0)} h` : 'Valid',
      detail: `WMO QC flag ${wmoFlags(d).raw} → ${wmoFlags(d).clean} (${WMO_MEANING[wmoFlags(d).raw]} → ${WMO_MEANING[wmoFlags(d).clean]}).` },
  ]
}

/** What happens to the data downstream, with and without WeatherGuard, for this injected fault. */
export function impactFor(E: EngineResult, det: Latency & { at: number }, type: FaultType) {
  const i = det.i, fi = det.fi, ch = CHANNEL[type]
  const start = det.onset >= 0 ? det.onset : det.fault.k0
  const end = Math.min(STEPS - 1, start + 95)
  let bad = 0, legacyPassed = 0, wgPassed = 0
  for (let q = start; q <= end; q++) {
    if (!E.TRUTH[q][i].includes(fi)) continue
    bad++
    if (!E.LEG[q][i].flag) legacyPassed++
    if (!isFault(E.OUT[q][i].cls)) wgPassed++
  }
  const d = E.OUT[det.at][i], o = E.RAW[det.at][i]
  const raw = o ? (o[ch.key] as number) : null
  const clean = (d.clean as Record<string, number | undefined>)[ch.key]
  return {
    window: `${stamp(start)} to ${stamp(end)}`, hours: Math.round(((end - start + 1) * 15) / 60),
    bad, legacyPassed, wgPassed,
    wgLatency: det.onset >= 0 ? det.at - det.onset : null,
    lgLatency: det.lg >= 0 && det.onset >= 0 ? det.lg - det.onset : null,
    predictive: det.onset >= 0 && det.at < det.onset,
    raw, clean: clean ?? null, ch,
    label: FAULT_LABEL[type], station: STATIONS[i].name,
  }
}

export function minutes(steps: number | null) {
  if (steps == null) return null
  const m = steps * 15
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`
}
