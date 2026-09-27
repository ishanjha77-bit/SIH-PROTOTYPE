"""
Real observations from IMD synoptic stations, via NOAA's Integrated Surface Database (ISD).

ISD republishes the SYNOP reports IMD sends over the WMO Global Telecommunication System, so these are the
real 3-hourly observations from the same stations the simulator models. Files are public:
    https://www.ncei.noaa.gov/data/global-hourly/access/{year}/{usaf}{wban}.csv
"""
from __future__ import annotations

import csv
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

ISD_URL = "https://www.ncei.noaa.gov/data/global-hourly/access/{year}/{sid}.csv"
CACHE = Path(__file__).resolve().parents[2] / "data" / "isd"

# Our network → ISD station ids. Lonavala has no ISD record, so the real-data network has 11 stations.
STATIONS: dict[str, tuple[str, str]] = {
    "dahanu": ("43001099999", "Dahanu"),
    "mumbai": ("43003099999", "Mumbai Santacruz"),
    "matheran": ("43060099999", "Matheran"),
    "alibag": ("43058099999", "Alibag"),
    "ratnagiri": ("43110099999", "Ratnagiri"),
    "mahabaleshwar": ("43111099999", "Mahabaleshwar"),
    "nashik": ("42921099999", "Nashik"),
    "pune": ("43063099999", "Pune"),
    "satara": ("43113099999", "Satara"),
    "kolhapur": ("43157099999", "Kolhapur"),
    "ahmednagar": ("43009099999", "Ahmednagar"),
}

# SYNOP present-weather (ww) codes that indicate precipitation or convection at or near the station.
WW_THUNDER = {17, 29, *range(91, 100)}
WW_PRECIP = {*range(50, 100)} | {20, 21, 22, 23, 24, 25, 26, 27}
CLOUD_CB = 9  # ISD GA1 cloud-type code for cumulonimbus


@dataclass
class Obs:
    t: datetime
    T: float | None = None          # air temperature °C
    Td: float | None = None         # dew point °C
    qT: str = "1"                   # NOAA ISD quality code for T (2/3/6/7 = suspect or erroneous)
    slp: float | None = None        # sea-level pressure hPa
    wind: float | None = None       # m/s
    rain: float | None = None       # mm in the reported period
    rain_h: int | None = None       # period of that rain amount, hours
    ww: int | None = None           # SYNOP present weather
    cb: bool = False                # cumulonimbus reported
    report: str = ""


@dataclass
class Station:
    key: str
    sid: str
    name: str
    lat: float = 0.0
    lon: float = 0.0
    elev: float = 0.0
    obs: dict[datetime, Obs] = field(default_factory=dict)


def _num(field_: str, scale: float = 10, missing: int = 9999) -> tuple[float | None, str]:
    if not field_:
        return None, "9"
    parts = field_.split(",")
    try:
        x = int(parts[0])
    except ValueError:
        return None, "9"
    q = parts[1] if len(parts) > 1 else "9"
    return (None, q) if abs(x) >= missing else (x / scale, q)


def parse_row(r: dict) -> Obs | None:
    """One ISD record → Obs. Returns None for records we don't use (off the 3-hourly synoptic grid)."""
    t = datetime.fromisoformat(r["DATE"])
    if t.minute or t.hour % 3:
        return None
    T, qT = _num(r.get("TMP", ""))
    Td, _ = _num(r.get("DEW", ""))
    slp, _ = _num(r.get("SLP", ""), missing=99999)
    o = Obs(t=t, T=T, Td=Td, qT=qT, slp=slp, report=r.get("REPORT_TYPE", "").strip())
    wnd = r.get("WND", "").split(",")
    if len(wnd) >= 4 and wnd[3].isdigit() and int(wnd[3]) != 9999:
        o.wind = int(wnd[3]) / 10
    for k in ("AA1", "AA2"):
        aa = r.get(k, "").split(",")
        if len(aa) >= 2 and aa[0].isdigit() and aa[1].isdigit() and int(aa[1]) != 9999:
            o.rain, o.rain_h = int(aa[1]) / 10, int(aa[0])
            break
    mw = r.get("MW1", "").split(",")
    if mw and mw[0].isdigit():
        o.ww = int(mw[0])
    for k in ("GA1", "GA2", "GA3"):
        ga = r.get(k, "").split(",")
        if len(ga) >= 5 and ga[4].isdigit() and int(ga[4]) == CLOUD_CB:
            o.cb = True
    return o


def fetch(sid: str, year: int) -> Path:
    """Download (once) and cache the ISD CSV for a station-year."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{sid}-{year}.csv"
    if not path.exists() or path.stat().st_size == 0:
        urllib.request.urlretrieve(ISD_URL.format(year=year, sid=sid), path)
    return path


def load(year: int) -> dict[str, Station]:
    """All network stations for a year. SYNOP (FM-12) reports win over METAR when both exist."""
    out: dict[str, Station] = {}
    for key, (sid, name) in STATIONS.items():
        st = Station(key=key, sid=sid, name=name)
        with open(fetch(sid, year), encoding="utf-8") as f:
            for r in csv.DictReader(f):
                st.lat, st.lon, st.elev = float(r["LATITUDE"]), float(r["LONGITUDE"]), float(r["ELEVATION"])
                o = parse_row(r)
                if not o or o.T is None:
                    continue
                prev = st.obs.get(o.t)
                if prev is None or (o.report == "FM-12" and prev.report != "FM-12"):
                    st.obs[o.t] = o
        out[key] = st
    return out
