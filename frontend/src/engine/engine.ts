/*
 * WeatherGuard AI – in-browser reference engine.
 *
 * 1. simulate(): a deterministic 12-station AWS network (Konkan coast + Western Ghats)
 *    with diurnal cycle, lapse rate, semidiurnal pressure tide and a squall line on day 2.
 *    Sensor faults are injected at known times so every flag can be scored.
 * 2. detect(): the five-gate quality-control pipeline, run causally on each 15-min observation.
 * 3. legacy QC: WMO-style range / step / persistence checks for a head-to-head comparison.
 *
 * In production, tiers 3–4 run in the FastAPI backend (LSTM-AE + ST-GNN). This module keeps the
 * same inputs/outputs so the UI works identically against either.
 */
import type { Cls, Diagnosis, Fault, FaultType, Gate, GateId, GateStatus, LegacyResult, Obs, Station, Truth } from './types'

export const STATIONS: Station[] = [
  { id: 'dahanu', name: 'Dahanu', lon: 72.72, lat: 19.97, elev: 9 },
  { id: 'mumbai', name: 'Mumbai Santacruz', lon: 72.84, lat: 19.09, elev: 14 },
  { id: 'matheran', name: 'Matheran', lon: 73.27, lat: 18.99, elev: 800 },
  { id: 'alibag', name: 'Alibag', lon: 72.87, lat: 18.64, elev: 7 },
  { id: 'ratnagiri', name: 'Ratnagiri', lon: 73.31, lat: 16.99, elev: 67 },
  { id: 'lonavala', name: 'Lonavala', lon: 73.41, lat: 18.75, elev: 622 },
  { id: 'mahabaleshwar', name: 'Mahabaleshwar', lon: 73.66, lat: 17.92, elev: 1382 },
  { id: 'nashik', name: 'Nashik', lon: 73.79, lat: 20.0, elev: 584 },
  { id: 'pune', name: 'Pune Shivajinagar', lon: 73.86, lat: 18.52, elev: 559 },
  { id: 'satara', name: 'Satara', lon: 74.0, lat: 17.68, elev: 691 },
  { id: 'kolhapur', name: 'Kolhapur', lon: 74.24, lat: 16.7, elev: 548 },
  { id: 'ahmednagar', name: 'Ahmednagar', lon: 74.74, lat: 19.09, elev: 649 },
]

export const N = STATIONS.length
export const STEPS = 288 // 3 days × 96 fifteen-minute steps
const LAPSE = 0.0065 // °C per metre
export const TRAIN_K = 36 // first 9 h used to learn each station's normal behaviour

export const stationIndex = (id: string) => STATIONS.findIndex((s) => s.id === id)
const W = STATIONS.map((a, i) => STATIONS.map((b, j) => (i === j ? 0 : 1 / ((a.lon - b.lon) ** 2 + (a.lat - b.lat) ** 2 + 0.02))))

export const DEFAULT_FAULTS: Fault[] = [
  { st: 'pune', type: 'drift', k0: 40 },
  { st: 'satara', type: 'soiling', k0: 20 },
  { st: 'kolhapur', type: 'spike', k0: 60, steps: [60, 97, 205, 240] },
  { st: 'ratnagiri', type: 'blockage', k0: 100 },
  { st: 'nashik', type: 'flatline', k0: 110 },
  { st: 'mahabaleshwar', type: 'power', k0: 138 },
  { st: 'ahmednagar', type: 'bearing', k0: 30 },
]

export const FAULT_LABEL: Record<FaultType, string> = {
  flatline: 'Stuck sensor (flatline)',
  drift: 'Humidity calibration drift',
  spike: 'Spike burst',
  blockage: 'Rain-gauge funnel blockage',
  power: 'Battery / power sag',
  soiling: 'Pyranometer soiling',
  bearing: 'Anemometer bearing wear',
}
export const FAULT_CLASSES: Record<FaultType, Cls[]> = {
  flatline: ['FLATLINE'], drift: ['DRIFT'], spike: ['SPIKE'], blockage: ['BLOCKAGE'],
  power: ['ELECTRICAL', 'MISSING'], soiling: ['SOILING'], bearing: ['BEARING'],
}
export const FAULT_CLS: Cls[] = ['ELECTRICAL', 'MISSING', 'PHYSICS', 'FLATLINE', 'SPIKE', 'BLOCKAGE', 'DRIFT', 'SOILING', 'BEARING', 'ANOMALY']
export const isFault = (c: Cls) => FAULT_CLS.includes(c)

