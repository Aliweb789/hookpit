# Build context is the repo root:  docker build -f apps/api/Dockerfile .

# ---- Stage 1: build (has dev dependencies and TypeScript) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api

# ---- Stage 2: runtime (production dependencies + compiled code only) ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOOKPIT_DB=/data/hookpit.sqlite PORT=4000
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w apps/api
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
