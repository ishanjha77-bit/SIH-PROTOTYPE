import type { Cls, Diagnosis, FaultType, Obs } from '../engine/types'
import { STATIONS } from '../engine/engine'

export type Tone = 'ok' | 'storm' | 'fault' | 'power' | 'warn' | 'off'

export const TONE: Record<Tone, { fg: string; bg: string; hex: string }> = {
  ok: { fg: 'text-ok', bg: 'bg-ok-soft', hex: 'var(--ok)' },
  storm: { fg: 'text-storm', bg: 'bg-storm-soft', hex: 'var(--storm)' },
  fault: { fg: 'text-fault', bg: 'bg-fault-soft', hex: 'var(--fault)' },
  power: { fg: 'text-power', bg: 'bg-power-soft', hex: 'var(--power)' },
  warn: { fg: 'text-warn', bg: 'bg-warn-soft', hex: 'var(--warn)' },
  off: { fg: 'text-off', bg: 'bg-off-soft', hex: 'var(--off)' },
}

export const CLS_META: Record<Cls, { label: string; tone: Tone }> = {
  VALID: { label: 'Valid', tone: 'ok' },
  SEVERE: { label: 'Severe weather', tone: 'storm' },
  ELECTRICAL: { label: 'Power fault', tone: 'power' },
  MISSING: { label: 'Offline', tone: 'off' },
  PHYSICS: { label: 'Physics violation', tone: 'fault' },
  FLATLINE: { label: 'Stuck sensor', tone: 'fault' },
  SPIKE: { label: 'Spike', tone: 'fault' },
  BLOCKAGE: { label: 'Gauge blocked', tone: 'fault' },
  DRIFT: { label: 'Humidity drift', tone: 'fault' },
  SOILING: { label: 'Solar soiling', tone: 'fault' },
  BEARING: { label: 'Bearing wear', tone: 'fault' },
  ANOMALY: { label: 'Needs review', tone: 'fault' },
}

export const statusOf = (d: Diagnosis) =>
  d.cls === 'VALID' && d.warn ? { label: d.warn.kind === 'bearing' ? 'Bearing warning' : 'Battery warning', tone: 'warn' as Tone } : CLS_META[d.cls]

/** WMO-style QC flags: 0 good · 2 doubtful · 3 erroneous · 4 corrected/imputed · 9 missing (mirrors the backend). */
export function wmoFlags(d: Diagnosis) {
  const faults: Cls[] = ['ELECTRICAL', 'MISSING', 'PHYSICS', 'FLATLINE', 'SPIKE', 'BLOCKAGE', 'DRIFT', 'SOILING', 'BEARING', 'ANOMALY']
  const raw = d.cls === 'VALID' || d.cls === 'SEVERE' ? 0 : d.cls === 'ANOMALY' ? 2 : d.cls === 'MISSING' ? 9 : 3
  const clean = faults.includes(d.cls) && d.cls !== 'ANOMALY' ? 4 : raw
  return { raw, clean }
}
export const WMO_MEANING: Record<number, string> = { 0: 'good', 2: 'doubtful', 3: 'erroneous', 4: 'corrected', 9: 'missing' }

/** Trust in the value sent downstream, 0–1 (mirrors the backend). */
export function confidence(d: Diagnosis) {
  if (d.cls === 'VALID' || d.cls === 'SEVERE') return Math.max(0.6, Math.min(0.99, 0.99 - Math.max(0, d.score - 2) / 20))
  if (d.cls === 'ANOMALY') return 0.5
  return d.cls === 'MISSING' ? 0.65 : 0.75
}

