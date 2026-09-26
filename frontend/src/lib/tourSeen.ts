import { useSyncExternalStore } from 'react'

/** Whether this browser has started the guided tour. Until it has, the tour entry points invite a click. */
const KEY = 'wg-tour-seen'
let seen = (() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })()
const subs = new Set<() => void>()

export function markTourSeen() {
  if (seen) return
  seen = true
  try { localStorage.setItem(KEY, '1') } catch { /* storage blocked */ }
  subs.forEach((f) => f())
}

export function useTourSeen() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => seen)
}
