# Deploying WeatherGuard AI

The repo builds into **one container** that serves both the website and the API
(`Dockerfile` at the repo root). The server runs the models with ONNX Runtime, so PyTorch is not needed.
It uses about 150 MB of RAM and fits free hosting tiers.

## Option A — Render (free, recommended for the portal link)

1. Push this folder to a **public or private GitHub repo** (the repo root must contain `Dockerfile` and `render.yaml`).
   ```bash
   cd weatherguard
   git init && git add . && git commit -m "WeatherGuard AI prototype"
   git branch -M main
   git remote add origin https://github.com/<you>/weatherguard-ai.git
   git push -u origin main
   ```
2. Sign in at render.com with GitHub → **New → Blueprint** → select the repo → **Apply**.
   Render reads `render.yaml`, builds the Dockerfile (about 5 minutes the first time) and gives you
   `https://weatherguard-ai-xxxx.onrender.com`.
3. Open the link and check that the Overview header says **FastAPI server** (and that the **Real data** page loads), then paste it on the portal.

Free-plan notes:
- The service sleeps after 15 minutes without traffic and takes about a minute to wake.
  The console handles this: it runs the full pipeline in the browser straight away, keeps knocking on
  the server, and switches to it automatically once it wakes. Judges never see a blank page.
- To keep it awake during judging days, add a free uptime monitor (e.g. UptimeRobot) that pings
  `https://<your-app>.onrender.com/api/v1/health` every 10 minutes. One service running all month
  fits inside Render's 750 free hours.

## Option B — Static site only (always on, zero cold start)

The console includes a TypeScript copy of the pipeline, so it works with no server at all. It uses simpler
models (inverse-distance and PCA instead of the ST-GNN and LSTM autoencoder), so some scores differ from the server's.
The Real data page is a static file and works either way.

- **Netlify:** New site → import the repo → base directory `frontend` (uses `frontend/netlify.toml`).
- **Vercel:** New project → root directory `frontend` → framework Vite (uses `frontend/vercel.json`).

To combine both: set the environment variable `VITE_API_URL=https://<your-render-app>.onrender.com`
on Netlify/Vercel. The site is then instant, and it upgrades to the ST-GNN + LSTM-AE server as soon as the server is awake.

## Option C — Any VPS / college server / cloud VM

```bash
docker build -t weatherguard .
docker run -d --restart unless-stopped -p 80:8000 weatherguard
```
Without Docker:
```bash
cd frontend && npm ci && npm run build && cp -r dist ../backend/static
cd ../backend && pip install -r requirements-serve.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## What to put on the portal

- **Prototype link:** the Render URL (or Netlify/Vercel URL).
- **One line for judges:** "Open the link and press *2-minute tour* (top right). Works on phone and desktop."
- **Code:** the GitHub repo link.
- **API docs:** `<your-url>/docs`.

## Before you submit

- Open the link in a private window on your phone and on a laptop.
- Run the tour once end to end.
- Wake the server 5 minutes before any live judging session.