export const clock = (k: number) => {
  const m = (k % 96) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const dayOf = (k: number) => Math.floor(k / 96) + 1
export const stamp = (k: number) => `Day ${dayOf(k)} · ${clock(k)}`
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
export const hours = (steps: number) => {
  const h = steps * 0.25
  return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`
}

export function narrative(i: number, d: Diagnosis, o: Obs | null): { title: string; body: string } {
  const s = STATIONS[i], c = d.ctx
  switch (d.cls) {
    case 'SEVERE':
      return { title: 'Real severe weather. Keep this observation.', body: `${s.name} is under a squall line. Radar shows ${c.maxDbz.toFixed(0)} dBZ and INSAT cloud-top is ${c.ctt.toFixed(0)} °C. Temperature moved ${d.dT >= 0 ? '+' : ''}${d.dT.toFixed(1)} °C in 15 min with ${o?.R.toFixed(1)} mm of rain and ${o?.W.toFixed(1)} m/s wind. Extreme, but physically consistent, so it goes to forecasters and NWP.` }
    case 'BLOCKAGE':
      return { title: 'Rain-gauge funnel is blocked.', body: `The gauge reports 0.0 mm while radar measures ${c.dbz.toFixed(0)} dBZ (about ${c.radarR.toFixed(1)} mm per 15 min) and nearby gauges are wet. Rainfall is filled from radar and a field visit is raised.` }
    case 'FLATLINE':
      return { title: 'Temperature sensor is stuck.', body: `The reading has not changed for 90 minutes while every neighbour moved. A virtual sensor now supplies ${d.exp.T.toFixed(1)} °C from altitude-corrected neighbours.` }
    case 'DRIFT':
      return { title: 'Humidity sensor is drifting.', body: `RH reads ${o ? (o.RH - d.exp.RH).toFixed(1) : '?'}% higher than the surrounding network predicts, and the gap keeps growing. Range checks will not catch this until it passes 100%. Recalibrate or swap the probe.` }
    case 'SPIKE':
      return { title: 'Isolated spike removed.', body: `Temperature jumped ${d.dT.toFixed(1)} °C with no radar echo and no change at neighbours. Treated as electrical noise and replaced with ${d.exp.T.toFixed(1)} °C.` }
    case 'ELECTRICAL':
      return { title: 'Low power is corrupting readings.', body: `Battery at ${o?.V.toFixed(2)} V has pulled the ADC reference down, so temperature, humidity and pressure are all biased. Every channel is quarantined and imputed until power returns.` }
    case 'MISSING':
      return { title: 'Station is offline.', body: `The logger stopped transmitting after its battery hit cut-off. The virtual sensor fills the gap (T ${d.exp.T.toFixed(1)} °C, RH ${d.exp.RH.toFixed(0)}%) so NWP assimilation has no hole.` }
    case 'SOILING':
      return { title: 'Pyranometer dome needs cleaning.', body: `Solar radiation is running ${((d.att ?? 0) * 100).toFixed(0)}% below the neighbours' clear-sky index. Corrected value ${d.clean.S?.toFixed(0)} W/m².` }
    case 'BEARING':
      return { title: 'Anemometer bearing is wearing out.', body: `Wind reads well below what altitude-corrected neighbours predict, and the gap has grown for hours. Friction slows the cups, which then stall in light wind. The virtual sensor supplies ${d.exp.W.toFixed(1)} m/s until the bearing is replaced.` }
    case 'PHYSICS':
      return { title: 'Physically impossible reading.', body: 'The observation breaks thermodynamic limits and is rejected.' }
    case 'ANOMALY':
      return { title: 'Unusual combination of readings.', body: 'No single check failed, but together the residuals look unlike normal behaviour. Sent to a forecaster for review.' }
    default:
      if (d.warn?.kind === 'bearing') return { title: 'Data is fine. Anemometer is degrading.', body: `Wind is drifting below the neighbour prediction by ${(-d.warn.slope * 4 * 100).toFixed(1)}% per hour. It will cross the tolerance in about ${d.warn.hrs.toFixed(0)} h. Schedule a bearing replacement on the next visit.` }
      if (d.warn) return { title: 'Data is fine. Power will fail soon.', body: `The battery is dropping ${(-d.warn.slope * 4).toFixed(2)} V/h faster than the rest of the network. At this rate readings degrade in about ${d.warn.hrs.toFixed(1)} h. Check the solar panel and charge controller now.` }
      return { title: 'All checks passed.', body: `Temperature is within ${Math.abs(d.z.T ?? 0).toFixed(1)}σ of the altitude-corrected neighbour estimate, humidity within ${Math.abs(d.z.RH ?? 0).toFixed(1)}σ, and rain agrees with radar.` }
  }
}

export const WORK_ORDER: Record<FaultType, { title: string; parts: string; priority: 'P1' | 'P2' | 'P3' }> = {
  drift: { title: 'Recalibrate humidity probe', parts: 'Reference hygrometer, spare RH probe', priority: 'P2' },
  flatline: { title: 'Replace temperature sensor', parts: 'PT100 probe, shield fixings', priority: 'P1' },
  spike: { title: 'Inspect cabling and earthing', parts: 'Shielded cable, surge arrestor', priority: 'P3' },
  blockage: { title: 'Clear rain-gauge funnel', parts: 'Funnel mesh, cleaning brush', priority: 'P1' },
  power: { title: 'Restore station power', parts: '12 V 42 Ah battery, charge controller', priority: 'P1' },
  soiling: { title: 'Clean pyranometer dome', parts: 'Lint-free cloth, desiccant', priority: 'P3' },
  bearing: { title: 'Replace anemometer bearing', parts: 'Bearing kit, cup assembly, spin-down tester', priority: 'P2' },
}