// ---------------- deterministic noise ----------------
export function hash(a: number, b: number, c: number) {
  let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 7, 668265263) + Math.imul(c + 3, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
const gn = (a: number, b: number, c: number) => (hash(a, b, c) + hash(a, b, c + 17) + hash(a, b, c + 31) - 1.5) * 2

// ---------------- atmosphere ----------------
const hourOf = (k: number) => (k * 0.25) % 24
function cosZ(lat: number, k: number) {
  const H = ((hourOf(k) - 12.6) * 15 * Math.PI) / 180, d = (-1 * Math.PI) / 180, p = (lat * Math.PI) / 180
  return Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H)
}
const clearSky = (lat: number, k: number) => { const c = cosZ(lat, k); return c > 0 ? 1050 * Math.pow(c, 1.2) : 0 }
function stormAmp(k: number) {
  if (k < 118) return 0
  if (k < 126) return (k - 118) / 8
  if (k < 185) return 1
  if (k < 200) return (200 - k) / 15
  return 0
}
/** Squall line moving west → east across the network on day 2. rain in mm/h. */
export function stormAt(lon: number, lat: number, k: number) {
  const A = stormAmp(k)
  if (A <= 0) return { rain: 0, conv: 0, behind: 0, d: 9, A: 0 }
  const lonC = 72.2 + (k - 128) * 0.055, d = lon - lonC
  const conv = Math.exp(-((d / 0.09) ** 2)), behind = d < 0 ? Math.exp(d / 0.6) : 0
  const latMod = 0.75 + 0.25 * Math.cos((lat - 18.3) * 1.6)
  const rain = A * latMod * (55 * conv + (d < -0.05 ? 9 * behind : 0))
  return { rain, conv: conv * A * latMod, behind: behind * A * latMod, d, A: A * latMod }
}
export const dbzFromRain = (r: number) => (r > 0.15 ? 10 * Math.log10(200 * Math.pow(r, 1.6)) : 5)
/** Marshall–Palmer Z = 200 R^1.6 inverted: rain rate mm/h from dBZ */
export const rainFromDbz = (z: number) => (z > 12 ? Math.pow(Math.pow(10, z / 10) / 200, 1 / 1.6) : 0)

function truth(i: number, k: number): Truth {
  const s = STATIONS[i], h = hourOf(k), diur = Math.sin((2 * Math.PI * (h - 9)) / 24)
  const sw = stormAt(s.lon, s.lat, k)
  const coastal = s.lon < 73.0 ? 1 : 0
  const Tsl = 28.4 + 3.6 * diur + (s.lon - 73) * 0.9 * Math.max(0, diur) + 0.5 * Math.sin(k / 55) + 0.22 * gn(i, k, 1)
  let cold = 0
  if (sw.d < 0 && sw.A > 0) cold = -7.5 * (1 - Math.exp(sw.d / 0.04)) * Math.exp(sw.d / 1.0) * sw.A
  const T = Tsl - LAPSE * s.elev + cold
  let RH = 73 + coastal * 7 + s.elev * 0.004 - 6.5 * diur + 1.2 * gn(i, k, 2) + 28 * (sw.conv + 0.8 * sw.behind)
  RH = Math.min(99, Math.max(20, RH))
  const P = 1007.8 * Math.exp(-s.elev / 8430) + 1.1 * Math.cos((2 * Math.PI * (h - 10)) / 12) + (sw.d < 0 ? 2.6 * Math.exp(sw.d / 0.5) * sw.A : 0) + 0.12 * gn(i, k, 3)
  const Wd = Math.max(0.2, 3 + 1.8 * Math.sin((2 * Math.PI * (h - 14)) / 24) + 0.6 * gn(i, k, 4) + 20 * sw.conv + 5 * sw.behind)
  const cs = clearSky(s.lat, k)
  const cloud = Math.max(0.08, 0.8 + 0.08 * gn(i, k, 5) - 0.7 * Math.min(1, sw.conv + sw.behind))
  const rainRate = Math.max(0, sw.rain * (1 + 0.15 * gn(i, k, 6)))
  return {
    T, RH, P, W: Wd, S: cs * cloud, cs, R: rainRate / 4,
    V: 12.55 + 0.12 * Math.tanh((cs * cloud) / 300) + 0.03 * gn(i, k, 9),
    C: T + 3 + (14 * cs * cloud) / 1000 + 0.3 * gn(i, k, 10), // logger cabinet temperature
    dbz: dbzFromRain(rainRate) + 1.2 * gn(i, k, 7),
    ctt: 24 - 88 * Math.min(1, sw.conv * 1.3 + sw.behind * 0.6) + 1.5 * gn(i, k, 8),
    stormy: sw.conv + sw.behind > 0.08 || cold < -0.5,
  }
}

/** Clausius–Clapeyron (integrated, constant L): saturation vapour pressure in hPa. */
export function satVapour(T: number) {
  const L = 2.501e6, Rv = 461.5
  return 6.112 * Math.exp((L / Rv) * (1 / 273.15 - 1 / (T + 273.15)))
}

