# NEXA AI Gateway — build from the repository root:
#   docker build -f server/Dockerfile -t nexa-ai-gateway .
# The runtime image contains only the self-contained bundle (no node_modules,
# no secrets). Secrets are injected at runtime (env or *_FILE mounts).

FROM node:24-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_ignore_scripts=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY server ./server
COPY src/shared ./src/shared
RUN npx tsc -p tsconfig.server.json --noEmit && npm run server:build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    AI_GATEWAY_HOST=0.0.0.0 \
    PORT=8787 \
    AI_DB_PATH=/data/nexa-ai.sqlite
WORKDIR /srv
COPY --from=build /app/server/dist/index.mjs ./index.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/ai/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "index.mjs"]
