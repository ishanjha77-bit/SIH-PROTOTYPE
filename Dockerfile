# One container = website + API. Works on Render, Railway, Koyeb, Fly.io, Cloud Run, or any VPS.
# ---- 1. build the React console ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. FastAPI + ONNX Runtime (no PyTorch: small image, ~150 MB RAM) ----
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 WG_RUNTIME=onnx
COPY backend/requirements-serve.txt .
RUN pip install --no-cache-dir -r requirements-serve.txt
# Extra packages for non-web roles (the streaming tier passes the Kafka + Postgres clients). Empty by default,
# so the deployed image stays small.
ARG EXTRA_PIP=""
RUN if [ -n "$EXTRA_PIP" ]; then pip install --no-cache-dir $EXTRA_PIP; fi
COPY backend/app ./app
COPY backend/models ./models
COPY --from=web /web/dist ./static
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
