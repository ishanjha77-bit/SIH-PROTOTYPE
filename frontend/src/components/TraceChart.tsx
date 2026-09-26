import { scaleLinear } from 'd3-scale'
import { useLayoutEffect, useRef, useState } from 'react'
import { isFault } from '../engine/engine'
import { TONE, clock, dayOf, statusOf } from '../lib/present'
import { useConsole } from '../state/console'



type Series = (number | null)[]
function path(ks: number[], vals: Series, x: (k: number) => number, y: (v: number) => number) {
  let d = '', pen = false
  ks.forEach((k, j) => {
    const v = vals[j]
    if (v == null || isNaN(v)) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

/** Track the rendered width so the chart lays out for the space it has instead of scaling down. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(960)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    setW(Math.round(el.clientWidth)) // before first paint, so phones never see the desktop layout
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function TraceChart() {
  const { engine: E, k: K, sel: i } = useConsole()
  const [box, width] = useWidth<HTMLDivElement>()
  const narrow = width < 560
  // On phones, ribbon labels move above their bars so the plot keeps the full width.
  const VW = Math.max(300, width), L = narrow ? 34 : 96, R = VW - 8, WD = R - L
  const RIB = narrow ? 22 : 16, TOP = narrow ? 70 : 58
  const k1 = Math.max(K, 95), k0 = k1 - 95
  const x = (k: number) => L + ((k - k0) / 95) * WD
  const ks: number[] = []
  for (let k = k0; k <= Math.min(K, k1); k++) ks.push(k)
  const raw = (key: 'T' | 'RH' | 'R' | 'V') => ks.map((k) => E.RAW[k][i]?.[key] ?? null)

  const off = TOP - 58
  const lanes = [
    { key: 'T' as const, label: 'Air temperature', unit: '°C', y: 74 + off, h: 104 },
    { key: 'RH' as const, label: 'Relative humidity', unit: '%', y: 212 + off, h: 84 },
    { key: 'R' as const, label: 'Rain', unit: 'mm / 15 min', y: 330 + off, h: 64 },
    { key: 'V' as const, label: 'Battery', unit: 'V', y: 428 + off, h: 50 },
  ]
  const H = 512 + off, AXIS = 484 + off
  const tickEvery = narrow ? 32 : 16
  const ribbons: [string, (k: number) => string | null][] = [
    ['Ground truth', (k) => (E.TRUTH[k][i].length ? 'var(--ink-2)' : null)],
    ['Legacy QC', (k) => (E.LEG[k][i].flag ? (E.TRUTH[k][i].length ? 'var(--muted)' : 'var(--fault)') : null)],
    ['WeatherGuard', (k) => { const d = E.OUT[k][i]; return d.cls === 'VALID' && !d.warn ? null : TONE[statusOf(d).tone].hex }],
  ]
  const cw = WD / 96

  return (
    <div ref={box} className="w-full">
      <svg viewBox={`0 0 ${VW} ${H}`} width={VW} height={H} className="block h-auto w-full" role="img" aria-label="24-hour sensor trace with flags">
        {ribbons.map(([name, fn], ri) => {
          const y = (narrow ? 12 : 4) + ri * RIB
          return (
            <g key={name}>
              {narrow
                ? <text x={L} y={y - 3} fontSize="10" style={{ fill: 'var(--muted)' }}>{name}</text>
                : <text x={L - 10} y={y + 9} textAnchor="end" fontSize="10.5" style={{ fill: 'var(--muted)' }}>{name}</text>}
              <rect x={L} y={y} width={WD} height={10} rx="1" style={{ fill: 'var(--sunken)' }} />
              {ks.map((k) => { const c = fn(k); return c ? <rect key={k} x={x(k) - cw / 2} y={y} width={cw + 0.4} height={10} style={{ fill: c }} /> : null })}
            </g>
          )
        })}
        {Array.from({ length: 96 }, (_, j) => k0 + j).filter((k) => k % tickEvery === 0).map((k) => (
          <g key={k}>
            <line x1={x(k)} x2={x(k)} y1={TOP} y2={AXIS} style={{ stroke: 'var(--line)' }} />
            <text x={x(k)} y={AXIS + 18} textAnchor="middle" fontSize="10.5" fontFamily="Geist Mono, monospace" style={{ fill: 'var(--muted)' }}>{k % 96 === 0 ? `Day ${dayOf(k)}` : clock(k)}</text>
          </g>
        ))}
        {lanes.map((ln) => {
          const vals: number[] = []
          ks.forEach((k) => {
            const o = E.RAW[k][i], d = E.OUT[k][i]
            if (ln.key === 'T' || ln.key === 'RH') { if (o) vals.push(o[ln.key]); const sd = E.TRAIN[i][ln.key].sd; vals.push(d.exp[ln.key] + 2 * sd, d.exp[ln.key] - 2 * sd) }
            if (ln.key === 'R') { if (o) vals.push(o.R); vals.push(d.ctx.radarR) }
            if (ln.key === 'V' && o) vals.push(o.V)
          })
          let lo = Math.min(...vals), hi = Math.max(...vals)
          if (ln.key === 'R') { lo = 0; hi = Math.max(2, hi) }
          if (ln.key === 'V') { lo = Math.min(lo, 11.2); hi = Math.max(hi, 12.9) }
          if (hi - lo < 1e-6) hi = lo + 1
          const sc = scaleLinear().domain([lo, hi]).nice(4).range([ln.y + ln.h, ln.y])
          ;[lo, hi] = sc.domain() as [number, number]
          const y = (v: number) => sc(v)
          const ticks = sc.ticks(4).map((v) => +v.toFixed(2))
          return (
            <g key={ln.key}>
              <text x={L} y={ln.y - 8} fontSize="12" fontWeight="500" style={{ fill: 'var(--ink)' }}>{ln.label} <tspan style={{ fill: 'var(--muted)' }} fontWeight="400">{ln.unit}</tspan></text>
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={L} x2={R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)' }} strokeDasharray={Math.abs(v - lo) < 1e-9 ? '' : '2 4'} />
                  <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize={narrow ? 9.5 : 10.5} fontFamily="Geist Mono, monospace" style={{ fill: 'var(--muted)' }}>{v}</text>
                </g>
              ))}
              {(ln.key === 'T' || ln.key === 'RH') && (() => {
                const key = ln.key, sd = E.TRAIN[i][key].sd
                const up = ks.map((k) => `${x(k).toFixed(1)},${y(E.OUT[k][i].exp[key] + 2 * sd).toFixed(1)}`)
                const dn = ks.map((k) => `${x(k).toFixed(1)},${y(E.OUT[k][i].exp[key] - 2 * sd).toFixed(1)}`).reverse()
                const cleanVals = ks.map((k) => {
                  const o = E.RAW[k][i], c = E.OUT[k][i].clean[key]
                  return c != null && (!o || Math.abs(c - o[key]) > 0.05) ? c : null
                })
                return (
                  <>
                    <polygon points={[...up, ...dn].join(' ')} style={{ fill: 'var(--ink)' }} opacity=".07" />
                    <path d={path(ks, ks.map((k) => E.OUT[k][i].exp[key]), x, y)} fill="none" style={{ stroke: 'var(--muted)' }} strokeWidth="1.2" strokeDasharray="3 4" />
                    <path d={path(ks, raw(key), x, y)} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.4" strokeLinejoin="round" />
                    <path d={path(ks, cleanVals, x, y)} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.8" strokeDasharray="5 3" />
                    {ks.map((k) => {
                      const d = E.OUT[k][i], o = E.RAW[k][i]
                      const hit = o && isFault(d.cls) && ((key === 'T' && ['FLATLINE', 'SPIKE', 'ELECTRICAL'].includes(d.cls)) || (key === 'RH' && ['DRIFT', 'ELECTRICAL'].includes(d.cls)))
                      return hit ? <circle key={k} cx={x(k)} cy={y(o![key])} r="2.8" style={{ fill: TONE[statusOf(d).tone].hex }} /> : null
                    })}
                  </>
                )
              })()}
              {ln.key === 'R' && (
                <>
                  {ks.map((k) => { const o = E.RAW[k][i]; return o && o.R > 0.02 ? <rect key={k} x={x(k) - cw * 0.35} y={y(o.R)} width={cw * 0.7} height={y(lo) - y(o.R)} rx="1.5" style={{ fill: 'var(--ink-2)' }} opacity=".45" /> : null })}
                  <path d={path(ks, ks.map((k) => E.OUT[k][i].ctx.radarR), x, y)} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="1.4" />
                  {!narrow && <text x={R} y={ln.y - 8} textAnchor="end" fontSize="10.5" style={{ fill: 'var(--muted)' }}>bars: gauge · line: radar estimate</text>}
                </>
              )}
              {ln.key === 'V' && (
                <>
                  <rect x={L} y={y(11.6)} width={WD} height={Math.max(0, y(lo) - y(11.6))} style={{ fill: 'var(--power)' }} opacity=".08" />
                  <line x1={L} x2={R} y1={y(11.6)} y2={y(11.6)} style={{ stroke: 'var(--power)' }} strokeDasharray="3 3" />
                  <path d={path(ks, raw('V'), x, y)} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.4" />
                </>
              )}
            </g>
          )
        })}
        <line x1={x(K)} x2={x(K)} y1={2} y2={AXIS} style={{ stroke: 'var(--accent)' }} strokeWidth="1.4" strokeDasharray="2 3" />
      </svg>
    </div>
  )
}
