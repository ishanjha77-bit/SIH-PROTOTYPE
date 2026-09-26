import { N, STATIONS, isFault, metrics, type EngineResult } from '../engine/engine'
import { wmoFlags } from './present'

const LABEL: Record<string, string> = {
  ELECTRICAL: 'power fault', MISSING: 'offline', PHYSICS: 'physics violation', FLATLINE: 'stuck sensor', SPIKE: 'spike',
  BLOCKAGE: 'rain-gauge blockage', DRIFT: 'humidity drift', SOILING: 'pyranometer soiling', BEARING: 'anemometer bearing wear', ANOMALY: 'needs review',
}

export interface ShiftReport { headline: string; last24: string[]; attention: [string, string][]; predicted: [string, string][] }

/** Natural-language shift report for the forecaster on duty (mirrors GET /api/v1/report). */
export function shiftReport(E: EngineResult, k: number): ShiftReport {
  const m = metrics(E, k), now = E.OUT[k]
  const faulty = now.map((d, i) => [STATIONS[i].name, d] as const).filter(([, d]) => isFault(d.cls))
  const severe = now.map((d, i) => (d.cls === 'SEVERE' ? STATIONS[i].name : null)).filter(Boolean)
  let kept = 0, legacy = 0, imputed = 0
  for (let q = Math.max(0, k - 95); q <= k; q++) for (let i = 0; i < N; i++) {
    const d = E.OUT[q][i]
    if (d.cls === 'SEVERE') { kept++; if (E.LEG[q][i].flag) legacy++ }
    if (wmoFlags(d).clean === 4) imputed++
  }
  return {
    headline: `${N - faulty.length} of ${N} stations reporting trustworthy data. ${severe.length ? `Severe weather in progress at ${severe.join(', ')}.` : 'No severe weather in progress.'}`,
    last24: [
      `${kept} severe-weather observations verified by radar and satellite and kept${legacy ? `; legacy QC would have rejected ${legacy} of them` : ''}.`,
      `${imputed} values corrected or filled by the physics-constrained virtual sensor (QC flag 4).`,
      `Since start: WeatherGuard caught ${m.wg.tp} faulty readings with ${m.wg.fp} false alarms; legacy QC caught ${m.lg.tp} with ${m.lg.fp}.`,
    ],
    attention: faulty.map(([n, d]) => [n, LABEL[d.cls]]),
    predicted: now.map((d, i) => (d.warn ? [STATIONS[i].name, `${d.warn.kind === 'bearing' ? 'Anemometer bearing' : 'Battery'} out of tolerance in about ${d.warn.hrs.toFixed(0)} h`] as [string, string] : null)).filter((x): x is [string, string] => !!x),
  }
}
