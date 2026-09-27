"""
WeatherGuard checks on real 3-hourly SYNOP observations.

The layers that transfer to real data run here unchanged in spirit:
  physics     dew point cannot exceed air temperature (Clausius–Clapeyron / saturation), plausible bounds
  stuck       an identical reading for 18 h while neighbours moved
  spatial     residual against a neighbour-anomaly estimate (lapse- and climate-corrected), robust z-score
  spike       a spatial outlier that appears suddenly (previous report was consistent)
  weather     an outlier explained by independent evidence: thunderstorm/rain present-weather codes,
              cumulonimbus cloud or measured rain at the station or a neighbour (stands in for radar/INSAT)
The learned models (ST-GNN, LSTM autoencoder) were trained on simulated 15-minute data and are NOT applied
here; retraining them on real data is the next step. Real data has no ground truth, so results are
"flagged as inconsistent", not "confirmed faults".
The comparison is NOAA ISD's own automated quality flags (rule-based), as the legacy baseline.
"""
from __future__ import annotations

import math
import statistics as stats
from dataclasses import dataclass
from datetime import datetime, timedelta

from .isd import WW_PRECIP, WW_THUNDER, Obs, Station

# Thresholds (all shown in the UI next to each finding)
Z_OUTLIER = 4.5        # robust z of the spatial residual
Z_CALM = 2.0           # the previous report counts as consistent below this
STUCK_RUN = 6          # identical reports in a row (18 h at 3-hourly)
STUCK_NEIGHBOUR_MOVE = 2.0  # °C: how far neighbours' own readings typically moved over the same window
DEW_MARGIN = 0.5       # °C: dew point may not exceed air temperature by more than this
T_BOUNDS = (0.0, 47.5) # °C plausible for the Konkan–Ghats region
WEATHER_RADIUS_KM = 120
RAIN_EVIDENCE_MM = 0.5
STEP = timedelta(hours=3)
IST = timedelta(hours=5, minutes=30)

CLASSES = {  # code → (label, rejected downstream?)
    "OK": ("Valid", False),
    "PHYSICS": ("Physically impossible", True),
    "STUCK": ("Stuck sensor", True),
    "SPIKE": ("Isolated spike", True),
    "REVIEW": ("Persistent disagreement, needs review", False),
    "WEATHER": ("Extreme but real weather, kept", False),
}
NOAA_SUSPECT = {"2", "3", "6", "7"}


def km(a: Station, b: Station) -> float:
    p = math.pi / 180
    x = (b.lon - a.lon) * p * math.cos((a.lat + b.lat) * p / 2)
    y = (b.lat - a.lat) * p
    return 6371 * math.hypot(x, y)


@dataclass
class Verdict:
    cls: str
    T: float
    expected: float | None
    z: float | None
    noaa: bool
    evidence: list[str]
    reason: str


MIN_CLIM = 8  # reports needed in a (month, hour) cell before we trust its median


def climatology(st: Station) -> dict[tuple[int, int], float]:
    """Median T by (month, hour). Cells with too few reports are left out: better unscored than scored wrong."""
    cells: dict[tuple[int, int], list[float]] = {}
    for o in st.obs.values():
        cells.setdefault((o.t.month, o.t.hour), []).append(o.T)  # type: ignore[arg-type]
    return {k: stats.median(v) for k, v in cells.items() if len(v) >= MIN_CLIM}


def wmedian(pairs: list[tuple[float, float]]) -> float:
    """Weighted median of (value, weight): one extreme neighbour cannot drag the estimate."""
    pairs = sorted(pairs)
    half, acc = sum(w for _, w in pairs) / 2, 0.0
    for v, w in pairs:
        acc += w
        if acc >= half:
            return v
    return pairs[-1][0]


