# Multi-stage build producing a single image that serves the API + built SPA.
# Node 26 is required: the app uses the built-in node:sqlite module (no native
# build step), which is available without a flag on this version.

# --- Frontend build ---
FROM node:26-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Backend build ---
FROM node:26-bookworm-slim AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# --- Runtime ---
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist /app/frontend/dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
