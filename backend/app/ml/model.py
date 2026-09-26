"""
LSTM-autoencoder for multivariate AWS anomaly scoring.

Input: a window of the last `window` 15-min steps for one station, each step a 5-feature vector of
standardised residuals against altitude-corrected neighbours and radar:
    [z_T, z_RH, z_P, z_Wind, (gauge − radar rain)/0.8]
The model learns what normal residual sequences look like (including genuine storms, which are
present in training scenarios). Reconstruction error on recent steps is the anomaly score.
Errors are rescaled so the calibrated threshold (99.9th percentile on held-out normal data) maps to
6.5 — the same review threshold the UI and pipeline use.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
WEIGHTS = MODEL_DIR / "lstm_ae.pt"
META = MODEL_DIR / "lstm_ae.json"
UI_THRESHOLD = 6.5
CLIP = 6.0  # residual z-scores are clipped to ±6 before entering the network


class LSTMAutoencoder(nn.Module):
    def __init__(self, n_features: int = 5, hidden: int = 32, latent: int = 8):
        super().__init__()
        self.encoder = nn.LSTM(n_features, hidden, batch_first=True)
        self.to_latent = nn.Linear(hidden, latent)
        self.decoder = nn.LSTM(latent, hidden, batch_first=True)
        self.out = nn.Linear(hidden, n_features)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: (B, T, F)
        _, (h, _) = self.encoder(x)
        z = torch.tanh(self.to_latent(h[-1]))              # (B, latent)
        dec_in = z.unsqueeze(1).repeat(1, x.size(1), 1)    # (B, T, latent)
        y, _ = self.decoder(dec_in)
        return self.out(y)


def window_error(model: LSTMAutoencoder, x: torch.Tensor, recent: int = 4) -> torch.Tensor:
    """Mean squared reconstruction error over the most recent `recent` steps of each window."""
    with torch.no_grad():
        rec = model(x)
    return ((rec[:, -recent:, :] - x[:, -recent:, :]) ** 2).mean(dim=(1, 2))


class AEScorer:
    """Implements the pipeline's SequenceScorer protocol."""

    def __init__(self, model: LSTMAutoencoder, window: int, threshold: float, recent: int = 4):
        self.model = model.eval()
        self.window = window
        self.threshold = threshold
        self.recent = recent

    def score(self, windows: np.ndarray) -> np.ndarray:
        x = torch.from_numpy(np.clip(windows, -CLIP, CLIP).astype(np.float32))
        err = window_error(self.model, x, self.recent).numpy()
        return UI_THRESHOLD * err / self.threshold

    @classmethod
    def load(cls) -> "AEScorer | None":
        if not WEIGHTS.exists() or not META.exists():
            return None
        meta = json.loads(META.read_text())
        m = LSTMAutoencoder(meta["n_features"], meta["hidden"], meta["latent"])
        m.load_state_dict(torch.load(WEIGHTS, map_location="cpu", weights_only=True))
        torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
        return cls(m, meta["window"], meta["threshold"], meta.get("recent", 4))


def load_meta() -> dict | None:
    return json.loads(META.read_text()) if META.exists() else None