def run(stations: dict[str, Station]) -> dict[str, dict[datetime, Verdict]]:
    keys = list(stations)
    clim = {k: climatology(stations[k]) for k in keys}
    dist = {(a, b): km(stations[a], stations[b]) for a in keys for b in keys if a != b}
    anom = {k: {t: o.T - clim[k][(t.month, t.hour)] for t, o in stations[k].obs.items() if (t.month, t.hour) in clim[k]} for k in keys}  # type: ignore[operator]

    def expected(k: str, t: datetime, exclude: set[str] = frozenset()) -> float | None:  # type: ignore[assignment]
        """Station climatology plus the distance-weighted MEDIAN anomaly of the nearest reporting neighbours."""
        if (t.month, t.hour) not in clim[k]:
            return None
        nb = sorted(((dist[(k, j)], anom[j][t]) for j in keys if j != k and j not in exclude and t in anom[j]))[:5]
        if len(nb) < 3:
            return None
        return clim[k][(t.month, t.hour)] + wmedian([(a, 1 / (d * d + 400)) for d, a in nb])

    def residuals(excl: dict[datetime, set[str]]):
        r_: dict[str, dict[datetime, float]] = {k: {} for k in keys}
        e_: dict[str, dict[datetime, float]] = {k: {} for k in keys}
        for k in keys:
            for t, o in stations[k].obs.items():
                e = expected(k, t, excl.get(t, set()))
                if e is not None:
                    e_[k][t], r_[k][t] = e, o.T - e  # type: ignore[operator]
        sc = {}
        for k in keys:
            r = list(r_[k].values())
            med = stats.median(r) if r else 0.0
            sc[k] = max(0.8, 1.4826 * stats.median([abs(x - med) for x in r])) if r else 1.0
        return r_, e_, sc

    # Pass 1, then pass 2 without neighbours that are themselves outliers at that moment.
    resid, exp_, scale = residuals({})
    outliers: dict[datetime, set[str]] = {}
    for k in keys:
        for t, r in resid[k].items():
            if abs(r / scale[k]) >= Z_OUTLIER:
                outliers.setdefault(t, set()).add(k)
    resid, exp_, scale = residuals(outliers)

    def weather_near(k: str, t: datetime) -> list[str]:
        """Independent evidence of convection or rain at the station or a neighbour, now or 3 h earlier."""
        ev: list[str] = []
        for j in keys:
            if j != k and dist[(k, j)] > WEATHER_RADIUS_KM:
                continue
            for tt in (t, t - STEP):
                o = stations[j].obs.get(tt)
                if not o:
                    continue
                who = "station" if j == k else stations[j].name
                if o.ww in WW_THUNDER:
                    ev.append(f"thunderstorm reported ({who})")
                elif o.ww in WW_PRECIP:
                    ev.append(f"precipitation reported ({who})")
                if o.cb:
                    ev.append(f"cumulonimbus cloud ({who})")
                if o.rain is not None and o.rain >= RAIN_EVIDENCE_MM:
                    ev.append(f"{o.rain:.1f} mm rain in {o.rain_h} h ({who})")
        return sorted(set(ev))

    out: dict[str, dict[datetime, Verdict]] = {k: {} for k in keys}
    for k in keys:
        st = stations[k]
        times = sorted(st.obs)
        run_len, run_start = 1, 0
        for n, t in enumerate(times):
            o = st.obs[t]
            e, r = exp_[k].get(t), resid[k].get(t)
            z = r / scale[k] if r is not None else None
            noaa = o.qT in NOAA_SUSPECT
            # stuck-run bookkeeping: identical SYNOP values on consecutive 3-hourly reports
            if n and t - times[n - 1] == STEP and o.T == st.obs[times[n - 1]].T and o.report == "FM-12":
                run_len += 1
            else:
                run_len, run_start = 1, n
            cls, reason, ev = "OK", "Consistent with physics, its own history and its neighbours.", []

            if (o.Td is not None and o.Td > o.T + DEW_MARGIN) or not (T_BOUNDS[0] <= o.T <= T_BOUNDS[1]):  # type: ignore[operator]
                cls = "PHYSICS"
                reason = (f"Dew point {o.Td:.1f} °C is above air temperature {o.T:.1f} °C, which is physically impossible."
                          if o.Td is not None and o.Td > o.T + DEW_MARGIN else f"{o.T:.1f} °C is outside the plausible range for this region.")  # type: ignore[operator]
            elif run_len >= STUCK_RUN:
                # how far each neighbour's own reading moved over the same window; the typical (median) one
                moves = []
                for j in keys:
                    if j == k:
                        continue
                    vals = [stations[j].obs[tt].T for tt in times[run_start:n + 1] if tt in stations[j].obs]
                    if len(vals) >= 3:
                        moves.append(max(vals) - min(vals))  # type: ignore[type-var]
                moved = stats.median(moves) if moves else 0.0
                if moved >= STUCK_NEIGHBOUR_MOVE:
                    cls = "STUCK"
                    reason = f"Identical {o.T:.1f} °C for {run_len * 3} h while neighbours typically moved {moved:.1f} °C."
            if cls == "OK" and z is not None and abs(z) >= Z_OUTLIER:
                ev = weather_near(k, t)
                prev = times[n - 1] if n else None
                prev_z = resid[k].get(prev) / scale[k] if prev and prev in resid[k] and t - prev == STEP else None  # type: ignore[operator]
                if ev and z < 0:
                    cls = "WEATHER"
                    reason = f"{abs(r):.1f} °C colder than neighbours predict, and independent evidence shows convection."  # type: ignore[arg-type]
                elif ev:
                    cls = "REVIEW"
                    reason = f"{r:+.1f} °C from the neighbour estimate while weather is active nearby. Could be real; sent for review."

                elif prev_z is not None and abs(prev_z) < Z_CALM:
                    cls = "SPIKE"
                    reason = f"Jumped to {r:+.1f} °C from the neighbour estimate in one report, with no weather to explain it."
                else:
                    cls = "REVIEW"
                    reason = f"{r:+.1f} °C from the neighbour estimate and no weather to explain it."
            out[k][t] = Verdict(cls=cls, T=o.T, expected=e, z=z, noaa=noaa, evidence=ev, reason=reason)  # type: ignore[arg-type]
    return out


def ist(t: datetime) -> str:
    return (t + IST).strftime("%d %b %Y, %H:%M IST")
