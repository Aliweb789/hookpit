# Build context is the repo root:  docker build -f apps/web/Dockerfile .
FROM node:20-bookworm-slim
WORKDIR /app

# NEXT_PUBLIC_* values are baked into the browser bundle at BUILD time.
# This is the address the user's BROWSER uses to reach the API.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# NODE_ENV=production would skip devDependencies (TypeScript) needed to build
RUN NODE_ENV=development npm ci
COPY apps/web apps/web
RUN npm run build -w apps/web

USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "apps/web"]
