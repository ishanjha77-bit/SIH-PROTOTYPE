import { useCallback, useEffect, useRef, useState } from 'react'
import { Mark } from '../components/Mark'
import { createIntro, type IntroHandle } from './engine'
import { intro, useIntro, type IntroVariant } from './store'

/** Film grain, generated once: a 128px tile of soft monochrome noise. */
let grainUrl: string | null = null
function grain() {
  if (grainUrl) return grainUrl
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!, img = g.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 18 }
  g.putImageData(img, 0, 0)
  return (grainUrl = c.toDataURL())
}

export function IntroSequence() {
  const { playing, variant, run } = useIntro()
  if (!playing) return null
  return <Overlay key={run} variant={variant} />
}

function Overlay({ variant }: { variant: IntroVariant }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const handle = useRef<IntroHandle | null>(null)
  const [text, setText] = useState<'idle' | 'in' | 'out'>('idle')
  const [revealed, setRevealed] = useState(false)
  const reduced = variant === 'reduced'

  useEffect(() => {
    if (reduced) {
      // Reduced motion: no particle movement, just the mark fading in and the app fading up.
      const ts = [
        window.setTimeout(() => setText('in'), 150),
        window.setTimeout(() => { setRevealed(true); intro.reveal() }, 900),
        window.setTimeout(() => setText('out'), 900),
        window.setTimeout(() => intro.done(), 1400),
      ]
      return () => ts.forEach(clearTimeout)
    }
    const mobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches
    const at = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('introAt')) || undefined : undefined
    handle.current = createIntro(canvas.current!, { mode: variant === 'short' ? 'short' : 'full', mobile, freezeAt: at }, {
      onText: (show) => setText(show ? 'in' : 'out'),
      onReveal: () => { setRevealed(true); intro.reveal() },
      onDone: () => intro.done(),
    })
    return () => handle.current?.destroy()
  }, [reduced, variant])

  const skip = useCallback(() => {
    if (reduced) { setRevealed(true); intro.reveal(); intro.done(); return }
    handle.current?.skip()
    setText((t) => (t === 'in' ? 'out' : t))
  }, [reduced])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Shift' || e.metaKey || e.ctrlKey || e.altKey) return
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [skip])

  return (
    <div className={`intro-overlay fixed inset-0 z-[100] overflow-hidden${revealed ? ' pointer-events-none' : ''}`}
      onClick={skip} role="presentation">
      {reduced
        ? <div className={`absolute inset-0 bg-[#0d0d0e] transition-opacity duration-500 ${revealed ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true" />
        : <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />}

      {/* Atmosphere: grain + vignette, fading with the reveal */}
      <div aria-hidden="true" className={`intro-atmos pointer-events-none absolute inset-0 transition-opacity duration-1000 ${revealed ? 'opacity-0' : 'opacity-100'}`}
        style={{ backgroundImage: `radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,.55) 100%), url(${grain()})` }} />

      {/* The mark's centre sits exactly on the screen centre, where the network collapses:
          the core becomes the station, and the radar sweep turns once around it. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -mt-8 px-6">
        <div className={`intro-brand ${text} flex flex-col items-center text-center`}>
          <span className="text-[#ededec]"><Mark size={64} sweep /></span>
          <span className="mt-7 text-[44px] font-medium leading-none tracking-[-0.04em] text-[#ededec] sm:text-[60px]">WeatherGuard</span>
          <span className="mt-5 text-[13px] text-[#8a8a85] sm:text-[14px]">Quality control for automatic weather stations</span>
          <span className="mt-2 text-[16px] tracking-[-0.01em] text-[#b3b3ae] sm:text-[18px]">Tells a broken sensor from a real storm.</span>
        </div>
      </div>

      {!revealed && (
        <button type="button" onClick={(e) => { e.stopPropagation(); skip() }}
          className="intro-skip absolute bottom-[calc(env(safe-area-inset-bottom,0px)+24px)] right-6 rounded-md border border-white/15 px-3 py-1.5 text-[13px] text-white/60 transition-colors hover:border-white/35 hover:text-white">
          Skip intro <span className="ml-1.5 hidden text-white/35 [@media(hover:hover)]:inline">Esc</span>
        </button>
      )}
      <p className="sr-only" role="status">{revealed ? 'WeatherGuard is ready.' : 'WeatherGuard is starting.'}</p>
    </div>
  )
}
