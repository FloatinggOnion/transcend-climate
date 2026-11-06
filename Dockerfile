# syntax=docker/dockerfile:1
# Two stages: build the frontend, then run only what the server needs.
# Pin the base image by digest for production (docker buildx imagetools inspect node:24-bookworm-slim).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Lockfile is authoritative; dependency scripts never run (also set in .npmrc).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS run
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 STATIC_DIR=/app/dist CACHE_DIR=/data/cache
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts --prod && rm -rf /root/.cache
COPY server ./server
COPY shared ./shared
COPY src/engine/retryableLoad.js ./src/engine/retryableLoad.js
COPY src/geo ./src/geo
COPY --from=build /app/dist ./dist
# /app stays root-owned and read-only to the app; only /data (the cache) is writable.
# (A recursive chown of /app would duplicate the whole node_modules layer.)
RUN mkdir -p /data/cache && chown -R node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{headers:{host:'localhost'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