export function magnus(T: number, RH: number) {
  const a = 17.625, b = 243.04, g = Math.log(Math.max(RH, 1) / 100) + (a * T) / (b + T)
  return (b * g) / (a - g)
}
function median(a: number[]) {
  if (!a.length) return 0
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2
}
function jacobi(A: number[][]) {
  const n = A.length, a = A.map((r) => r.slice()), v: number[][] = a.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2
    if (off < 1e-12) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let r = 0; r < n; r++) { const x = a[r][p], y = a[r][q]; a[r][p] = c * x - s * y; a[r][q] = s * x + c * y }
      for (let r = 0; r < n; r++) { const x = a[p][r], y = a[q][r]; a[p][r] = c * x - s * y; a[q][r] = s * x + c * y }
      for (let r = 0; r < n; r++) { const x = v[r][p], y = v[r][q]; v[r][p] = c * x - s * y; v[r][q] = s * x + c * y }
    }
  }
  return { vals: a.map((r, i) => Math.max(r[i], 1e-3)), vecs: v }
}

type VarKey = 'T' | 'RH' | 'P' | 'W'
const FLOOR: Record<VarKey, number> = { T: 0.45, RH: 2.6, P: 0.45, W: 1.3 }
const g = (id: GateId, name: string, status: GateStatus, text: string): Gate => ({ id, name, status, text })

export interface EngineResult {
  faults: Fault[]
  TRUE: Truth[][]
  RAW: (Obs | null)[][]
  TRUTH: number[][][] // indices of faults manifest at [k][i]
  OUT: Diagnosis[][]
  LEG: LegacyResult[][]
  TRAIN: Record<VarKey, { m: number; sd: number }>[]
}

