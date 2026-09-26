"""
Downstream products built from pipeline output:
  • clean observation records with WMO-style QC flags and confidence (CSV / JSON / NetCDF)
  • CAP-style severe-weather alerts for NDMA / civil defence
  • natural-language shift report for forecasters
"""
from __future__ import annotations

import csv
import io
import math
import os
import tempfile
from datetime import datetime, timedelta, timezone

import numpy as np

from .pipeline import FAULT_CLS, EngineResult, confidence, metrics, wmo_flags
from .sim import N, STATIONS

IST = timezone(timedelta(hours=5, minutes=30))
T0 = datetime(2026, 7, 14, 0, 0, tzinfo=IST)  # demo day 1, 00:00 IST
FIELDS = ("T", "RH", "P", "W", "S", "R")
LABEL = {"VALID": "valid", "SEVERE": "severe weather (valid)", "ELECTRICAL": "power fault", "MISSING": "offline",
         "PHYSICS": "physics violation", "FLATLINE": "stuck sensor", "SPIKE": "spike", "BLOCKAGE": "rain-gauge blockage",
         "DRIFT": "humidity drift", "SOILING": "pyranometer soiling", "BEARING": "anemometer bearing wear", "ANOMALY": "needs review"}


def when(k: int) -> datetime:
    return T0 + timedelta(minutes=15 * k)


def stamp(k: int) -> str:
    return f"Day {k // 96 + 1} {when(k):%H:%M}"


def records(E: EngineResult, k_max: int, k_min: int = 0) -> list[dict]:
    out = []
    for k in range(k_min, k_max + 1):
        for i, s in enumerate(STATIONS):
            d, o = E.OUT[k][i], E.sim.RAW[k][i]
            f = wmo_flags(d)
            rec = {"time": when(k).isoformat(), "station": s.id, "lat": s.lat, "lon": s.lon, "elev_m": s.elev,
                   "class": d["cls"], "qc_raw": f["raw"], "qc_clean": f["clean"], "confidence": confidence(d),
                   "burst_mode": d.get("edge", {}).get("burst", False)}
            for v in FIELDS:
                raw = o[v] if o else None
                clean = d["clean"].get(v, raw) if d["clean"] else raw
                rec[f"{v}_raw"] = None if raw is None else round(raw, 3)
                rec[f"{v}"] = None if clean is None or (isinstance(clean, float) and math.isnan(clean)) else round(clean, 3)
            out.append(rec)
    return out


def to_csv(recs: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(recs[0].keys()))
    w.writeheader()
    w.writerows(recs)
    return buf.getvalue().encode()


def to_netcdf(E: EngineResult, k_max: int) -> bytes:
    """CF-style NetCDF-3 (time × station) ready for NWP pre-processing (e.g. WRFDA obsproc via conversion)."""
    from scipy.io import netcdf_file

    K = k_max + 1
    fd, path = tempfile.mkstemp(suffix=".nc")
    os.close(fd)
    try:
        nc = netcdf_file(path, "w", version=2)
        nc.title = "WeatherGuard AI quality-controlled AWS observations"
        nc.Conventions = "CF-1.8"
        nc.qc_flag_meanings = "0 good, 2 doubtful, 3 erroneous, 4 corrected/imputed, 9 missing"
        nc.createDimension("time", K)
        nc.createDimension("station", N)
        t = nc.createVariable("time", "i4", ("time",))
        t.units = f"minutes since {T0:%Y-%m-%d %H:%M:%S} +05:30"
        t[:] = np.arange(K) * 15
        for name, vals, units in (("lat", [s.lat for s in STATIONS], "degrees_north"), ("lon", [s.lon for s in STATIONS], "degrees_east"),
                                  ("elevation", [s.elev for s in STATIONS], "m")):
            v = nc.createVariable(name, "f4", ("station",))
            v.units = units
            v[:] = vals
        meta = {"T": ("air_temperature", "degC"), "RH": ("relative_humidity", "%"), "P": ("surface_air_pressure", "hPa"),
                "W": ("wind_speed", "m s-1"), "S": ("surface_downwelling_shortwave_flux_in_air", "W m-2"), "R": ("precipitation_amount", "kg m-2")}
        for v, (std, units) in meta.items():
            arr = np.full((K, N), -999.0, dtype="f4")
            for k in range(K):
                for i in range(N):
                    d, o = E.OUT[k][i], E.sim.RAW[k][i]
                    val = d["clean"].get(v) if d["clean"] and v in d["clean"] else (o[v] if o else None)
                    if val is not None and not (isinstance(val, float) and math.isnan(val)):
                        arr[k, i] = val
            var = nc.createVariable(v, "f4", ("time", "station"))
            var.standard_name, var.units, var._FillValue = std, units, np.float32(-999.0)
            var[:] = arr
        qc = nc.createVariable("qc_flag", "i1", ("time", "station"))
        qc[:] = np.array([[wmo_flags(E.OUT[k][i])["clean"] for i in range(N)] for k in range(K)], dtype="i1")
        conf = nc.createVariable("confidence", "f4", ("time", "station"))
        conf[:] = np.array([[confidence(E.OUT[k][i]) for i in range(N)] for k in range(K)], dtype="f4")
        nc.close()
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        os.unlink(path)


