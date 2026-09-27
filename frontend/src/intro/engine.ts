/*
 * Opening sequence renderer. Plain Canvas 2D: additive blending + pre-rendered glow sprites give bloom
 * without WebGL, and a small perspective projection gives real depth and parallax.
 *
 * Phases (full timeline, ms): wake → spark + network grows → data flows through it → network collapses
 * into a bright core with an energy ring (logo appears) → core bursts into particles that fly outward
 * while the background fades and the app is revealed underneath.
 */

export type IntroMode = 'full' | 'short'
export interface IntroOptions { mode: IntroMode; mobile: boolean; /** dev only: render the frame at this time and stop */ freezeAt?: number }
export interface IntroCallbacks { onText: (show: boolean) => void; onReveal: () => void; onDone: () => void }
export interface IntroHandle { skip: () => void; destroy: () => void }

interface Timeline {
  grow0: number; grow1: number; complex1: number; collapse0: number; collapse1: number
  ring: number; textIn: number; textOut: number; dissolve0: number; dissolve1: number; end: number
}
// Everything appears together at 0.3 s and stays still and readable for 6.5 s (until 6.8 s). The network grows
// behind the text as a dimmed backdrop; it only converges as part of the single final exit.
const FULL: Timeline = {
  grow0: 300, grow1: 3000, complex1: 4500, collapse0: 6850, collapse1: 7800,
  ring: 500, textIn: 300, textOut: 6800, dissolve0: 6850, dissolve1: 7800, end: 8150,
}
const SHORT: Timeline = {
  grow0: 0, grow1: 380, complex1: 650, collapse0: 650, collapse1: 1050,
  ring: 900, textIn: 700, textOut: 1950, dissolve0: 2000, dissolve1: 2650, end: 2850,
}

