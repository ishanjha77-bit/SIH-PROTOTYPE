import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { STATIONS } from '../engine/engine'
import { TONE, statusOf } from '../lib/present'
import { useConsole } from '../state/console'
import { drawRadar } from './NetworkMap'

const BOUNDS: L.LatLngBoundsExpression = [[16.2, 72.3], [20.4, 75.1]]
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v.replace(/^var\((.*)\)$/, '$1')).trim()

/** Real basemap (Leaflet + CARTO tiles) with the same radar overlay and station verdicts. */
export function LeafletMap() {
  const { engine, k, sel, select, theme } = useConsole()
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const radar = useRef<L.ImageOverlay | null>(null)
  const markers = useRef<L.CircleMarker[]>([])
  const cv = useRef<HTMLCanvasElement>(document.createElement('canvas'))

  useEffect(() => {
    if (!host.current || map.current) return
    const m = L.map(host.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).fitBounds(BOUNDS)
    map.current = m
    cv.current.width = 180; cv.current.height = 260
    radar.current = L.imageOverlay(cv.current.toDataURL(), BOUNDS, { opacity: 0.85, interactive: false }).addTo(m)
    markers.current = STATIONS.map((s, i) =>
      L.circleMarker([s.lat, s.lon], { radius: 8, weight: 3, fillOpacity: 1 })
        .bindTooltip(`${s.name} · ${s.elev} m`, { direction: 'top', offset: [0, -8] })
        .on('click', () => select(i))
        .addTo(m))
    return () => { m.remove(); map.current = null }
  }, [select])

  useEffect(() => {
    const m = map.current; if (!m) return
    tiles.current?.remove()
    const style = theme === 'dark' ? 'dark_all' : 'light_all'
    tiles.current = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 12,
    }).addTo(m)
    tiles.current.bringToBack()
  }, [theme])

  useEffect(() => {
    drawRadar(cv.current, k, (y, h) => 20.4 - ((y + 0.5) / h) * 4.2, (x, w) => 72.3 + ((x + 0.5) / w) * 2.8)
    radar.current?.setUrl(cv.current.toDataURL())
    markers.current.forEach((mk, i) => {
      const st = statusOf(engine.OUT[k][i])
      mk.setStyle({ fillColor: css(TONE[st.tone].hex), color: i === sel ? css('var(--accent)') : css('var(--surface)'), radius: i === sel ? 10 : 8 })
    })
  }, [engine, k, sel, theme])

  return <div ref={host} className="h-[560px] w-full overflow-hidden rounded-[22px] border border-line" role="application" aria-label="Street map of the station network" />
}