export function runEngine(faultsIn: Fault[]): EngineResult {
  const faults: Fault[] = faultsIn.map((f) => ({ ...f }))
  // ---------- simulate ----------
  const TRUE: Truth[][] = [], RAW: (Obs | null)[][] = [], TRUTH: number[][][] = []
  for (let k = 0; k < STEPS; k++) {
    const tr: Truth[] = [], rw: (Obs | null)[] = [], tt: number[][] = []
    for (let i = 0; i < N; i++) {
      const t = truth(i, k); tr.push(t)
      const o: Obs = { T: t.T, RH: t.RH, P: t.P, W: t.W, S: t.S, R: t.R, V: t.V, C: t.C }
      const man: number[] = []
      let missing = false
      faults.forEach((f, fi) => {
        if (stationIndex(f.st) !== i || k < f.k0) return
        if (f.type === 'drift') { o.RH += 0.12 * (k - f.k0); if (0.12 * (k - f.k0) > 3) man.push(fi) }
        if (f.type === 'flatline') { if (k === f.k0) f.val = o.T; o.T = f.val ?? o.T; if (k > f.k0 + 1) man.push(fi) }
        if (f.type === 'spike' && f.steps?.includes(k)) { o.T += k % 2 ? 11 : -9; man.push(fi) }
        if (f.type === 'blockage') { o.R = 0; if (t.R > 0.3) man.push(fi) }
        if (f.type === 'bearing') {
          // anemometer bearing wear: cups under-read, then stall in light wind
          const fac = Math.max(0.5, 1 - 0.004 * (k - f.k0))
          o.W = t.W < 1.2 + 3 * (1 - fac) ? 0 : o.W * fac
          if (fac < 0.9) man.push(fi)
        }
        if (f.type === 'soiling') { o.S *= 0.86; if (t.cs > 150) man.push(fi) }
      })
      faults.forEach((f, fi) => {
        if (stationIndex(f.st) !== i || k < f.k0 || f.type !== 'power') return
        o.V = Math.max(10.3, o.V - 0.028 * (k - f.k0))
        if (o.V < 11.6) { const b = 11.6 - o.V; o.T += b * 5; o.RH -= b * 9; o.P -= b * 4; man.push(fi) }
        if (o.V < 10.8) missing = true
      })
      rw.push(missing ? null : o); tt.push(man)
    }
    TRUE.push(tr); RAW.push(rw); TRUTH.push(tt)
  }

  // ---------- helpers ----------
  const tn = (v: number, i: number) => v + LAPSE * STATIONS[i].elev
  const psl = (v: number, i: number) => v * Math.exp(STATIONS[i].elev / 8430)
  const own = (o: Obs, i: number, key: VarKey) => (key === 'T' ? tn(o.T, i) : key === 'P' ? psl(o.P, i) : o[key])
  const nbEst = (k: number, i: number, key: VarKey, ok: boolean[]) => {
    let sw = 0, sv = 0
    for (let j = 0; j < N; j++) {
      if (j === i || !ok[j]) continue
      const o = RAW[k][j]; if (!o) continue
      sw += W[i][j]; sv += W[i][j] * own(o, j, key)
    }
    return sw ? sv / sw : NaN
  }
  const allOk = STATIONS.map(() => true)

  // ---------- learn normal behaviour (first 9 h) ----------
  const acc = STATIONS.map(() => ({ T: [] as number[], RH: [] as number[], P: [] as number[], W: [] as number[] }))
  for (let k = 0; k < TRAIN_K; k++) for (let i = 0; i < N; i++) {
    const o = RAW[k][i]; if (!o) continue
    ;(['T', 'RH', 'P', 'W'] as VarKey[]).forEach((key) => { const e = nbEst(k, i, key, allOk); if (!isNaN(e)) acc[i][key].push(own(o, i, key) - e) })
  }
  const TRAIN = acc.map((t) => {
    const r = {} as Record<VarKey, { m: number; sd: number }>
    ;(Object.keys(t) as VarKey[]).forEach((key) => {
      // robust location/scale (median, 1.4826·MAD) so a fault inside the learning window can't hide itself
      const a = t[key], m = median(a)
      const sd = 1.4826 * median(a.map((y) => Math.abs(y - m)))
      r[key] = { m, sd: Math.max(sd, FLOOR[key]) }
    })
    return r
  })
  // PCA on standardised residual vectors → Mahalanobis-style multivariate score
  const X: number[][] = []
  for (let k = 0; k < TRAIN_K; k++) for (let i = 0; i < N; i++) {
    const o = RAW[k][i]; if (!o) continue
    const f = (['T', 'RH', 'P', 'W'] as VarKey[]).map((key) => (own(o, i, key) - nbEst(k, i, key, allOk) - TRAIN[i][key].m) / TRAIN[i][key].sd)
    f.push(Math.max(-4, Math.min(4, (o.R - rainFromDbz(TRUE[k][i].dbz) / 4) / 0.8)))
    X.push(f)
  }
  const mu = [0, 1, 2, 3, 4].map((c) => X.reduce((s, r) => s + r[c], 0) / X.length)
  const C = mu.map((_, a) => mu.map((_, b) => X.reduce((s, r) => s + (r[a] - mu[a]) * (r[b] - mu[b]), 0) / X.length))
  const PCA = jacobi(C)

  // regional convective activity (pauses slow drift/soiling learning during storms)
  const RQ: boolean[] = []
  for (let k = 0; k < STEPS; k++) {
    let m = 0
    for (let q = Math.max(0, k - 12); q <= k; q++) for (let j = 0; j < N; j++) m = Math.max(m, TRUE[q][j].dbz)
    RQ.push(m < 20)
  }
  // stricter quiet flag: no radar echo anywhere for 6 h (post-storm outflow biases wind and solar)
  const RQW: boolean[] = []
  for (let k = 0; k < STEPS; k++) {
    let m = 0
    for (let q = Math.max(0, k - 24); q <= k; q++) for (let j = 0; j < N; j++) m = Math.max(m, TRUE[q][j].dbz)
    RQW.push(m < 12)
  }

  // ---------- run pipeline ----------
  const OUT: Diagnosis[][] = [], LEG: LegacyResult[][] = []
  const st = STATIONS.map(() => ({ cp: 0, cn: 0, drift: false, blk: 0, soil: [] as number[], wind: [] as [number, number][], bearing: false }))
  type Bad = Record<VarKey | 'R', boolean>
  const none = (): Bad => ({ T: false, RH: false, P: false, W: false, R: false })
  let prevBad: Bad[] = STATIONS.map(none)
  let prevScore: number[] = STATIONS.map(() => 0) // ANOMALY needs two consecutive high scores

  for (let k = 0; k < STEPS; k++) {
    const row: Diagnosis[] = [], lrow: LegacyResult[] = [], bad: Bad[] = STATIONS.map(none)
    const scoreRow: number[] = STATIONS.map(() => 0)
    const rainAll = RAW[k].map((o) => (o ? o.R : null))
    for (let i = 0; i < N; i++) {
      const o = RAW[k][i], tr = TRUE[k][i], s = STATIONS[i]
      let maxDbz = tr.dbz
      for (let q = Math.max(0, k - 2); q < k; q++) maxDbz = Math.max(maxDbz, TRUE[q][i].dbz)
      const ctx = { dbz: tr.dbz, maxDbz, ctt: tr.ctt, radarR: rainFromDbz(tr.dbz) / 4, convective: maxDbz > 32 }

      // ---- legacy rule-based QC ----
      let leg = false, why = ''
      if (!o) { leg = true; why = 'Missing data' }
      else {
        if (o.T < -5 || o.T > 48 || o.RH > 100 || o.RH < 1) { leg = true; why = 'Range check failed' }
        const p = k > 0 ? RAW[k - 1][i] : null
        if (p) {
          if (Math.abs(o.T - p.T) > 3) { leg = true; why = `Step check: T changed ${(o.T - p.T).toFixed(1)} °C in 15 min` }
          else if (Math.abs(o.RH - p.RH) > 15) { leg = true; why = `Step check: RH changed ${(o.RH - p.RH).toFixed(0)}% in 15 min` }
          else if (Math.abs(o.W - p.W) > 8) { leg = true; why = `Step check: wind changed ${(o.W - p.W).toFixed(1)} m/s` }
        }
        if (!leg && k >= 16) {
          let same = true
          for (let q = k - 16; q < k; q++) { const r = RAW[q][i]; if (!r || Math.abs(r.T - o.T) > 1e-6) { same = false; break } }
          if (same) { leg = true; why = 'Persistence: T unchanged for 4 h' }
        }
      }
      lrow.push({ flag: leg, why })

      // ---- WeatherGuard ----
      const okOf = (key: VarKey) => prevBad.map((b) => !b[key])
      const eT = nbEst(k, i, 'T', okOf('T')), eRH = nbEst(k, i, 'RH', okOf('RH')), eP = nbEst(k, i, 'P', okOf('P')), eW = nbEst(k, i, 'W', okOf('W'))
      const tt = TRAIN[i]
      const exp = { T: eT - LAPSE * s.elev + tt.T.m, RH: eRH + tt.RH.m, P: (eP + tt.P.m) / Math.exp(s.elev / 8430), W: eW + tt.W.m, R: ctx.radarR }
      const res: Diagnosis = { cls: 'VALID', gates: [], z: {}, exp, ctx, clean: {}, warn: null, att: null, score: 0, dT: 0, edge: { burst: false, flags: [] } }

      // battery relative to network + its trend
      const vs: number[] = []
      for (let j = 0; j < N; j++) if (j !== i && RAW[k][j]) vs.push(RAW[k][j]!.V)
      const vMed = median(vs)
      let vSlope = 0
      if (k >= 12) {
        const xs: number[] = [], ys: number[] = []
        for (let q = k - 11; q <= k; q++) {
          const r = RAW[q][i]; if (!r) continue
          const vv: number[] = []
          for (let j = 0; j < N; j++) if (j !== i && RAW[q][j]) vv.push(RAW[q][j]!.V)
          xs.push(q); ys.push(r.V - median(vv))
        }
        if (xs.length > 4) {
          const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length
          let nu = 0, de = 0
          xs.forEach((x, j) => { nu += (x - mx) * (ys[j] - my); de += (x - mx) ** 2 })
          vSlope = nu / de
        }
      }

      if (!o) {
        res.cls = 'MISSING'
        res.gates = [g('E', 'Electrical', 'flag', 'No transmission. Battery fell below the 10.8 V logger cut-off.')]
        res.clean = { T: exp.T, RH: exp.RH, R: ctx.radarR }
        bad[i] = { T: true, RH: true, P: true, W: true, R: true }
        row.push(res); continue
      }
      res.z = {
        T: (own(o, i, 'T') - eT - tt.T.m) / tt.T.sd,
        RH: (o.RH - eRH - tt.RH.m) / tt.RH.sd,
        P: (psl(o.P, i) - eP - tt.P.m) / tt.P.sd,
        W: (o.W - eW - tt.W.m) / tt.W.sd,
      }
      const zT = res.z.T!, zRH = res.z.RH!, zW = res.z.W!
      const f5 = [zT, zRH, res.z.P!, zW, Math.max(-4, Math.min(4, (o.R - ctx.radarR) / 0.8))]
      let sc = 0
      for (let c = 0; c < 5; c++) { let pr = 0; for (let r = 0; r < 5; r++) pr += (f5[r] - mu[r]) * PCA.vecs[r][c]; sc += (pr * pr) / PCA.vals[c] }
      res.score = Math.sqrt(sc / 5)
      scoreRow[i] = res.score
      const Td = magnus(o.T, Math.min(o.RH, 100))
      const es = satVapour(o.T), eVap = (Math.max(o.RH, 0) / 100) * es

      // Tier-1 edge pre-filter: local-only checks the station RTU runs before transmitting
      const pv = k > 0 ? RAW[k - 1][i] : null
      const eflags: string[] = []
      if (o.T < -5 || o.T > 48 || o.RH > 100 || o.RH < 1) eflags.push('range')
      if (pv && Math.abs(o.T - pv.T) > 3) eflags.push('rate')
      if (o.V < 11.8) eflags.push('battery')
      if (o.C > 55) eflags.push('cabinet')
      const burst = o.R > 2 || o.W > 12 || !!(pv && (Math.abs(o.P - pv.P) > 1.0 || o.T - pv.T < -2))
      res.edge = { burst, flags: eflags }

      // Gate 1 – electrical
      const vRel = o.V - vMed
      if (o.V < 11.6) { res.cls = 'ELECTRICAL'; res.gates.push(g('E', 'Electrical', 'flag', `Battery ${o.V.toFixed(2)} V is below the 11.6 V ADC reference. All channels are biased and quarantined.`)) }
      else if (vSlope < -0.012 && vRel < -0.22) {
        const hrs = Math.max(0, (o.V - 11.6) / -vSlope / 4)
        res.warn = { kind: 'battery', hrs, slope: vSlope }
        res.gates.push(g('E', 'Electrical', 'warn', `Battery ${o.V.toFixed(2)} V, ${(-vRel).toFixed(2)} V below the network and falling ${(-vSlope * 4).toFixed(2)} V/h. Reaches 11.6 V in about ${hrs.toFixed(1)} h.`))
      } else res.gates.push(g('E', 'Electrical', 'pass', `Battery ${o.V.toFixed(2)} V, in line with the network (${vRel >= 0 ? '+' : ''}${vRel.toFixed(2)} V).`))

      // Gate 2 – physics
      const physBad = eVap > 1.005 * es || o.RH < 1 || o.T < -5 || o.T > 48 || o.S > 1.15 * tr.cs + 60
      if (res.cls === 'VALID' && physBad) {
        res.cls = 'PHYSICS'
        res.gates.push(g('P', 'Physics', 'flag', eVap > 1.005 * es ? `Vapour pressure ${eVap.toFixed(1)} hPa exceeds saturation ${es.toFixed(1)} hPa at ${o.T.toFixed(1)} °C (Clausius–Clapeyron). RH ${o.RH.toFixed(1)}% is impossible.` : 'Reading outside physical bounds.'))
      } else res.gates.push(g('P', 'Physics', res.cls === 'ELECTRICAL' ? 'skip' : 'pass', `Vapour pressure ${eVap.toFixed(1)} ≤ saturation ${es.toFixed(1)} hPa (Clausius–Clapeyron); dew point ${Td.toFixed(1)} °C ≤ air ${o.T.toFixed(1)} °C (Magnus–Tetens). Solar ${o.S.toFixed(0)} ≤ clear-sky ${tr.cs.toFixed(0)} W/m².`))

      // Gate 3 – temporal
      let flat = false, flatRg = 1, flatNb = 0
      if (k >= 6) {
        const own6: number[] = [], nbr: number[] = []
        for (let q = k - 5; q <= k; q++) { const r = RAW[q][i]; if (r) own6.push(r.T) }
        for (let j = 0; j < N; j++) {
          if (j === i) continue
          const a: number[] = []
          for (let q = k - 5; q <= k; q++) { const r = RAW[q][j]; if (r) a.push(r.T) }
          if (a.length > 3) nbr.push(Math.max(...a) - Math.min(...a))
        }
        flatRg = own6.length > 5 ? Math.max(...own6) - Math.min(...own6) : 1
        flatNb = median(nbr)
        flat = flatRg < 0.02 && flatNb > 0.15
      }
      const prev = k > 0 ? RAW[k - 1][i] : null
      const dT = prev ? o.T - prev.T : 0
      res.dT = dT
      if (res.cls === 'VALID' && flat) { res.cls = 'FLATLINE'; res.gates.push(g('T', 'Temporal', 'flag', `Temperature identical for 90 min (range ${flatRg.toFixed(2)} °C) while neighbours moved ${flatNb.toFixed(1)} °C.`)) }
      else if (res.cls === 'VALID' && Math.abs(zT) > 5 && Math.abs(dT) > 4 && !ctx.convective) { res.cls = 'SPIKE'; res.gates.push(g('T', 'Temporal', 'flag', `Jump of ${dT > 0 ? '+' : ''}${dT.toFixed(1)} °C in 15 min with no radar echo and no neighbour support (z = ${zT.toFixed(1)}).`)) }
      else res.gates.push(g('T', 'Temporal', res.cls !== 'VALID' ? 'skip' : 'pass', `15-min change ${dT >= 0 ? '+' : ''}${dT.toFixed(1)} °C. No flatline or isolated spike.`))

      // Gate 4 – radar & satellite cross-check
      const nbRain = median(rainAll.filter((v, j) => j !== i && v != null) as number[])
      if (o.R < 0.1 && ctx.radarR > 1.0 && (nbRain > 0.4 || ctx.dbz > 35)) st[i].blk++
      else st[i].blk = 0
      if (res.cls === 'VALID' && st[i].blk >= 2) { res.cls = 'BLOCKAGE'; res.gates.push(g('R', 'Radar & satellite', 'flag', `Gauge reports 0.0 mm but radar shows ${ctx.dbz.toFixed(0)} dBZ ≈ ${ctx.radarR.toFixed(1)} mm/15 min and neighbours are raining.`)) }
      else if (res.cls === 'VALID' && ctx.convective && (Math.abs(zT) > 2.5 || Math.abs(zW) > 2.5 || Math.abs(dT) > 2 || o.R > 3 || Math.abs(zRH) > 2.5)) {
        res.cls = 'SEVERE'
        res.gates.push(g('R', 'Radar & satellite', 'severe', `Explained by real weather: radar ${ctx.maxDbz.toFixed(0)} dBZ, INSAT cloud-top ${ctx.ctt.toFixed(0)} °C, gauge ${o.R.toFixed(1)} mm vs radar ${ctx.radarR.toFixed(1)} mm.`))
      } else res.gates.push(g('R', 'Radar & satellite', res.cls !== 'VALID' ? 'skip' : 'pass', `Radar ${ctx.dbz.toFixed(0)} dBZ ≈ ${ctx.radarR.toFixed(1)} mm; gauge ${o.R.toFixed(1)} mm. Consistent.`))

      // Gate 5 – spatial buddy check (lapse-rate normalised) + CUSUM drift + solar consistency
      if (RQ[k] && res.cls !== 'ELECTRICAL') { st[i].cp = Math.max(0, st[i].cp + zRH - 0.8); st[i].cn = Math.max(0, st[i].cn - zRH - 0.8) }
      if (st[i].cp > 12 || st[i].cn > 12) st[i].drift = true
      else if (st[i].cp < 4 && st[i].cn < 4) st[i].drift = false
      const cus = Math.max(st[i].cp, st[i].cn)
      if (res.cls === 'VALID' && st[i].drift) { res.cls = 'DRIFT'; res.gates.push(g('S', 'Spatial & drift', 'flag', `RH reads ${o.RH - exp.RH >= 0 ? '+' : ''}${(o.RH - exp.RH).toFixed(1)}% vs terrain-corrected neighbours. CUSUM ${cus.toFixed(0)} > 12 means sustained one-sided drift.`)) }
      else if (res.cls === 'VALID' && res.score > 6.5 && prevScore[i] > 6.5 && RQ[k]) { res.cls = 'ANOMALY'; res.gates.push(g('S', 'Spatial & drift', 'flag', `Joint residual pattern unlike normal behaviour (score ${res.score.toFixed(1)}). Sent for forecaster review.`)) }
      else res.gates.push(g('S', 'Spatial & drift', res.cls !== 'VALID' && res.cls !== 'SEVERE' ? 'skip' : 'pass', `T ${zT >= 0 ? '+' : ''}${zT.toFixed(1)}σ, RH ${zRH >= 0 ? '+' : ''}${zRH.toFixed(1)}σ vs lapse-rate-normalised neighbours. CUSUM ${cus.toFixed(1)}.`))

      if (tr.cs > 200) {
        const ki = o.S / tr.cs, nk: number[] = []
        for (let j = 0; j < N; j++) { if (j === i || !RAW[k][j]) continue; const cj = TRUE[k][j].cs; if (cj > 200) nk.push(RAW[k][j]!.S / cj) }
        const m = median(nk)
        if (m > 0.3 && RQW[k]) st[i].soil.push(ki / m)
        if (st[i].soil.length > 24) st[i].soil.shift()
      }
      if (st[i].soil.length >= 10) {
        const r = median(st[i].soil); res.att = 1 - r
        if (res.cls === 'VALID' && r < 0.875 && tr.cs > 150) { res.cls = 'SOILING'; res.gates.push(g('S', 'Solar consistency', 'flag', `Pyranometer reads ${(100 * (1 - r)).toFixed(0)}% below neighbours' clear-sky index over ${st[i].soil.length} daylight samples.`)) }
      }

      // mechanical decay: anemometer bearing wear (wind under-reads vs neighbours, trending down)
      if (RQW[k] && exp.W > 2.0 && res.cls !== 'ELECTRICAL') {
        st[i].wind.push([o.W, exp.W])
        if (st[i].wind.length > 32) st[i].wind.shift()
      }
      const wb = st[i].wind
      if (wb.length >= 16) {
        const ratio = wb.reduce((a, [x, y]) => a + x * y, 0) / wb.reduce((a, [, y]) => a + y * y, 0)
        const wr = wb.map(([x, y]) => x / y), n_ = wr.length, mx = (n_ - 1) / 2, my = wr.reduce((a, b) => a + b, 0) / n_
        let nu = 0, de = 0
        wr.forEach((y, x) => { nu += (x - mx) * (y - my); de += (x - mx) ** 2 })
        const slope = nu / de
        if (ratio < 0.76) st[i].bearing = true
        else if (ratio > 0.86) st[i].bearing = false
        if (res.cls === 'VALID' && st[i].bearing) {
          res.cls = 'BEARING'
          res.gates.push(g('S', 'Mechanical decay', 'flag', `Anemometer reads ${(100 * (1 - ratio)).toFixed(0)}% below terrain-corrected neighbours and falling. Bearing friction; cups under-read and stall in light wind.`))
        } else if (res.cls === 'VALID' && res.warn === null && slope < -0.005 && ratio < 0.88) {
          const hrs = Math.max(0, (ratio - 0.76) / -slope / 4)
          res.warn = { kind: 'bearing', hrs, slope }
          res.gates.push(g('S', 'Mechanical decay', 'warn', `Wind ratio vs neighbours ${ratio.toFixed(2)} and falling ${(-slope * 4 * 100).toFixed(1)}%/h. Bearing will cross the 24% tolerance in about ${hrs.toFixed(0)} h.`))
        }
      }

      const tBad = ['ELECTRICAL', 'FLATLINE', 'SPIKE', 'PHYSICS'].includes(res.cls)
      const rhBad = ['ELECTRICAL', 'DRIFT', 'PHYSICS'].includes(res.cls)
      res.clean = {
        T: tBad ? exp.T : o.T,
        RH: rhBad ? Math.min(100, exp.RH) : o.RH,
        R: res.cls === 'BLOCKAGE' ? ctx.radarR : o.R,
        S: res.cls === 'SOILING' && res.att ? o.S / (1 - res.att) : o.S,
        W: res.cls === 'BEARING' || res.cls === 'ELECTRICAL' ? exp.W : o.W,
      }
      bad[i] = { T: tBad, RH: rhBad, P: res.cls === 'ELECTRICAL', W: res.cls === 'ELECTRICAL' || res.cls === 'BEARING', R: res.cls === 'BLOCKAGE' }
      row.push(res)
    }
    prevBad = bad; prevScore = scoreRow; OUT.push(row); LEG.push(lrow)
  }
  return { faults, TRUE, RAW, TRUTH, OUT, LEG, TRAIN }
}