def alerts(E: EngineResult, k_max: int) -> list[dict]:
    """One CAP-style alert per station per severe-weather episode."""
    out = []
    for i, s in enumerate(STATIONS):
        prev = False
        for k in range(k_max + 1):
            d, o = E.OUT[k][i], E.sim.RAW[k][i]
            sev = d["cls"] == "SEVERE"
            if sev and not prev:
                c = d["ctx"]
                out.append({
                    "identifier": f"WG-{s.id.upper()}-{k:03d}", "sent": when(k).isoformat(), "status": "Actual", "msgType": "Alert",
                    "scope": "Public", "event": "Severe thunderstorm / squall", "urgency": "Immediate", "severity": "Severe",
                    "certainty": "Observed", "sender": "WeatherGuard AI (AWS QC)", "recipients": ["IMD forecaster", "NDMA SACHET", "District EOC"],
                    "area": {"station": s.name, "lat": s.lat, "lon": s.lon},
                    "headline": f"Squall confirmed at {s.name}",
                    "description": f"Radar {c['maxDbz']:.0f} dBZ, INSAT cloud-top {c['ctt']:.0f} °C, rain {o['R'] if o else 0:.1f} mm/15 min, wind {o['W'] if o else 0:.1f} m/s. Observation verified, not a sensor fault.",
                    "legacy_qc_rejected": E.LEG[k][i]["flag"], "k": k,
                })
            prev = sev
    return sorted(out, key=lambda a: -a["k"])


def report(E: EngineResult, k: int) -> str:
    """Natural-language shift report (markdown) for the forecaster on duty."""
    m = metrics(E, k)
    now = E.OUT[k]
    faulty = [(STATIONS[i].name, LABEL[d["cls"]]) for i, d in enumerate(now) if d["cls"] in FAULT_CLS]
    severe = [STATIONS[i].name for i, d in enumerate(now) if d["cls"] == "SEVERE"]
    warns = [(STATIONS[i].name, d["warn"]) for i, d in enumerate(now) if d.get("warn")]
    lo = max(0, k - 95)
    kept_storm = sum(1 for q in range(lo, k + 1) for i in range(N) if E.OUT[q][i]["cls"] == "SEVERE")
    legacy_storm = sum(1 for q in range(lo, k + 1) for i in range(N) if E.OUT[q][i]["cls"] == "SEVERE" and E.LEG[q][i]["flag"])
    imputed = sum(1 for q in range(lo, k + 1) for i in range(N) if wmo_flags(E.OUT[q][i])["clean"] == 4)
    lines = [f"## WeatherGuard shift report · {stamp(k)} IST", ""]
    lines.append(f"**Network:** {N - len(faulty)} of {N} stations reporting trustworthy data."
                 + (f" Severe weather in progress at {', '.join(severe)}." if severe else " No severe weather in progress."))
    lines.append("")
    lines.append("**Last 24 hours**")
    lines.append(f"- {kept_storm} severe-weather observations verified by radar and satellite and kept"
                 + (f"; legacy QC would have rejected {legacy_storm} of them." if legacy_storm else "."))
    lines.append(f"- {imputed} values corrected or filled by the physics-constrained virtual sensor (QC flag 4).")
    lines.append(f"- Since start: WeatherGuard caught {m['wg']['tp']} faulty readings with {m['wg']['fp']} false alarms; legacy QC caught {m['lg']['tp']} with {m['lg']['fp']}.")
    lines.append("")
    if faulty:
        lines.append("**Needs field attention**")
        lines += [f"- {n}: {lab}" for n, lab in faulty]
        lines.append("")
    if warns:
        lines.append("**Predicted failures**")
        lines += [f"- {n}: {'battery' if w['kind'] == 'battery' else 'anemometer bearing'} expected to go out of tolerance in about {w['hrs']:.0f} h" for n, w in warns]
        lines.append("")
    lines.append("_Generated automatically from the QC pipeline. All values in IST._")
    return "\n".join(lines)
