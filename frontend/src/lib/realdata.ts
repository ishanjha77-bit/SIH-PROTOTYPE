/** Shape of public/realdata/konkan-{year}.json, written by backend/app/realdata/build.py. */
export interface RealCase {
  station: string; name: string; t: string; when: string
  cls: RealClass; label: string; rejected: boolean
  T: number; expected: number | null; z: number | null; noaa: boolean
  reason: string; evidence: string[]
  neighbours: { name: string; km: number; T: number }[]
}
export type RealClass = 'OK' | 'PHYSICS' | 'STUCK' | 'SPIKE' | 'REVIEW' | 'WEATHER'
export interface RealData {
  source: { name: string; url: string; year: number; built: string; note: string }
  thresholds: { zOutlier: number; zCalm: number; stuckHours: number; stuckNeighbourMove: number; dewMargin: number; weatherRadiusKm: number }
  classes: { code: RealClass; label: string; rejected: boolean }[]
  stations: { id: string; name: string; isd: string; lat: number; lon: number; elev: number; n: number }[]
  summary: {
    readings: number; byClass: Partial<Record<RealClass, number>>
    noaaFlags: number; bothFlag: number; noaaOnly: number; wgOnly: number; noaaFlagsKept: number
    weatherNoaaFlagged: number; noaaOnlyMedianZ: number | null; noaaOnlyWithinZ2: number | null
  }
  showcase: RealCase[]
  model: null | {
    name: string; scheme: string; evaluated_readings: number; params: number; epochs: number
    metrics: Record<'st_gnn' | 'idw' | 'weighted_median' | 'climatology_plus_median', { rmse: number; mae: number; p95_abs: number }> & { st_gnn_rh: { rmse: number } }
  }
  t0: string; stepHours: number
  series: Record<string, { T: (number | null)[]; E: (number | null)[]; C: (number | null)[]; N: (0 | 1)[] }>
}

let cache: Promise<RealData> | null = null
export function loadRealData(year = 2023): Promise<RealData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}realdata/konkan-${year}.json`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<RealData>
  }).catch((e) => { cache = null; throw e })
  return cache
}

export const CLASS_TONE: Record<RealClass, 'ok' | 'fault' | 'storm' | 'warn'> = {
  OK: 'ok', PHYSICS: 'fault', STUCK: 'fault', SPIKE: 'fault', REVIEW: 'warn', WEATHER: 'storm',
}
