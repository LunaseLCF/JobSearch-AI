# Build stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Runtime stage
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      fonts-liberation \
      fonts-noto-cjk \
      python3 \
      python3-venv \
      wget \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir pypdf python-docx PyMuPDF

ENV PATH="/opt/venv/bin:${PATH}"
ENV NODE_ENV=production
ENV PORT=3000
ENV CHROME_PATH=/usr/bin/chromium
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=builder /app .

RUN mkdir -p /app/data /app/data/users /app/data/tmp \
    && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
