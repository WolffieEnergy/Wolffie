# ============================================================================
# Wolffie — Multi-stage Dockerfile
# ============================================================================
#
# Structuur:
#   Stage 1 (frontend-builder) — Vue app bouwen met Vite
#   Stage 2 (backend-deps)     — Alleen productie Node.js dependencies installeren
#   Stage 3 (runtime)          — Minimale Alpine runtime image
#
# Build:
#   docker build -t wolffie:latest .
#

# ============================================================================
# Stage 1 — Frontend build
# ============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Dependencies installeren (inclusief devDependencies — nodig voor Vite build)
COPY my-app/package*.json ./
RUN npm ci

# Broncode kopiëren en bouwen
COPY my-app/ ./
RUN npm run build

# .npmrc direct na build verwijderen — token niet in image cache laten staan
RUN rm -f .npmrc

# ============================================================================
# Stage 2 — Backend productie dependencies
# ============================================================================
FROM node:20-alpine AS backend-deps

WORKDIR /build

# better-sqlite3 heeft native compilatie nodig (C++ binding)
RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm ci --omit=dev

# ============================================================================
# Stage 3 — Runtime image
# ============================================================================
FROM node:20-alpine AS runtime

WORKDIR /app

# tini als PID 1 — zorgt voor correcte SIGTERM afhandeling in Docker
RUN apk add --no-cache tini

# Backend broncode
COPY server/ ./server/

# Productie node_modules (gecompileerd in stage 2)
COPY --from=backend-deps /build/node_modules ./server/node_modules

# Gebouwde Vue frontend — Express serveert dit als static files
# Pad: /app/public → server.js verwijst naar path.join(__dirname, '..', 'public')
COPY --from=frontend-builder /build/dist ./public

# Data directory aanmaken (SQLite database + logs)
RUN mkdir -p /app/data /app/logs

# Non-root user voor veiligheid
RUN addgroup -S wolffie && adduser -S wolffie -G wolffie && \
    chown -R wolffie:wolffie /app
USER wolffie

EXPOSE 3009

# Health check — Docker weet wanneer de container klaar is
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3009/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.js"]