// Palette follows the app's dark theme: neutral black, near-white, the ink-blue accent for structure,
// storm violet only as a rare accent.
const BG = [13, 13, 14]
const CYAN = [147, 169, 255] // the accent (name kept for the renderer)
const VIOLET = [168, 152, 240]
const WHITE = [232, 234, 238]

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const easeOut = (x: number) => 1 - (1 - x) ** 3
const phase = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Seeded RNG so the structure is the same on every load (it should feel designed, not random). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function sprite(rgb: number[], size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')!, r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, `rgba(${rgb},1)`)
  grad.addColorStop(0.18, `rgba(${rgb},0.55)`)
  grad.addColorStop(0.45, `rgba(${rgb},0.12)`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grad; g.fillRect(0, 0, size, size)
  return c
}

interface V3 { x: number; y: number; z: number }
interface Node { p: V3; t0: number; parent: number; phase: number; size: number; hue: 0 | 1 | 2 }
interface Edge { a: number; b: number; tree: boolean; t0: number; heat: number; phase: number }
interface Packet { e: number; forward: boolean; t0: number; dur: number }
interface Dust { p: V3; v: V3; size: number; phase: number; hue: 0 | 1 | 2 }
interface Spark { x: number; y: number; vx: number; vy: number; size: number; a: number; hue: 0 | 1 | 2 }

export function createIntro(canvas: HTMLCanvasElement, opts: IntroOptions, cb: IntroCallbacks): IntroHandle {
  const ctx = canvas.getContext('2d')!
  const R = rng(20260715)
  const mobile = opts.mobile
  // Phones run the same timeline: the logo hold is a deliberate 10 s everywhere.
  const T = opts.mode === 'short' ? SHORT : FULL
  const N_NODES = mobile ? 42 : 84
  const N_DUST = mobile ? 90 : 220
  const N_SPARK = mobile ? 70 : 170
  const GLOW = mobile ? 0.75 : 1
  const SPR = [sprite(CYAN), sprite(VIOLET), sprite(WHITE)]

  // ---------- geometry ----------
  // Nodes cluster around a few seeds on a flattened shell, so the structure reads as organised intelligence
  // rather than a uniform ball.
  const seeds: V3[] = Array.from({ length: 7 }, () => {
    const u = R() * 2 - 1, th = R() * Math.PI * 2, r = 0.45 + R() * 0.35
    return { x: r * Math.sqrt(1 - u * u) * Math.cos(th), y: r * u * 0.6, z: r * Math.sqrt(1 - u * u) * Math.sin(th) }
  })
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += R(); return (s - 2) / 1.15 }
  const nodes: Node[] = [{ p: { x: 0, y: 0, z: 0 }, t0: T.grow0, parent: -1, phase: 0, size: 1.6, hue: 2 }]
  for (let i = 1; i < N_NODES; i++) {
    const s = seeds[i % seeds.length], sig = 0.2
    nodes.push({ p: { x: s.x + gauss() * sig, y: s.y + gauss() * sig * 0.7, z: s.z + gauss() * sig }, t0: 0, parent: -1,
      phase: R() * Math.PI * 2, size: 0.6 + R() * 0.9, hue: R() < 0.08 ? 1 : R() < 0.55 ? 0 : 2 })
  }
  const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const order = nodes.map((n, i) => [Math.hypot(n.p.x, n.p.y, n.p.z), i] as const).sort((a, b) => a[0] - b[0])
  const maxR = order[order.length - 1][0]
  const edges: Edge[] = []
  // Spanning tree grown outward from the centre: each node links to its nearest already-placed node.
  const placed: number[] = [0]
  for (const [r, i] of order) {
    if (i === 0) continue
    let best = 0, bd = Infinity
    for (const j of placed) { const d = dist(nodes[i].p, nodes[j].p); if (d < bd) { bd = d; best = j } }
    nodes[i].parent = best
    nodes[i].t0 = Math.max(nodes[best].t0 + 120, T.grow0 + (r / maxR) ** 0.85 * (T.grow1 - T.grow0 - 150))
    edges.push({ a: best, b: i, tree: true, t0: nodes[i].t0 - 260, heat: 0, phase: R() * 6.28 })
    placed.push(i)
  }
  // Cross links: appear as the network "thinks", some breathe in and out.
  for (let i = 1; i < N_NODES; i++) {
    const near = nodes.map((n, j) => [dist(nodes[i].p, n.p), j] as const).filter(([d, j]) => j !== i && j !== nodes[i].parent && d < 0.42).sort((a, b) => a[0] - b[0])
    for (const [, j] of near.slice(0, R() < 0.5 ? 1 : 2)) {
      if (edges.some((e) => (e.a === j && e.b === i) || (e.a === i && e.b === j))) continue
      edges.push({ a: i, b: j, tree: false, t0: lerp(T.grow1 - 200, T.complex1 - 300, R()), heat: 0, phase: R() * 6.28 })
    }
  }
  const dust: Dust[] = Array.from({ length: N_DUST }, () => ({
    p: { x: (R() * 2 - 1) * 3.2, y: (R() * 2 - 1) * 2.1, z: -1.6 + R() * 4.2 },
    v: { x: (R() - 0.5) * 0.00006, y: (R() - 0.5) * 0.00004, z: (R() - 0.5) * 0.00005 },
    size: 0.5 + R() ** 2 * 2, phase: R() * 6.28, hue: R() < 0.06 ? 1 : R() < 0.35 ? 0 : 2,
  }))
  const packets: Packet[] = []
  let sparks: Spark[] = []

  let last = performance.now(), dead = false
  const frozen = opts.freezeAt != null

  // ---------- viewport ----------
  let W = 0, H = 0, dpr = 1
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2)
    W = canvas.clientWidth; H = canvas.clientHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  // A resize clears the canvas; a frozen (dev) still has no next frame, so redraw it.
  const onResize = () => { resize(); if (frozen && !dead) frame(last + 16) }
  window.addEventListener('resize', onResize)

  // Pointer parallax: a few degrees at most, heavily smoothed.
  let px = 0, py = 0, tx = 0, ty = 0
  const onMove = (e: PointerEvent) => { tx = (e.clientX / W - 0.5) * 0.12; ty = (e.clientY / H - 0.5) * 0.08 }
  window.addEventListener('pointermove', onMove)

  const D = 3.2
  let yaw = 0, pitch = 0.32
  const out = { x: 0, y: 0, k: 0 }
  const project = (p: V3, shrink = 1, spin = 1) => {
    const cy = Math.cos(yaw * spin + px), sy = Math.sin(yaw * spin + px)
    const x = p.x * shrink * cy - p.z * shrink * sy, z = p.x * shrink * sy + p.z * shrink * cy, y = p.y * shrink
    const cp = Math.cos(pitch + py), sp = Math.sin(pitch + py)
    const y2 = y * cp - z * sp, z2 = y * sp + z * cp
    const f = Math.min(W, H) * (mobile ? 1.35 : 1.08)
    const s = f / (z2 + D)
    out.x = W / 2 + x * s; out.y = H / 2 + y2 * s; out.k = D / (z2 + D)
    return out
  }
  const glowAt = (x: number, y: number, size: number, alpha: number, hue: 0 | 1 | 2) => {
    if (alpha <= 0.004) return
    ctx.globalAlpha = alpha > 1 ? 1 : alpha
    ctx.drawImage(SPR[hue], x - size / 2, y - size / 2, size, size)
  }

  // ---------- clock (virtual, so skip can fast-forward smoothly) ----------
  let vt = 0, rate = 1, raf = 0
  let textShown = false, revealed = false, sparked = false, skipped = false
  const stats = { frames: 0, total: 0, worst: 0, deltas: [] as number[], work: [] as number[] }

  const frame = (now: number) => {
    if (dead) return
    const w0 = performance.now()
    // Wall-clock accurate down to ~5 fps, so a slow device drops frames instead of stretching the intro;
    // bigger gaps (tab switched away) are clamped so nothing jumps.
    const dt = Math.min(200, now - last); last = now
    if (stats.frames++ > 0) { stats.total += dt; stats.worst = Math.max(stats.worst, dt); if (stats.deltas.length < 600) stats.deltas.push(dt) }
    vt += dt * rate
    const t = vt
    px += (tx - px) * 0.04; py += (ty - py) * 0.04
    yaw = t * 0.00011 + Math.sin(t * 0.0003) * 0.05
    pitch = 0.32 + Math.sin(t * 0.00037) * 0.04

    const collapse = easeInOut(phase(t, T.collapse0, T.collapse1))
    const dissolve = phase(t, T.dissolve0, T.dissolve1)
    const bgA = 1 - easeInOut(dissolve)
    const wake = easeOut(phase(t, 0, T.grow0 || 1))

    // ---- background ----
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, W, H)
    if (bgA > 0) { ctx.fillStyle = `rgba(${BG},${bgA})`; ctx.fillRect(0, 0, W, H) }
    ctx.globalCompositeOperation = 'lighter'

    // ---- central glow: waking, steady, then surging at the collapse and fading as the core bursts ----
    const surge = collapse * (1 - easeOut(dissolve))
    const glow = (0.12 + 0.18 * wake + 0.06 * Math.sin(t * 0.003) * (t > T.grow0 ? 1 : 0) + 0.75 * surge) * (1 - dissolve * 0.9) * GLOW
    if (glow > 0.01) {
      const gr = Math.min(W, H) * (0.34 + 0.12 * surge)
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, gr)
      g.addColorStop(0, `rgba(${CYAN},${0.32 * glow})`)
      g.addColorStop(0.35, `rgba(${CYAN},${0.08 * glow})`)
      g.addColorStop(1, `rgba(${CYAN},0)`)
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(W / 2 - gr, H / 2 - gr, gr * 2, gr * 2)
    }

    // ---- ambient dust (depth: near = larger + brighter; drawn with slight parallax) ----
    const dustFade = (0.25 + 0.75 * wake) * (1 - dissolve)
    for (const d of dust) {
      d.p.x += d.v.x * dt + Math.sin(t * 0.0004 + d.phase) * 0.00002 * dt
      d.p.y += d.v.y * dt + Math.cos(t * 0.00035 + d.phase) * 0.000015 * dt
      d.p.z += d.v.z * dt
      if (d.p.z < -1.6) d.p.z += 4.2; else if (d.p.z > 2.6) d.p.z -= 4.2
      const pull = 1 - 0.18 * collapse
      const q = project({ x: d.p.x * pull, y: d.p.y * pull, z: d.p.z }, 1, 0.35)
      if (q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) continue
      const k = q.k, a = clamp01(k - 0.35) * 0.55 * dustFade * (0.7 + 0.3 * Math.sin(t * 0.002 + d.phase))
      glowAt(q.x, q.y, d.size * k * 7, a, d.hue)
    }

    // ---- the spark at the centre ----
    if (t >= T.grow0 && !sparked) sparked = true
    if (sparked && dissolve < 1) {
      const born = easeOut(phase(t, T.grow0, T.grow0 + 350))
      const c = project(nodes[0].p, 1 - 0.96 * collapse)
      // the core dies out quickly once it bursts, so nothing bright sits over the revealed app
      // …and steps back once the wordmark is on screen, so it backlights the mark instead of washing it out.
      const coreFade = (1 - easeOut(clamp01(dissolve * 2.2))) ** 2 * (1 - 0.8 * easeOut(phase(t, T.textIn, T.textIn + 600)))
      glowAt(c.x, c.y, (18 + 40 * surge) * born * GLOW, (0.9 + 0.1 * Math.sin(t * 0.006)) * born * coreFade, 2)
    }

    // ---- network ----
    const shrink = 1 - 0.96 * collapse
    // Nodes fade as they converge, so the collapse resolves into a single clean point for the mark.
    // While the words are on screen the network is a dimmed backdrop, so it never competes with them.
    const netFade = (1 - collapse * 0.97 - dissolve) * (1 - 0.55 * easeOut(phase(t, T.textIn, T.textIn + 400)))
    if (netFade > 0 && t >= T.grow0) {
      ctx.lineCap = 'round'
      for (const e of edges) {
        if (t < e.t0) continue
        const A = nodes[e.a], B = nodes[e.b]
        let grow = 1, alpha: number
        if (e.tree) {
          grow = easeOut(phase(t, e.t0, e.t0 + 260))
          alpha = 0.36
        } else {
          alpha = 0.22 * easeOut(phase(t, e.t0, e.t0 + 400)) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.0016 + e.phase)))
        }
        e.heat *= Math.exp(-dt / 380)
        const a = project(A.p, shrink); const ax = a.x, ay = a.y, ak = a.k
        const b = project(B.p, shrink)
        const bx = lerp(ax, b.x, grow), by = lerp(ay, b.y, grow)
        const depth = clamp01((ak + b.k) / 2 - 0.2)
        const al = (alpha * depth + e.heat * 0.55) * netFade
        if (al < 0.01) continue
        const col = e.heat > 0.05 ? WHITE : CYAN
        ctx.globalAlpha = 1
        ctx.strokeStyle = `rgba(${col},${al})`
        ctx.lineWidth = (0.7 + e.heat * 0.7) * (0.6 + depth * 0.7)
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        // bright growth tip while a tree edge is extending
        if (e.tree && grow < 1) glowAt(bx, by, 10, 0.8 * netFade, 2)
      }
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i]
        if (t < n.t0) continue
        const born = easeOut(phase(t, n.t0, n.t0 + 300))
        const q = project(n.p, shrink)
        const pulse = 1 + 0.28 * Math.sin(t * 0.004 + n.phase) * (t > T.grow1 ? 1 : 0)
        const k = q.k, depth = clamp01(k - 0.2)
        const pop = born < 1 ? 1 + (1 - born) * 0.8 : 1
        glowAt(q.x, q.y, n.size * k * 26 * pulse * pop * GLOW, 0.5 * depth * born * netFade, n.hue)
        glowAt(q.x, q.y, n.size * k * 5, 0.95 * depth * born * netFade, 2)
      }
    }

    // ---- data packets travelling along live edges; they light up the edge they cross ----
    if (t > T.grow1 - 250 && t < T.collapse1 && dissolve === 0) {
      const perSec = (mobile ? 9 : 22) * (opts.mode === 'short' ? 2 : 1)
      if (R() < (perSec * dt) / 1000) {
        const e = Math.floor(R() * edges.length)
        if (t > edges[e].t0 + 300) packets.push({ e, forward: R() < 0.7, t0: t, dur: 420 + R() * 520 })
      }
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i], e = edges[p.e]
      const u = (t - p.t0) / p.dur
      if (u >= 1 || netFade <= 0) { packets.splice(i, 1); continue }
      e.heat = Math.max(e.heat, 0.9)
      const A = nodes[p.forward ? e.a : e.b].p, B = nodes[p.forward ? e.b : e.a].p
      for (let s = 0; s < 4; s++) {
        const uu = clamp01(u - s * 0.05)
        const q = project({ x: lerp(A.x, B.x, uu), y: lerp(A.y, B.y, uu), z: lerp(A.z, B.z, uu) }, shrink)
        glowAt(q.x, q.y, (s === 0 ? 16 : 11 - s * 2) * q.k, (s === 0 ? 0.95 : 0.4 / s) * netFade, s === 0 ? 2 : 0)
      }
    }

    // ---- energy ring at the peak, then faint echoes while the wordmark holds ----
    const hold = T.dissolve0 - T.ring
    const rings: number[][] = [[T.ring, 0.6]]
    if (hold > 2600) for (let r0 = T.ring + 3000; r0 < T.dissolve0 - 1500; r0 += 3000) rings.push([r0, 0.28])
    for (const [r0, strength] of rings) {
      if (t <= r0) continue
      const u = phase(t, r0, r0 + (strength === 1 ? 1200 : 1600))
      if (u >= 1) continue
      const r = easeOut(u) * Math.max(W, H) * (strength === 1 ? 0.62 : 0.5)
      ctx.globalAlpha = 1
      ctx.strokeStyle = `rgba(${CYAN},${0.28 * strength * (1 - u) ** 1.6 * GLOW})`
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = `rgba(${WHITE},${0.08 * strength * (1 - u) ** 2 * GLOW})`
      ctx.lineWidth = 8
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r * 0.985, 0, Math.PI * 2); ctx.stroke()
    }

    // ---- text ----
    if (!textShown && !skipped && t >= T.textIn && t < T.textOut) { textShown = true; cb.onText(true) }
    if (textShown && t >= T.textOut) { textShown = false; cb.onText(false) }

    // ---- dissolve: the core bursts into particles that fly outward and become the app's background ----
    if (t >= T.dissolve0 && !revealed) {
      revealed = true
      const sc = Math.min(W, H) / 800
      sparks = Array.from({ length: N_SPARK }, () => {
        const ang = R() * Math.PI * 2, sp = (0.25 + R() ** 1.5 * 0.95) * sc
        const jit = R() * 18
        return { x: W / 2 + Math.cos(ang) * jit, y: H / 2 + Math.sin(ang) * jit, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.8,
          size: 0.6 + R() ** 2 * 2.2, a: 0.6 + R() * 0.4, hue: R() < 0.07 ? 1 : R() < 0.5 ? 0 : 2 }
      })
      cb.onReveal()
    }
    if (sparks.length) {
      const drag = Math.exp(-dt / 650)
      for (const s of sparks) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= drag; s.vy *= drag
        const fade = 1 - easeOut(dissolve)
        glowAt(s.x, s.y, s.size * 7, s.a * fade, s.hue)
      }
    }

    if (stats.work.length < 600) stats.work.push(performance.now() - w0)
    if (t >= T.end) { finish(); return }
    if (!frozen) raf = requestAnimationFrame(frame)
  }

  const finish = () => {
    if (dead) return
    dead = true
    cancelAnimationFrame(raf)
    if (import.meta.env.DEV) {
      const d = [...stats.deltas].sort((a, b) => a - b), w = [...stats.work].sort((a, b) => a - b)
      const q = (a: number[], p: number) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : 0)
      ;(window as unknown as { __wgIntroStats: object }).__wgIntroStats = {
        frames: stats.frames, avgFrameMs: +(stats.total / Math.max(1, stats.frames - 1)).toFixed(2), p95FrameMs: q(d, 0.95),
        // time spent rendering each frame: what actually limits the frame rate
        avgWorkMs: +(w.reduce((a, b) => a + b, 0) / Math.max(1, w.length)).toFixed(2), p95WorkMs: q(w, 0.95), maxWorkMs: q(w, 1),
      }
    }
    cb.onDone()
  }

  if (frozen) {
    // Deterministic still for visual checks: simulate with fixed 16 ms steps up to the requested time.
    let n = last
    while (!dead && vt < opts.freezeAt!) { n += 16; frame(n) }
  } else raf = requestAnimationFrame((n) => { last = n; frame(n) })

  return {
    // Fast-forward to the dissolve and play it at double speed, so skipping still looks intentional.
    skip: () => {
      if (dead) return
      skipped = true
      if (vt < T.dissolve0) vt = T.dissolve0
      rate = 2
      if (textShown) { textShown = false; cb.onText(false) }
    },
    destroy: () => {
      dead = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    },
  }
}
