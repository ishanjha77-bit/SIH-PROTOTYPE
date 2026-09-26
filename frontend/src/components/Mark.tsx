/**
 * The WeatherGuard mark: a radar scope. An outer ring (the coverage), a range ring, a sweep (the scan)
 * and a centre point (the station). The range ring is what makes it read as radar rather than a clock. Radar is how WeatherGuard tells a real storm from a broken sensor, so it is the one idea
 * the mark carries. Single colour (currentColor), pure geometry, legible from 16 px upward.
 */
const C = 12, R = 9.25

/** Wedge from 12 o'clock sweeping `deg` clockwise, as an SVG path. */
function wedge(deg: number, r = R - 2.4) {
  const a = (deg - 90) * (Math.PI / 180)
  const x = C + r * Math.cos(a), y = C + r * Math.sin(a)
  return `M${C} ${C}L${C} ${C - r}A${r} ${r} 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`
}

export function Mark({ size = 20, className, sweep = false }: { size?: number; className?: string; sweep?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx={C} cy={C} r={R} stroke="currentColor" strokeWidth="1.8" />
      <circle cx={C} cy={C} r="4.9" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
      {/* In the intro the sweep turns once (see .mark-sweep in index.css). */}
      <path d={wedge(62)} fill="currentColor" className={sweep ? 'mark-sweep' : undefined} style={sweep ? { transformOrigin: '12px 12px' } : undefined} />
      <circle cx={C} cy={C} r="1.35" fill="currentColor" />
    </svg>
  )
}
