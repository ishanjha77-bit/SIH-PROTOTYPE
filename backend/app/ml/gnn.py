"""
ST-GNN: spatio-temporal graph attention network that predicts what each station *should* read from
its neighbours, used as the "expected value" in the spatial buddy check and as the virtual sensor.

Graph: 12 stations, fully connected, target node excluded from its own prediction.
Node inputs  (per neighbour j): current + previous 15-min values [T_sea-level, RH, P_sea-level, Wind],
                                a per-variable validity mask, and DEM/static features.
Edge inputs  (i ← j): Δlon, Δlat, distance, Δelevation (DEM-aware topographic context).
Output       (per target i): expected [T_sea-level, RH, P_sea-level, Wind].

Physics-informed loss (added to MSE during training):
  • saturation: predicted vapour pressure e = RH·es(T) must not exceed es(T) (Clausius–Clapeyron)
  • moisture continuity: predicted vapour pressure should stay close to the attention-weighted
    vapour pressure of neighbours (water vapour varies smoothly in space; RH does not)
  • non-negative wind
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from torch import nn

from ..engine.sim import LAPSE, N, STATIONS

MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
WEIGHTS = MODEL_DIR / "st_gnn.pt"
META = MODEL_DIR / "st_gnn.json"
VARS = ("T", "RH", "P", "W")

ELEV = torch.tensor([s.elev for s in STATIONS], dtype=torch.float32)
STATIC = torch.tensor([[s.elev / 1000, s.lon - 73.5, s.lat - 18.5, 1.0 if s.lon < 73.0 else 0.0] for s in STATIONS], dtype=torch.float32)
EDGE = torch.tensor([[[b.lon - a.lon, b.lat - a.lat, ((b.lon - a.lon) ** 2 + (b.lat - a.lat) ** 2) ** 0.5, (b.elev - a.elev) / 1000]
                      for b in STATIONS] for a in STATIONS], dtype=torch.float32)  # [i, j, 4]  (target i ← source j)


def to_sealevel(o: dict, i: int) -> list[float]:
    e = STATIONS[i].elev
    return [o["T"] + LAPSE * e, o["RH"], o["P"] * float(np.exp(e / 8430)), o["W"]]


def es_torch(T: torch.Tensor) -> torch.Tensor:
    return 6.112 * torch.exp(2.501e6 / 461.5 * (1 / 273.15 - 1 / (T + 273.15)))


class STGNN(nn.Module):
    def __init__(self, hidden: int = 64, heads: int = 4):
        super().__init__()
        self.heads = heads
        self.node = nn.Sequential(nn.Linear(4 + 4 + 4 + 4, hidden), nn.GELU(), nn.Linear(hidden, hidden), nn.GELU())
        self.att = nn.Sequential(nn.Linear(hidden + 4 + 4, hidden), nn.GELU(), nn.Linear(hidden, heads))
        self.msg = nn.Sequential(nn.Linear(hidden + 4, hidden), nn.GELU(), nn.Linear(hidden, hidden))
        self.out = nn.Sequential(nn.Linear(hidden + 4, hidden), nn.GELU(), nn.Linear(hidden, 4))

    def forward(self, x_now, x_prev, mask):
        """x_now, x_prev, mask: (B, N, 4) standardised values / validity. Returns (B, N, 4) and attention (B, N, N, H)."""
        B = x_now.shape[0]
        static = STATIC.to(x_now).expand(B, N, 4)
        h = self.node(torch.cat([x_now * mask, x_prev * mask, mask, static], -1))            # (B, N, H)
        hj = h.unsqueeze(1).expand(B, N, N, h.shape[-1])                                       # [b, i, j]
        si = static.unsqueeze(2).expand(B, N, N, 4)
        e = EDGE.to(x_now).expand(B, N, N, 4)
        logits = self.att(torch.cat([hj, si, e], -1))                                           # (B, N, N, heads)
        valid = (mask.sum(-1) > 0).unsqueeze(1).expand(B, N, N) & ~torch.eye(N, dtype=torch.bool, device=x_now.device)
        logits = logits.masked_fill(~valid.unsqueeze(-1), -1e9)
        alpha = torch.softmax(logits, dim=2)                                                    # over sources j
        m = self.msg(torch.cat([hj, e], -1))                                                    # (B, N, N, H)
        m = m.view(B, N, N, self.heads, -1)
        agg = (alpha.unsqueeze(-1) * m).sum(2).reshape(B, N, -1)                                # (B, N, H)
        return self.out(torch.cat([agg, static], -1)), alpha


class GNNPredictor:
    """Implements the pipeline's SpatialPredictor protocol."""
    name = "st-gnn"

    def __init__(self, model: STGNN, mu: list[float], sd: list[float]):
        self.model = model.eval()
        self.mu = torch.tensor(mu)
        self.sd = torch.tensor(sd)

    def _tensor(self, obs: list[Optional[dict]], ok: Optional[dict] = None):
        x = torch.zeros(N, 4)
        m = torch.zeros(N, 4)
        for i, o in enumerate(obs):
            if o is None:
                continue
            x[i] = (torch.tensor(to_sealevel(o, i)) - self.mu) / self.sd
            m[i] = torch.tensor([1.0 if (ok is None or ok[v][i]) else 0.0 for v in VARS])
        return x, m

    def predict(self, now, prev, ok) -> np.ndarray:
        xn, m = self._tensor(now, ok)
        xp, mp = self._tensor(prev)
        with torch.no_grad():
            y, _ = self.model(xn[None], (xp * mp)[None], m[None])
        return (y[0] * self.sd + self.mu).numpy()

    @classmethod
    def load(cls) -> "GNNPredictor | None":
        if not WEIGHTS.exists() or not META.exists():
            return None
        meta = json.loads(META.read_text())
        mdl = STGNN(meta["hidden"], meta["heads"])
        mdl.load_state_dict(torch.load(WEIGHTS, map_location="cpu", weights_only=True))
        return cls(mdl, meta["mu"], meta["sd"])


def load_meta() -> dict | None:
    return json.loads(META.read_text()) if META.exists() else None
