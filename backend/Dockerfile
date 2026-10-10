# syntax=docker/dockerfile:1
#
# Single image that contains BOTH the compiled backend and the built SPA/widget.
# The backend serves the static frontend from ../../frontend-react/dist and the
# API + WebSocket itself, so only one app container is needed behind Caddy.

# ---------- 1. frontend build ----------
FROM node:22-bookworm AS frontend
WORKDIR /app/frontend-react
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci
COPY frontend-react/ ./
RUN npm run build

# ---------- 2. backend build (TypeScript -> JS) ----------
FROM node:22-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---------- 3. backend production dependencies ----------
FROM node:22-bookworm AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
# Same base image as the build stage, so the prebuilt bcrypt native binary matches.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- 4. runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=backend-deps  /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/dist         ./dist
# SQL schema is needed by the idempotent migration step in the entrypoint.
COPY backend/src/db/schema       ./src/db/schema
COPY backend/package.json        ./package.json
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh

# Built SPA + widget, served by the backend catch-all (../../frontend-react/dist).
COPY --from=frontend /app/frontend-react/dist /app/frontend-react/dist

RUN sed -i 's/\r$//' ./docker-entrypoint.sh \
 && chmod +x ./docker-entrypoint.sh \
 && mkdir -p /app/backend/uploads

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
