import { useEffect, useRef } from 'react'
import { STATIONS, dbzFromRain, hash, isFault, stormAt } from '../engine/engine'
import { TONE, statusOf } from '../lib/present'
import { useConsole } from '../state/console'

const VW = 580, VH = 860
const PX = (lon: number) => 24 + (lon - 72.45) * 222
const PY = (lat: number) => 24 + (20.3 - lat) * 222

const COAST: [number, number][] = [[72.62, 20.35], [72.7, 19.95], [72.78, 19.55], [72.8, 19.2], [72.82, 18.95], [72.88, 18.7], [72.93, 18.35], [73.05, 18.0], [73.12, 17.7], [73.22, 17.3], [73.28, 17.0], [73.35, 16.7], [73.45, 16.4], [73.52, 16.1]]
const GHATS: [number, number][] = [[73.55, 20.35], [73.55, 19.8], [73.45, 19.3], [73.4, 18.8], [73.55, 18.3], [73.66, 17.9], [73.75, 17.4], [73.85, 16.9], [73.92, 16.2]]
const pts = (a: [number, number][]) => a.map(([x, y]) => `${PX(x).toFixed(1)},${PY(y).toFixed(1)}`).join(' ')

// Conventional radar reflectivity ramp (what forecasters expect): green → yellow → orange → red → magenta.
const STOPS: [number, number[]][] = [
  [18, [60, 190, 140, 0]], [24, [60, 190, 140, 35]], [30, [70, 190, 90, 80]], [36, [150, 205, 60, 150]],
  [42, [240, 210, 60, 205]], [48, [245, 150, 50, 220]], [54, [235, 70, 60, 230]], [60, [200, 60, 170, 235]],
]
function ramp(z: number) {
  if (z < STOPS[0][0]) return null
  for (let s = 1; s < STOPS.length; s++) if (z <= STOPS[s][0]) {
    const [z0, c0] = STOPS[s - 1], [z1, c1] = STOPS[s], t = (z - z0) / (z1 - z0)
    return c0.map((v, j) => v + (c1[j] - v) * t)
  }
  return STOPS[STOPS.length - 1][1]
}

/** Smooth value noise in [0, 1). Visual texture only; never feeds the simulation. */
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * Paint simulated Doppler reflectivity into a canvas; row/col → lat/lon mappers define the projection.
 * The squall model is a straight N–S line, so the render adds convective-cell texture that travels
 * with the storm and a few km of along-line waviness. Station verdicts still use the exact model.
 */
export function drawRadar(cv: HTMLCanvasElement, k: number, latOf: (y: number, h: number) => number, lonOf: (x: number, w: number) => number) {
  const ctx = cv.getContext('2d'); if (!ctx) return
  const w = cv.width, h = cv.height, img = ctx.createImageData(w, h)
  const drift = 0.055 * k // storm speed in °lon per step, so cells move with the line
  for (let y = 0; y < h; y++) {
    const lat = latOf(y, h)
    const wobble = 0.035 * Math.sin(lat * 4.2 + k * 0.05) + 0.02 * (vnoise(lat * 6, 0.5, 7) - 0.5)
    for (let x = 0; x < w; x++) {
      const lon = lonOf(x, w)
      const sw = stormAt(lon + wobble, lat, k); if (sw.rain < 0.25) continue
      const tx = (lon - drift) * 11, ty = lat * 11
      const n = 0.65 * vnoise(tx, ty, 3) + 0.35 * vnoise(tx * 2.3, ty * 2.3, 5)
      // Stratiform rain behind the line breaks into patches; the convective core stays mostly solid.
      const cells = sw.conv > 0.3 ? 0.6 + 0.7 * n : Math.max(0, 1.9 * n - 0.55)
      const c = ramp(dbzFromRain(sw.rain * cells)); if (!c) continue
      const p = (y * w + x) * 4
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = c[3]
    }
  }
  ctx.putImageData(img, 0, 0)
}

