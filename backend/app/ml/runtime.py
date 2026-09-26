"""
Inference runtime. Uses ONNX Runtime (no PyTorch needed — small server image, same model files an edge
device would run). Falls back to PyTorch if ONNX Runtime or the .onnx files are missing.
Force a backend with WG_RUNTIME=onnx|torch.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

import numpy as np

from ..engine.sim import LAPSE, N, STATIONS

MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
UI_THRESHOLD = 6.5
CLIP = 6.0
VARS = ("T", "RH", "P", "W")
_ELEV = np.array([s.elev for s in STATIONS], dtype=np.float32)


def read_meta(name: str) -> Optional[dict]:
    p = MODEL_DIR / name
    return json.loads(p.read_text()) if p.exists() else None


class OrtAEScorer:
    def __init__(self, path: Path, window: int, threshold: float, recent: int = 4):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        self.window, self.threshold, self.recent = window, threshold, recent

    def score(self, windows: np.ndarray) -> np.ndarray:
        x = np.clip(windows, -CLIP, CLIP).astype(np.float32)
        rec = self.sess.run(None, {"window": x})[0]
        err = ((rec[:, -self.recent:, :] - x[:, -self.recent:, :]) ** 2).mean(axis=(1, 2))
        return UI_THRESHOLD * err / self.threshold


class OrtGNNPredictor:
    name = "st-gnn"

    def __init__(self, path: Path, mu: list[float], sd: list[float]):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        self.mu, self.sd = np.array(mu, dtype=np.float32), np.array(sd, dtype=np.float32)
        self._pscale = np.exp(_ELEV / 8430)

    def _arr(self, obs, ok=None):
        x = np.zeros((N, 4), dtype=np.float32)
        m = np.zeros((N, 4), dtype=np.float32)
        for i, o in enumerate(obs):
            if o is None:
                continue
            x[i] = ((np.array([o["T"] + LAPSE * _ELEV[i], o["RH"], o["P"] * self._pscale[i], o["W"]]) - self.mu) / self.sd)
            m[i] = [1.0 if (ok is None or ok[v][i]) else 0.0 for v in VARS]
        return x, m

    def predict(self, now, prev, ok) -> np.ndarray:
        xn, m = self._arr(now, ok)
        xp, mp = self._arr(prev)
        y = self.sess.run(None, {"x_now": xn[None], "x_prev": (xp * mp)[None], "mask": m[None]})[0][0]
        return y * self.sd + self.mu


def load_models():
    """Returns (scorer, spatial, runtime_name). Either model may be None if not trained."""
    want = os.getenv("WG_RUNTIME", "onnx")
    ae_meta, gnn_meta = read_meta("lstm_ae.json"), read_meta("st_gnn.json")
    if want == "onnx":
        try:
            import onnxruntime  # noqa: F401
            scorer = OrtAEScorer(MODEL_DIR / "lstm_ae.onnx", ae_meta["window"], ae_meta["threshold"], ae_meta.get("recent", 4)) \
                if ae_meta and (MODEL_DIR / "lstm_ae.onnx").exists() else None
            spatial = OrtGNNPredictor(MODEL_DIR / "st_gnn.onnx", gnn_meta["mu"], gnn_meta["sd"]) \
                if gnn_meta and (MODEL_DIR / "st_gnn.onnx").exists() else None
            if scorer or spatial:
                return scorer, spatial, "onnxruntime"
        except ImportError:
            pass
    try:
        from .gnn import GNNPredictor
        from .model import AEScorer
        return AEScorer.load(), GNNPredictor.load(), "pytorch"
    except ImportError:
        return None, None, "none"
