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
# Install only the dashboard's dependencies (-w apps/web), so the API's native
# SQLite module is never touched. NODE_ENV=production would skip the
# devDependencies (TypeScript) that the build needs.
RUN NODE_ENV=development npm ci -w apps/web --ignore-scripts
COPY apps/web apps/web
RUN npm run build -w apps/web && chown -R node:node /app/apps/web/.next

USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "apps/web"]
