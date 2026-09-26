"""
Deterministic AWS network simulator (Konkan coast + Western Ghats, 12 stations, 15-min steps).

Mirrors the frontend reference engine bit-for-bit for the default scenario, and adds
`Scenario` variations (noise seed, storm timing/speed/strength) used to generate training data.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

LAPSE = 0.0065  # °C per metre
STEPS = 288      # 3 days × 96 steps
TRAIN_K = 36     # first 9 h: learn each station's normal residuals


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    lon: float
    lat: float
    elev: int


STATIONS: list[Station] = [
    Station("dahanu", "Dahanu", 72.72, 19.97, 9),
    Station("mumbai", "Mumbai Santacruz", 72.84, 19.09, 14),
    Station("matheran", "Matheran", 73.27, 18.99, 800),
    Station("alibag", "Alibag", 72.87, 18.64, 7),
    Station("ratnagiri", "Ratnagiri", 73.31, 16.99, 67),
    Station("lonavala", "Lonavala", 73.41, 18.75, 622),
    Station("mahabaleshwar", "Mahabaleshwar", 73.66, 17.92, 1382),
    Station("nashik", "Nashik", 73.79, 20.00, 584),
    Station("pune", "Pune Shivajinagar", 73.86, 18.52, 559),
    Station("satara", "Satara", 74.00, 17.68, 691),
    Station("kolhapur", "Kolhapur", 74.24, 16.70, 548),
    Station("ahmednagar", "Ahmednagar", 74.74, 19.09, 649),
]
N = len(STATIONS)
INDEX = {s.id: i for i, s in enumerate(STATIONS)}
W = [[0.0 if i == j else 1 / ((a.lon - b.lon) ** 2 + (a.lat - b.lat) ** 2 + 0.02)
      for j, b in enumerate(STATIONS)] for i, a in enumerate(STATIONS)]

FAULT_TYPES = ("flatline", "drift", "spike", "blockage", "power", "soiling", "bearing")


@dataclass
class Fault:
    st: str
    type: str
    k0: int
    steps: Optional[list[int]] = None
    user: bool = False
    val: Optional[float] = None  # internal: frozen value for flatline

    def to_json(self) -> dict:
        d = {"st": self.st, "type": self.type, "k0": self.k0}
        if self.steps is not None:
            d["steps"] = self.steps
        if self.user:
            d["user"] = True
        return d


def default_faults() -> list[Fault]:
    return [
        Fault("pune", "drift", 40),
        Fault("satara", "soiling", 20),
        Fault("kolhapur", "spike", 60, steps=[60, 97, 205, 240]),
        Fault("ratnagiri", "blockage", 100),
        Fault("nashik", "flatline", 110),
        Fault("mahabaleshwar", "power", 138),
        Fault("ahmednagar", "bearing", 30),
    ]


@dataclass(frozen=True)
class Scenario:
    seed: int = 0              # 0 = the reference demo run
    storm_k: float = 128       # step at which the squall line crosses 72.2°E
    storm_speed: float = 0.055 # degrees longitude per step
    storm_rain: float = 55     # peak convective rain rate mm/h
    storm_on: tuple[int, int, int, int] = (118, 126, 185, 200)  # ramp-up start/end, ramp-down start/end
    storm: bool = True


# ---------------- deterministic noise (identical to the JS engine) ----------------
def _i32(x: int) -> int:
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x & 0x80000000 else x


def _imul(a: int, b: int) -> int:
    return _i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))


def hash3(a: int, b: int, c: int) -> float:
    h = _i32(_imul(a + 1, 374761393) + _imul(b + 7, 668265263) + _imul(c + 3, 1442695041))
    h = _imul(_i32(h ^ ((h & 0xFFFFFFFF) >> 13)), 1274126177)
    h = _i32(h ^ ((h & 0xFFFFFFFF) >> 16))
    return (h & 0xFFFFFFFF) / 4294967296


def gn(a: int, b: int, c: int) -> float:
    return (hash3(a, b, c) + hash3(a, b, c + 17) + hash3(a, b, c + 31) - 1.5) * 2


# ---------------- atmosphere ----------------
def hour_of(k: int) -> float:
    return (k * 0.25) % 24


def cos_z(lat: float, k: int) -> float:
    H = (hour_of(k) - 12.6) * 15 * math.pi / 180
    d = -1 * math.pi / 180
    p = lat * math.pi / 180
    return math.sin(p) * math.sin(d) + math.cos(p) * math.cos(d) * math.cos(H)


def clear_sky(lat: float, k: int) -> float:
    c = cos_z(lat, k)
    return 1050 * c ** 1.2 if c > 0 else 0.0


def storm_amp(k: int, sc: Scenario) -> float:
    if not sc.storm:
        return 0.0
    a, b, c, d = sc.storm_on
    if k < a:
        return 0.0
    if k < b:
        return (k - a) / (b - a)
    if k < c:
        return 1.0
    if k < d:
        return (d - k) / (d - c)
    return 0.0


def storm_at(lon: float, lat: float, k: int, sc: Scenario = Scenario()) -> dict:
    A = storm_amp(k, sc)
    if A <= 0:
        return {"rain": 0.0, "conv": 0.0, "behind": 0.0, "d": 9.0, "A": 0.0}
    lon_c = 72.2 + (k - sc.storm_k) * sc.storm_speed
    d = lon - lon_c
    conv = math.exp(-((d / 0.09) ** 2))
    behind = math.exp(d / 0.6) if d < 0 else 0.0
    lat_mod = 0.75 + 0.25 * math.cos((lat - 18.3) * 1.6)
    rain = A * lat_mod * (sc.storm_rain * conv + (9 * behind if d < -0.05 else 0))
    return {"rain": rain, "conv": conv * A * lat_mod, "behind": behind * A * lat_mod, "d": d, "A": A * lat_mod}


def dbz_from_rain(r: float) -> float:
    return 10 * math.log10(200 * r ** 1.6) if r > 0.15 else 5.0


def rain_from_dbz(z: float) -> float:
    """Marshall–Palmer Z = 200 R^1.6 inverted → rain rate mm/h."""
    return (10 ** (z / 10) / 200) ** (1 / 1.6) if z > 12 else 0.0


def truth(i: int, k: int, sc: Scenario = Scenario()) -> dict:
    s = STATIONS[i]
    kk = k + sc.seed * 1000  # noise stream offset; seed 0 = reference run
    h = hour_of(k)
    diur = math.sin(2 * math.pi * (h - 9) / 24)
    sw = storm_at(s.lon, s.lat, k, sc)
    coastal = 1 if s.lon < 73.0 else 0
    Tsl = 28.4 + 3.6 * diur + (s.lon - 73) * 0.9 * max(0.0, diur) + 0.5 * math.sin(k / 55) + 0.22 * gn(i, kk, 1)
    cold = 0.0
    if sw["d"] < 0 and sw["A"] > 0:
        cold = -7.5 * (1 - math.exp(sw["d"] / 0.04)) * math.exp(sw["d"] / 1.0) * sw["A"]
    T = Tsl - LAPSE * s.elev + cold
    RH = 73 + coastal * 7 + s.elev * 0.004 - 6.5 * diur + 1.2 * gn(i, kk, 2) + 28 * (sw["conv"] + 0.8 * sw["behind"])
    RH = min(99.0, max(20.0, RH))
    P = (1007.8 * math.exp(-s.elev / 8430) + 1.1 * math.cos(2 * math.pi * (h - 10) / 12)
         + (2.6 * math.exp(sw["d"] / 0.5) * sw["A"] if sw["d"] < 0 else 0) + 0.12 * gn(i, kk, 3))
    Wd = max(0.2, 3 + 1.8 * math.sin(2 * math.pi * (h - 14) / 24) + 0.6 * gn(i, kk, 4) + 20 * sw["conv"] + 5 * sw["behind"])
    cs = clear_sky(s.lat, k)
    cloud = max(0.08, 0.8 + 0.08 * gn(i, kk, 5) - 0.7 * min(1.0, sw["conv"] + sw["behind"]))
    rain_rate = max(0.0, sw["rain"] * (1 + 0.15 * gn(i, kk, 6)))
    S = cs * cloud
    return {
        "T": T, "RH": RH, "P": P, "W": Wd, "S": S, "cs": cs, "R": rain_rate / 4,
        "V": 12.55 + 0.12 * math.tanh(S / 300) + 0.03 * gn(i, kk, 9),
        "C": T + 3 + 14 * S / 1000 + 0.3 * gn(i, kk, 10),  # logger cabinet temperature °C
        "dbz": dbz_from_rain(rain_rate) + 1.2 * gn(i, kk, 7),
        "ctt": 24 - 88 * min(1.0, sw["conv"] * 1.3 + sw["behind"] * 0.6) + 1.5 * gn(i, kk, 8),
        "stormy": (sw["conv"] + sw["behind"]) > 0.08 or cold < -0.5,
    }


@dataclass
class SimResult:
    faults: list[Fault]
    TRUE: list[list[dict]]
    RAW: list[list[Optional[dict]]]
    TRUTH: list[list[list[int]]]
    scenario: Scenario = field(default_factory=Scenario)


def simulate(faults: list[Fault], sc: Scenario = Scenario(), steps: int = STEPS) -> SimResult:
    faults = [Fault(f.st, f.type, f.k0, list(f.steps) if f.steps else None, f.user) for f in faults]
    TRUE, RAW, TRUTH = [], [], []
    for k in range(steps):
        tr_row, raw_row, tt_row = [], [], []
        for i in range(N):
            t = truth(i, k, sc)
            tr_row.append(t)
            o = {key: t[key] for key in ("T", "RH", "P", "W", "S", "R", "V", "C")}
            man: list[int] = []
            missing = False
            for fi, f in enumerate(faults):
                if INDEX[f.st] != i or k < f.k0:
                    continue
                if f.type == "drift":
                    o["RH"] += 0.12 * (k - f.k0)
                    if 0.12 * (k - f.k0) > 3:
                        man.append(fi)
                elif f.type == "flatline":
                    if k == f.k0:
                        f.val = o["T"]
                    o["T"] = f.val if f.val is not None else o["T"]
                    if k > f.k0 + 1:
                        man.append(fi)
                elif f.type == "spike" and f.steps and k in f.steps:
                    o["T"] += 11 if k % 2 else -9
                    man.append(fi)
                elif f.type == "blockage":
                    o["R"] = 0.0
                    if t["R"] > 0.3:
                        man.append(fi)
                elif f.type == "bearing":
                    # anemometer bearing wear: friction grows, cups under-read, then stall in light wind
                    fac = max(0.5, 1 - 0.004 * (k - f.k0))
                    o["W"] = 0.0 if t["W"] < 1.2 + 3 * (1 - fac) else o["W"] * fac
                    if fac < 0.9:
                        man.append(fi)
                elif f.type == "soiling":
                    o["S"] *= 0.86
                    if t["cs"] > 150:
                        man.append(fi)
            for fi, f in enumerate(faults):
                if INDEX[f.st] != i or k < f.k0 or f.type != "power":
                    continue
                o["V"] = max(10.3, o["V"] - 0.028 * (k - f.k0))
                if o["V"] < 11.6:
                    b = 11.6 - o["V"]
                    o["T"] += b * 5
                    o["RH"] -= b * 9
                    o["P"] -= b * 4
                    man.append(fi)
                if o["V"] < 10.8:
                    missing = True
            raw_row.append(None if missing else o)
            tt_row.append(man)
        TRUE.append(tr_row)
        RAW.append(raw_row)
        TRUTH.append(tt_row)
    return SimResult(faults, TRUE, RAW, TRUTH, sc)