export function NetworkMap() {
  const { engine, k, sel, select } = useConsole()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvas.current; if (!cv) return
    drawRadar(cv, k, (y, h) => 20.3 - (((y + 0.5) * VH) / h - 24) / 222, (x, w) => 72.45 + (((x + 0.5) * VW) / w - 24) / 222)
  }, [k])

  return (
    <div className="relative mx-auto w-full max-w-[460px]" style={{ aspectRatio: `${VW}/${VH}` }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        <rect width={VW} height={VH} rx="22" style={{ fill: 'var(--land)' }} />
        <polygon points={`0,0 ${PX(72.62)},0 ${pts(COAST)} ${PX(73.52)},${VH} 0,${VH}`} style={{ fill: 'var(--sea)' }} />
        <polyline points={pts(COAST)} fill="none" style={{ stroke: 'var(--line-strong)' }} strokeWidth="1.2" />
        <polyline points={pts(GHATS)} fill="none" style={{ stroke: 'var(--line-strong)' }} strokeWidth="1.4" strokeDasharray="1 7" strokeLinecap="round" />
        {[17, 18, 19, 20].map((lat) => (
          <g key={lat}>
            <line x1="0" x2={VW} y1={PY(lat)} y2={PY(lat)} style={{ stroke: 'var(--line)' }} strokeDasharray="2 6" />
            <text x={VW - 12} y={PY(lat) - 5} textAnchor="end" fontSize="10" style={{ fill: 'var(--muted)' }} fontFamily="Geist Mono, monospace">{lat}°N</text>
          </g>
        ))}
        <text x={32} y={PY(17.7)} fontSize="12" letterSpacing="4" style={{ fill: 'var(--muted)' }} opacity=".7">ARABIAN SEA</text>
        <text x={PX(73.98)} y={PY(16.5)} fontSize="9.5" letterSpacing="2.5" style={{ fill: 'var(--muted)' }} opacity=".75" transform={`rotate(-74 ${PX(73.98)} ${PY(16.5)})`}>WESTERN GHATS</text>
      </svg>
      <div className="absolute inset-0 overflow-hidden rounded-[22px]">
        <canvas ref={canvas} width={232} height={344} className="h-full w-full" style={{ opacity: 0.85, filter: 'blur(1.5px)' }} />
      </div>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Station map with live radar">
        {STATIONS.map((s, i) => {
          const d = engine.OUT[k][i], st = statusOf(d), x = PX(s.lon), y = PY(s.lat)
          const left = s.lon > 74.1 || s.id === 'nashik'
          const legacyFalse = engine.LEG[k][i].flag && !isFault(d.cls)
          return (
            <g key={s.id} role="button" tabIndex={0} aria-label={`${s.name}: ${st.label}`} className="cursor-pointer outline-none"
              onClick={() => select(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i) } }}>
              {i === sel && <circle cx={x} cy={y} r="17" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" opacity=".9" />}
              {legacyFalse && <circle cx={x} cy={y} r="12" fill="none" style={{ stroke: 'var(--fault)' }} strokeWidth="1.3" strokeDasharray="2 2.5" />}
              <circle cx={x} cy={y} r="8" style={{ fill: TONE[st.tone].hex, stroke: 'var(--surface)' }} strokeWidth="3" />
              <text x={left ? x - 16 : x + 16} y={y + 4} textAnchor={left ? 'end' : 'start'} fontSize="13" fontWeight="500"
                style={{ fill: 'var(--ink)', stroke: 'var(--land)', paintOrder: 'stroke' }} strokeWidth="4" strokeLinejoin="round">{s.name.split(' ')[0]}</text>
              <text x={left ? x - 16 : x + 16} y={y + 18} textAnchor={left ? 'end' : 'start'} fontSize="10.5" fontFamily="Geist Mono, monospace"
                style={{ fill: 'var(--muted)', stroke: 'var(--land)', paintOrder: 'stroke' }} strokeWidth="3">{s.elev} m</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function MapLegend() {
  const items: [string, string][] = [['Valid', 'var(--ok)'], ['Severe weather', 'var(--storm)'], ['Sensor fault', 'var(--fault)'], ['Power', 'var(--power)'], ['Warning', 'var(--warn)']]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-2">
      {items.map(([l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-dashed" style={{ borderColor: 'var(--fault)' }} />Legacy false alarm</span>
      <span className="inline-flex items-center gap-2"><span className="h-1.5 w-16 rounded-full" style={{ background: 'linear-gradient(90deg,rgb(60 190 140/.5),rgb(70 190 90),rgb(240 210 60),rgb(245 150 50),rgb(235 70 60),rgb(200 60 170))' }} />Radar 20–60 dBZ</span>
    </div>
  )
}