// ---------------- evaluation ----------------
export interface Confusion { tp: number; fp: number; fn: number; rec: number | null; prec: number | null }
export interface Metrics { wg: Confusion; lg: Confusion; obs: number; storm: number; stormLeg: number; stormWg: number; raw: number }

export function metrics(E: EngineResult, K: number): Metrics {
  const wg = { tp: 0, fp: 0, fn: 0 }, lg = { tp: 0, fp: 0, fn: 0 }
  let obs = 0, storm = 0, stormLeg = 0, stormWg = 0, raw = 0
  for (let k = 0; k <= K; k++) for (let i = 0; i < N; i++) {
    const t = E.TRUTH[k][i].length > 0, w = isFault(E.OUT[k][i].cls), l = E.LEG[k][i].flag
    obs++
    if (E.RAW[k][i]) raw++
    if (t) { w ? wg.tp++ : wg.fn++; l ? lg.tp++ : lg.fn++ }
    else { if (w) wg.fp++; if (l) lg.fp++ }
    if (!t && E.TRUE[k][i].stormy) { storm++; if (l) stormLeg++; if (w) stormWg++ }
  }
  const f = (x: { tp: number; fp: number; fn: number }): Confusion => ({ ...x, rec: x.tp + x.fn ? x.tp / (x.tp + x.fn) : null, prec: x.tp + x.fp ? x.tp / (x.tp + x.fp) : null })
  return { wg: f(wg), lg: f(lg), obs, storm, stormLeg, stormWg, raw }
}

