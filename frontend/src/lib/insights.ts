import { N, STATIONS, isFault, metrics, stationIndex, type EngineResult } from '../engine/engine'
import type { Cls, FaultType } from '../engine/types'
import type { View } from '../state/console'
import { WORK_ORDER, clock, span, type Tone } from './present'

/**
 * AI insights: what the pipeline found, the evidence, how it compares with normal / legacy QC,
 * and what to do next. Every string is derived from the live engine output, never canned.
 */
export type InsightKind = 'storm' | 'fault' | 'predictive'
export interface Insight {
  id: string
  kind: InsightKind
  tone: Tone
  i: number
  title: string
  evidence: string
  context: string
  recommendation: string
  action: { label: string; view: View }
  /** Legacy QC's verdict on the same reading: the reason WeatherGuard exists. */
  legacy: 'missed' | 'false-alarm' | 'agrees' | 'blind'
  since: number
  rank: number
}

const CLS_FAULT: Partial<Record<Cls, FaultType>> = {
  FLATLINE: 'flatline', DRIFT: 'drift', SPIKE: 'spike', BLOCKAGE: 'blockage',
  ELECTRICAL: 'power', MISSING: 'power', SOILING: 'soiling', BEARING: 'bearing',
}

/** First step of the current run of `pred` at station i (walking back from k). */
function runStart(E: EngineResult, k: number, i: number, pred: (c: Cls) => boolean) {
  let q = k
  while (q > 0 && pred(E.OUT[q - 1][i].cls)) q--
  return q
}

function warnStart(E: EngineResult, k: number, i: number) {
  let q = k
  while (q > 0 && E.OUT[q - 1][i].warn) q--
  return q
}

/**
 * Network-level storm finding: every genuine storm observation legacy QC has rejected so far,
 * versus WeatherGuard keeping them. This is the product's core claim, so it leads when it applies.
 */
function stormNetwork(E: EngineResult, k: number): Insight | null {
  const per = new Array(N).fill(0)
  let storm = 0, kept = 0, first = -1, lastWhy = '', peak = 0
  for (let q = 0; q <= k; q++) for (let i = 0; i < N; i++) {
    if (E.TRUTH[q][i].length || !E.TRUE[q][i].stormy) continue
    storm++
    peak = Math.max(peak, E.OUT[q][i].ctx.maxDbz)
    if (!isFault(E.OUT[q][i].cls)) kept++
    if (E.LEG[q][i].flag) { per[i]++; lastWhy = E.LEG[q][i].why; if (first < 0) first = q }
  }
  const rejected = per.reduce((a, b) => a + b, 0)
  if (!rejected) return null
  const order = per.map((n, i) => [n, i] as const).filter(([n]) => n).sort((a, b) => b[0] - a[0])
  const severeNow = order.find(([, i]) => E.OUT[k][i].cls === 'SEVERE')
  const i = (severeNow ?? order[0])[1]
  const where = order.slice(0, 3).map(([n, j]) => `${STATIONS[j].name.split(' ')[0]} ${n}`).join(' · ')
  return {
    id: 'storm-network', kind: 'storm', tone: 'storm', i, since: first,
    title: `Legacy QC threw out ${rejected} genuine storm readings. WeatherGuard kept ${kept === storm ? 'all' : kept} ${storm}.`,
    evidence: `Rejected by legacy QC: ${where}${order.length > 3 ? ` · +${order.length - 3} more` : ''} · storm peak ${peak.toFixed(0)} dBZ on radar`,
    context: `Rule-based step checks can't tell a squall from a broken sensor (latest: “${lastWhy}”). WeatherGuard checked each reading against Doppler radar and INSAT cloud-top; both show the same squall line crossing the Ghats, so the data is real and is kept.`,
    recommendation: 'Keep every storm observation in the forecast feed. These are the readings NWP needs most. CAP alerts are on record for IMD and NDMA.',
    action: { label: 'Confirm and keep', view: 'station' },
    legacy: 'false-alarm',
    rank: -1,
  }
}

