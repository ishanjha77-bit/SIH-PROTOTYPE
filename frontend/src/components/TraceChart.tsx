import { scaleLinear } from 'd3-scale'
import { isFault } from '../engine/engine'
import { TONE, clock, dayOf, statusOf } from '../lib/present'
import { useConsole } from '../state/console'

const VW = 960, L = 96, R = 944, WD = R - L


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

export function TraceChart() {
  const { engine: E, k: K, sel: i } = useConsole()
  const k1 = Math.max(K, 95), k0 = k1 - 95
  const x = (k: number) => L + ((k - k0) / 95) * WD
  const ks: number[] = []
  for (let k = k0; k <= Math.min(K, k1); k++) ks.push(k)
  const raw = (key: 'T' | 'RH' | 'R' | 'V') => ks.map((k) => E.RAW[k][i]?.[key] ?? null)

  const lanes = [
    { key: 'T' as const, label: 'Air temperature', unit: '°C', y: 74, h: 104 },
    { key: 'RH' as const, label: 'Relative humidity', unit: '%', y: 212, h: 84 },
    { key: 'R' as const, label: 'Rain', unit: 'mm / 15 min', y: 330, h: 64 },
    { key: 'V' as const, label: 'Battery', unit: 'V', y: 428, h: 50 },
  ]
  const ribbons: [string, (k: number) => string | null][] = [
    ['Ground truth', (k) => (E.TRUTH[k][i].length ? 'var(--ink-2)' : null)],
    ['Legacy QC', (k) => (E.LEG[k][i].flag ? (E.TRUTH[k][i].length ? 'var(--muted)' : 'var(--fault)') : null)],
    ['WeatherGuard', (k) => { const d = E.OUT[k][i]; return d.cls === 'VALID' && !d.warn ? null : TONE[statusOf(d).tone].hex }],
  ]
  const cw = WD / 96

  return (
    <div className="scroll-soft overflow-x-auto">
      <svg viewBox={`0 0 ${VW} 512`} className="block h-auto w-full min-w-[660px]" role="img" aria-label="24-hour sensor trace with flags">
        {ribbons.map(([name, fn], ri) => {
          const y = 4 + ri * 16
          return (
            <g key={name}>
              <text x={L - 10} y={y + 9} textAnchor="end" fontSize="10.5" style={{ fill: 'var(--muted)' }}>{name}</text>
              <rect x={L} y={y} width={WD} height={10} rx="5" style={{ fill: 'var(--sunken)' }} />
              {ks.map((k) => { const c = fn(k); return c ? <rect key={k} x={x(k) - cw / 2} y={y} width={cw + 0.4} height={10} style={{ fill: c }} /> : null })}
            </g>
          )
        })}
        {Array.from({ length: 96 }, (_, j) => k0 + j).filter((k) => k % 16 === 0).map((k) => (
          <g key={k}>
            <line x1={x(k)} x2={x(k)} y1={58} y2={484} style={{ stroke: 'var(--line)' }} />
            <text x={x(k)} y={502} textAnchor="middle" fontSize="10.5" fontFamily="Geist Mono, monospace" style={{ fill: 'var(--muted)' }}>{k % 96 === 0 ? `Day ${dayOf(k)}` : clock(k)}</text>
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
              <text x={L} y={ln.y - 8} fontSize="11.5" fontWeight="500" style={{ fill: 'var(--ink-2)' }}>{ln.label} <tspan style={{ fill: 'var(--muted)' }} fontWeight="400">{ln.unit}</tspan></text>
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={L} x2={R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)' }} strokeDasharray={Math.abs(v - lo) < 1e-9 ? '' : '2 4'} />
                  <text x={L - 10} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fontFamily="Geist Mono, monospace" style={{ fill: 'var(--muted)' }}>{v}</text>
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
                    <polygon points={[...up, ...dn].join(' ')} style={{ fill: 'var(--accent)' }} opacity=".08" />
                    <path d={path(ks, ks.map((k) => E.OUT[k][i].exp[key]), x, y)} fill="none" style={{ stroke: 'var(--muted)' }} strokeWidth="1.2" strokeDasharray="3 4" />
                    <path d={path(ks, raw(key), x, y)} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="1.8" strokeLinejoin="round" />
                    <path d={path(ks, cleanVals, x, y)} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2.2" strokeDasharray="5 3" />
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
                  {ks.map((k) => { const o = E.RAW[k][i]; return o && o.R > 0.02 ? <rect key={k} x={x(k) - cw * 0.35} y={y(o.R)} width={cw * 0.7} height={y(lo) - y(o.R)} rx="1.5" style={{ fill: 'var(--accent)' }} opacity=".75" /> : null })}
                  <path d={path(ks, ks.map((k) => E.OUT[k][i].ctx.radarR), x, y)} fill="none" style={{ stroke: 'var(--storm)' }} strokeWidth="1.8" />
                  <text x={R} y={ln.y - 8} textAnchor="end" fontSize="10.5" style={{ fill: 'var(--muted)' }}>bars: gauge · line: radar estimate</text>
                </>
              )}
              {ln.key === 'V' && (
                <>
                  <rect x={L} y={y(11.6)} width={WD} height={Math.max(0, y(lo) - y(11.6))} style={{ fill: 'var(--power)' }} opacity=".08" />
                  <line x1={L} x2={R} y1={y(11.6)} y2={y(11.6)} style={{ stroke: 'var(--power)' }} strokeDasharray="3 3" />
                  <path d={path(ks, raw('V'), x, y)} fill="none" style={{ stroke: 'var(--warn)' }} strokeWidth="1.8" />
                </>
              )}
            </g>
          )
        })}
        <line x1={x(K)} x2={x(K)} y1={2} y2={484} style={{ stroke: 'var(--accent)' }} strokeWidth="1.4" strokeDasharray="2 3" />
      </svg>
    </div>
  )
}
