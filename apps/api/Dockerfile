# Build context is the repo root:  docker build -f apps/api/Dockerfile .

# ---- Stage 1: compile the TypeScript ----
# --ignore-scripts: compiling TypeScript does not need the native SQLite module,
# so we skip building it here.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY apps/api apps/api
RUN npm run build -w apps/api

# ---- Stage 2: production dependencies (with a compiler toolchain) ----
# better-sqlite3 is a native module. For some platforms (for example Node 20 on
# ARM Linux, which includes Docker on Apple Silicon Macs) no prebuilt binary
# exists, so it must be compiled from source. The toolchain lives only in this
# stage and never reaches the final image.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w apps/api

# ---- Stage 3: runtime (slim: production dependencies + compiled code only) ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOOKPIT_DB=/data/hookpit.sqlite PORT=4000
COPY --from=deps /app/ ./
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