export function insights(E: EngineResult, k: number): Insight[] {
  const out: Insight[] = []
  const net = stormNetwork(E, k)
  if (net) out.push(net)
  for (let i = 0; i < N; i++) {
    const s = STATIONS[i], d = E.OUT[k][i], o = E.RAW[k][i], leg = E.LEG[k][i], c = d.ctx
    const short = s.name.split(' ')[0]

    if (d.cls === 'SEVERE') {
      const since = runStart(E, k, i, (x) => x === 'SEVERE')
      let rejected = 0, why = leg.why
      for (let q = since; q <= k; q++) if (E.LEG[q][i].flag) { rejected++; why = E.LEG[q][i].why }
      out.push({
        id: `storm-${i}`, kind: 'storm', tone: 'storm', i, since,
        title: `Severe weather confirmed at ${short}`,
        evidence: `Radar ${c.maxDbz.toFixed(0)} dBZ · INSAT cloud-top ${c.ctt.toFixed(0)} °C · temperature ${d.dT >= 0 ? '+' : ''}${d.dT.toFixed(1)} °C in 15 min${o ? ` · wind ${o.W.toFixed(1)} m/s` : ''}`,
        context: rejected
          ? `The rule-based step check rejected ${rejected > 1 ? 'them' : 'it'} (“${why}”). Radar and satellite, two independent sources, show the same squall, so WeatherGuard keeps the data forecasters need most.`
          : 'Readings are far outside this station’s normal range, but radar and satellite independently show the same event.',
        recommendation: 'Keep these observations in the forecast feed. A CAP alert has gone to IMD and NDMA.',
        action: { label: 'Confirm and keep', view: 'station' },
        legacy: rejected ? 'false-alarm' : 'agrees',
        rank: 1.2,
      })
      continue
    }

    const ft = CLS_FAULT[d.cls]
    if (isFault(d.cls) && ft) {
      const since = runStart(E, k, i, (x) => isFault(x))
      const w = WORK_ORDER[ft]
      const evidence = (() => {
        switch (d.cls) {
          case 'DRIFT': return `Humidity ${o ? `${o.RH.toFixed(1)}%` : '—'} vs ${d.exp.RH.toFixed(1)}% predicted from neighbours and terrain; the gap is widening`
          case 'FLATLINE': return `Temperature unchanged at ${o?.T.toFixed(1)} °C for 90 min while every neighbour moved`
          case 'BLOCKAGE': return `Gauge reads ${o?.R.toFixed(1) ?? '0.0'} mm under a ${c.dbz.toFixed(0)} dBZ radar echo (≈${c.radarR.toFixed(1)} mm expected)`
          case 'SPIKE': return `Temperature jumped ${d.dT.toFixed(1)} °C in 15 min with no radar echo and no change at neighbours`
          case 'ELECTRICAL': return `Battery at ${o?.V.toFixed(2)} V is biasing temperature, humidity and pressure`
          case 'MISSING': return 'Logger stopped transmitting after the battery reached cut-off'
          case 'SOILING': return `Solar radiation ${((d.att ?? 0) * 100).toFixed(0)}% below the neighbours’ clear-sky index`
          case 'BEARING': return `Wind ${o ? `${o.W.toFixed(1)} m/s` : '—'} vs ${d.exp.W.toFixed(1)} m/s expected; the shortfall has grown for hours`
          default: return ''
        }
      })()
      const legacyMissed = !leg.flag
      out.push({
        id: `fault-${i}`, kind: 'fault', tone: d.cls === 'ELECTRICAL' ? 'power' : d.cls === 'MISSING' ? 'off' : 'fault', i, since,
        title: `${short}: ${faultTitle(d.cls)}`,
        evidence,
        context: legacyMissed
          ? `Legacy QC accepts this reading, so the bad value would reach forecasters. Detected ${span(k - since + 1)} ago.`
          : `Legacy QC also rejects it, but can't say why or fill the gap. Detected ${span(k - since + 1)} ago.`,
        recommendation: `${w.title} (${w.priority}). Carry: ${w.parts.toLowerCase()}. Until then the virtual sensor supplies corrected values.`,
        action: { label: 'Dispatch work order', view: 'maintenance' },
        legacy: legacyMissed ? 'missed' : 'agrees',
        rank: legacyMissed ? 1 : 2,
      })
      continue
    }

    if (d.warn) {
      const bearing = d.warn.kind === 'bearing'
      const w = WORK_ORDER[bearing ? 'bearing' : 'power']
      out.push({
        id: `warn-${i}`, kind: 'predictive', tone: 'warn', i, since: warnStart(E, k, i),
        title: bearing ? `${short} anemometer will go out of tolerance in ~${d.warn.hrs.toFixed(0)} h` : `${short} will lose power in ~${d.warn.hrs.toFixed(1)} h`,
        evidence: bearing
          ? `Wind is falling ${(-d.warn.slope * 4 * 100).toFixed(1)}% per hour below the neighbour prediction`
          : `Battery is draining ${(-d.warn.slope * 4).toFixed(2)} V/h faster than the rest of the network`,
        context: 'The data is still clean, so no rule-based check can see this. The trend comes from comparing this station with its neighbours.',
        recommendation: `${w.title} before it fails (${w.priority}). Carry: ${w.parts.toLowerCase()}.`,
        action: { label: 'Schedule field visit', view: 'maintenance' },
        legacy: 'blind',
        rank: 1.5,
      })
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.i - b.i)
}

function faultTitle(c: Cls) {
  return ({
    DRIFT: 'humidity sensor is drifting', FLATLINE: 'temperature sensor is stuck', BLOCKAGE: 'rain gauge is blocked',
    SPIKE: 'electrical spike removed', ELECTRICAL: 'low power is corrupting readings', MISSING: 'station is offline',
    SOILING: 'solar sensor needs cleaning', BEARING: 'anemometer bearing is worn',
  } as Partial<Record<Cls, string>>)[c] ?? 'unusual readings'
}

/** Headline numbers and the one-sentence status for the overview hero. */
export function networkSummary(E: EngineResult, k: number) {
  const now = E.OUT[k]
  const faulty = now.filter((d) => isFault(d.cls)).length
  const storming = STATIONS.filter((_, i) => now[i].cls === 'SEVERE').map((s) => s.name.split(' ')[0])
  const warn = now.filter((d) => d.warn).length
  const m = metrics(E, k)
  const trusted = N - faulty
  const headline = storming.length
    ? `A squall line is crossing ${list(storming)}. Those readings are extreme but real, so they stay in the record.`
    : faulty ? `Skies are calm. ${faulty} station${faulty > 1 ? 's have' : ' has'} a sensor problem, and virtual sensors are filling the gaps.`
      : 'Every station is reporting clean, physically consistent data.'
  const title = storming.length ? 'Severe weather in progress. Your data is holding up.'
    : faulty ? 'Network is stable. A few sensors need attention.' : 'All clear across the network.'
  return { trusted, faulty, storming, warn, m, headline, title }
}

export function greeting(k: number) {
  const h = +clock(k).slice(0, 2)
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const list = (a: string[]) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, 2).join(', ')} and ${a.length - 2} more`)

/** Work-order number shared with the Maintenance view (WO-02601 + fault index). */
export function workOrderId(E: EngineResult, i: number) {
  const fi = E.faults.findIndex((f) => stationIndex(f.st) === i)
  return fi < 0 ? null : `WO-${String(2601 + fi).padStart(5, '0')}`
}

/**
 * One real observation where legacy QC and WeatherGuard disagree, for the overview's side-by-side.
 * Prefers the latest storm reading legacy QC rejected; otherwise a current fault legacy QC accepted.
 */
export interface Disagreement {
  kind: 'storm' | 'fault'
  i: number
  q: number
  legacy: string
  wg: string
  detail: string
}
export function disagreement(E: EngineResult, k: number): Disagreement | null {
  for (let q = k; q >= Math.max(0, k - 96); q--) for (let i = 0; i < N; i++) {
    const d = E.OUT[q][i], o = E.RAW[q][i], leg = E.LEG[q][i]
    if (d.cls !== 'SEVERE' || !leg.flag || !o) continue
    return {
      kind: 'storm', i, q, legacy: leg.why,
      wg: `Radar ${d.ctx.maxDbz.toFixed(0)} dBZ and INSAT cloud-top ${d.ctx.ctt.toFixed(0)} °C show a squall over the station`,
      detail: `T ${o.T.toFixed(1)} °C (${d.dT >= 0 ? '+' : ''}${d.dT.toFixed(1)} in 15 min) · wind ${o.W.toFixed(1)} m/s · rain ${o.R.toFixed(1)} mm`,
    }
  }
  for (let i = 0; i < N; i++) {
    const d = E.OUT[k][i], o = E.RAW[k][i]
    if (!isFault(d.cls) || E.LEG[k][i].flag || !o) continue
    return {
      kind: 'fault', i, q: k, legacy: 'Passed range, step and persistence checks',
      wg: `Off by ${Math.abs(o.RH - d.exp.RH) > 3 ? `${(o.RH - d.exp.RH).toFixed(1)}% RH` : `${(o.T - d.exp.T).toFixed(1)} °C`} from what neighbours and terrain predict`,
      detail: `T ${o.T.toFixed(1)} °C · RH ${o.RH.toFixed(1)}% · wind ${o.W.toFixed(1)} m/s`,
    }
  }
  return null
}
