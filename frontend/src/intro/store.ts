import { useSyncExternalStore } from 'react'

/**
 * Whether the opening sequence is playing, and which version.
 * index.html decides before first paint (it adds `intro-hold` to <html>), so there is no flash of the app.
 *   full    every normal visit (skippable any time)
 *   short   landing on a deep link to an inner page
 *   reduced prefers-reduced-motion: a simple fade
 */
export type IntroVariant = 'full' | 'short' | 'reduced'
interface State { playing: boolean; variant: IntroVariant; run: number }

const root = typeof document !== 'undefined' ? document.documentElement : null

function initialVariant(): IntroVariant {
  if (typeof window === 'undefined') return 'full'
  // Explicit override, e.g. for a live demo on a machine with reduced motion on: ?intro=full|short|reduced
  const forced = new URLSearchParams(location.search).get('intro')
  if (forced === 'full' || forced === 'short' || forced === 'reduced') return forced
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced'
  const deep = location.hash.length > 1 && location.hash !== '#overview'
  return deep ? 'short' : 'full'
}

let state: State = { playing: !!root?.classList.contains('intro-hold'), variant: initialVariant(), run: 0 }
const subs = new Set<() => void>()
const set = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()) }

export const intro = {
  get: () => state,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },

  /** The app starts appearing underneath: release the hold and run the staggered reveal. */
  reveal() {
    if (!root || !root.classList.contains('intro-hold')) return
    root.classList.remove('intro-hold')
    root.classList.add('intro-reveal')
    window.dispatchEvent(new Event('wg:reveal'))
    window.setTimeout(() => root.classList.remove('intro-reveal'), 1800)
  },

  done() {
    set({ playing: false })
  },

  /** Replay the full sequence (e.g. for a live demo). */
  replay() {
    if (!root || state.playing) return
    root.classList.remove('intro-reveal')
    root.classList.add('intro-hold')
    window.scrollTo({ top: 0 })
    set({ playing: true, variant: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full', run: state.run + 1 })
  },
}

export function useIntro() {
  return useSyncExternalStore(intro.subscribe, intro.get)
}

/** True while the app is hidden under the intro (used to defer entrance animations until the reveal). */
export const introHolding = () => !!root?.classList.contains('intro-hold')
