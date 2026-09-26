// Shared types. These mirror the JSON the FastAPI backend will return,
// so the UI can switch from the in-browser engine to the real API without changes.

export interface Station {
  id: string
  name: string
  lon: number
  lat: number
  elev: number // metres above sea level
}

export type FaultType = 'flatline' | 'drift' | 'spike' | 'blockage' | 'power' | 'soiling' | 'bearing'

export interface Fault {
  st: string
  type: FaultType
  k0: number // step the fault starts
  steps?: number[] // for spike bursts
  user?: boolean
  val?: number // internal: frozen value for flatline
}

/** One 15-minute observation as transmitted by the station (null = no transmission). */
export interface Obs {
  T: number // air temperature °C
  RH: number // relative humidity %
  P: number // station pressure hPa
  W: number // wind speed m/s
  S: number // global solar radiation W/m²
  R: number // rain mm / 15 min
  V: number // battery V
  C: number // logger cabinet temperature °C
}

/** What the atmosphere is really doing (used for context feeds and scoring). */
export interface Truth extends Obs {
  cs: number // clear-sky solar W/m²
  dbz: number // radar reflectivity at station
  ctt: number // INSAT cloud-top temperature °C
  stormy: boolean
}

export type Cls =
  | 'VALID' | 'SEVERE' | 'ELECTRICAL' | 'MISSING' | 'PHYSICS'
  | 'FLATLINE' | 'SPIKE' | 'BLOCKAGE' | 'DRIFT' | 'SOILING' | 'BEARING' | 'ANOMALY'

export type GateStatus = 'pass' | 'flag' | 'warn' | 'severe' | 'skip'
export type GateId = 'E' | 'P' | 'T' | 'R' | 'S'

export interface Gate {
  id: GateId
  name: string
  status: GateStatus
  text: string
}

export interface Diagnosis {
  cls: Cls
  gates: Gate[]
  z: { T?: number; RH?: number; P?: number; W?: number }
  exp: { T: number; RH: number; P: number; W: number; R: number }
  ctx: { dbz: number; maxDbz: number; ctt: number; radarR: number; convective: boolean }
  clean: { T?: number; RH?: number; R?: number; S?: number; W?: number }
  warn: { kind: 'battery' | 'bearing'; hrs: number; slope: number } | null
  att: number | null
  score: number
  dT: number
  edge: { burst: boolean; flags: string[] } // tier-1 on-station pre-filter
}

export interface LegacyResult {
  flag: boolean
  why: string
}
