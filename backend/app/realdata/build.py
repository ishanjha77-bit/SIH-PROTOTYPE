"""
Build the real-data dataset the console shows.

    python -m app.realdata.build --year 2023

Downloads (once) the NOAA ISD files for the 11 network stations, runs the checks in qc.py and writes
frontend/public/realdata/konkan-{year}.json (served statically, so the demo works without the backend).
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from . import isd, qc

OUT_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "realdata"
CODE = {c: n for n, c in enumerate(qc.CLASSES)}  # class → small int for the series


def build(year: int) -> dict:
    stations = isd.load(year)
    verdicts = qc.run(stations)

    counts: Counter[str] = Counter()
    both = noaa_only = wg_only = noaa_total = noaa_kept = weather_noaa = 0
    noaa_only_z: list[float] = []
    cases = []
    for k, vs in verdicts.items():
        for t, v in vs.items():
            counts[v.cls] += 1
            rejected = qc.CLASSES[v.cls][1]
            flagged = v.cls != "OK"
            noaa_total += v.noaa
            if v.noaa and flagged:
                both += 1
            elif v.noaa:
                noaa_only += 1
                if v.z is not None:
                    noaa_only_z.append(abs(v.z))
            if v.noaa and v.cls == "WEATHER":
                weather_noaa += 1
            elif flagged:
                wg_only += 1
            if v.noaa and not rejected:
                noaa_kept += 1
            if flagged:
                st = stations[k]
                nb = sorted(((qc.km(st, stations[j]), j) for j in stations if j != k and t in stations[j].obs))[:4]
                cases.append({
                    "station": k, "name": st.name, "t": t.isoformat(), "when": qc.ist(t),
                    "cls": v.cls, "label": qc.CLASSES[v.cls][0], "rejected": rejected,
                    "T": round(v.T, 1), "expected": None if v.expected is None else round(v.expected, 1),
                    "z": None if v.z is None else round(v.z, 1), "noaa": v.noaa, "reason": v.reason, "evidence": v.evidence,
                    "neighbours": [{"name": stations[j].name, "km": round(d), "T": stations[j].obs[t].T} for d, j in nb],
                })

    # Showcase: the strongest example of each class, plus the NOAA-flagged real-weather cases.
    order = ["WEATHER", "SPIKE", "PHYSICS", "STUCK", "REVIEW"]
    showcase = []
    for c in order:
        pool = [x for x in cases if x["cls"] == c]
        pool.sort(key=lambda x: (not x["noaa"] if c == "WEATHER" else False, -abs(x["z"] or 0)))
        showcase += pool[:3 if c in ("WEATHER", "SPIKE") else 2]

    t0 = min(min(s.obs) for s in stations.values())
    steps = int((max(max(s.obs) for s in stations.values()) - t0) / qc.STEP) + 1
    series = {}
    for k, st in stations.items():
        T, E, C, Q = [], [], [], []
        for n in range(steps):
            t = t0 + n * qc.STEP
            v = verdicts[k].get(t)
            T.append(None if v is None else round(v.T, 1))
            E.append(None if v is None or v.expected is None else round(v.expected, 1))
            C.append(None if v is None else CODE[v.cls])
            Q.append(1 if v and v.noaa else 0)
        series[k] = {"T": T, "E": E, "C": C, "N": Q}

    return {
        "source": {
            "name": "NOAA Integrated Surface Database (ISD), SYNOP reports from IMD stations",
            "url": "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database",
            "year": year, "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Real observations. No ground truth exists, so flags are 'inconsistent', not 'confirmed faults'. "
                    "The learned models were trained on simulated data and are not applied here.",
        },
        "thresholds": {"zOutlier": qc.Z_OUTLIER, "zCalm": qc.Z_CALM, "stuckHours": qc.STUCK_RUN * 3,
                       "stuckNeighbourMove": qc.STUCK_NEIGHBOUR_MOVE, "dewMargin": qc.DEW_MARGIN,
                       "weatherRadiusKm": qc.WEATHER_RADIUS_KM},
        "classes": [{"code": c, "label": l, "rejected": r} for c, (l, r) in qc.CLASSES.items()],
        "stations": [{"id": k, "name": s.name, "isd": s.sid, "lat": s.lat, "lon": s.lon, "elev": s.elev, "n": len(s.obs)} for k, s in stations.items()],
        "summary": {
            "readings": sum(counts.values()), "byClass": dict(counts),
            "noaaFlags": noaa_total, "bothFlag": both, "noaaOnly": noaa_only, "wgOnly": wg_only,
            "noaaFlagsKept": noaa_kept, "weatherNoaaFlagged": weather_noaa,
            # how consistent with their neighbours the readings only NOAA flagged are (robust |z|; 4.5 = our outlier line)
            "noaaOnlyMedianZ": round(sorted(noaa_only_z)[len(noaa_only_z) // 2], 2) if noaa_only_z else None,
            "noaaOnlyWithinZ2": round(sum(z < 2 for z in noaa_only_z) / len(noaa_only_z), 3) if noaa_only_z else None,
        },
        "showcase": showcase,
        "t0": t0.isoformat(), "stepHours": 3, "series": series,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2023)
    a = ap.parse_args()
    data = build(a.year)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"konkan-{a.year}.json"
    path.write_text(json.dumps(data, separators=(",", ":")))
    s = data["summary"]
    print(f"{path.name}: {s['readings']:,} readings · {s['byClass']} · NOAA suspect {s['noaaFlags']} "
          f"(both {s['bothFlag']}, NOAA only {s['noaaOnly']}, WeatherGuard only {s['wgOnly']}) · {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
