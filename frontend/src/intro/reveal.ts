import type { CSSProperties } from 'react'

/** Marks an element for the staggered entrance after the intro; `d` is its delay in ms. */
export const reveal = (d: number) => ({ 'data-reveal': '', style: { '--d': d } as CSSProperties })
