import { useEffect, useRef, useState } from 'react'
import { introHolding } from './store'

/**
 * Renders `format(value)`. If it mounted under the intro, it counts up from 0 when the app is revealed,
 * then tracks `value` directly. Everywhere else it simply shows the value.
 */
export function CountUp({ value, format, delay = 0, duration = 750 }: { value: number; format: (v: number) => string; delay?: number; duration?: number }) {
  const [shown, setShown] = useState<number | null>(() =>
    introHolding() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : null)
  const target = useRef(value)
  target.current = value

  useEffect(() => {
    if (shown === null) return
    let raf = 0, t0 = 0, timer = 0
    const tick = (now: number) => {
      if (!t0) t0 = now
      const u = Math.min(1, (now - t0) / duration)
      const e = 1 - (1 - u) ** 3
      if (u < 1) { setShown(target.current * e); raf = requestAnimationFrame(tick) } else setShown(null)
    }
    const start = () => { timer = window.setTimeout(() => { raf = requestAnimationFrame(tick) }, delay) }
    window.addEventListener('wg:reveal', start, { once: true })
    return () => { window.removeEventListener('wg:reveal', start); clearTimeout(timer); cancelAnimationFrame(raf) }
    // run once: the count-up only happens for the reveal this component mounted under
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{format(shown ?? value)}</>
}