export interface Latency { fault: Fault; fi: number; i: number; onset: number; wg: number; lg: number; predictive: number }
export function latencies(E: EngineResult, K: number): Latency[] {
  return E.faults.map((f, fi) => {
    const i = stationIndex(f.st)
    let onset = -1, wg = -1, lg = -1, predictive = -1
    for (let k = f.k0; k <= K; k++) {
      const man = E.TRUTH[k][i].includes(fi)
      if (man && onset < 0) onset = k
      if (f.type === 'power' && predictive < 0 && E.OUT[k][i].warn) predictive = k
      if (onset >= 0 && wg < 0 && FAULT_CLASSES[f.type].includes(E.OUT[k][i].cls)) wg = k
      if (onset >= 0 && lg < 0 && man && E.LEG[k][i].flag) lg = k
    }
    return { fault: f, fi, i, onset, wg, lg, predictive }
  })
}

export interface WgEvent { k: number; i: number; cls: Cls | 'WARN'; d: Diagnosis }
export function events(E: EngineResult, K: number): WgEvent[] {
  const ev: WgEvent[] = []
  for (let i = 0; i < N; i++) {
    let prev: Cls = 'VALID', pw = false
    for (let k = 0; k <= K; k++) {
      const d = E.OUT[k][i]
      if (d.cls !== prev && d.cls !== 'VALID') ev.push({ k, i, cls: d.cls, d })
      if (!pw && d.warn) { ev.push({ k, i, cls: 'WARN', d }); pw = true }
      prev = d.cls
    }
  }
  return ev.sort((a, b) => b.k - a.k)
}
