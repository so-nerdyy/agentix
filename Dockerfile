FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV AGENTIX_DATA_DIR=/data
ENV AGENTIX_WORKSPACE_DIR=/workspace
ENV AGENTIX_INBOX_PORT=3000
ENV AGENTIX_BRIDGE_PORT=3456

COPY --from=build /app /app

VOLUME ["/data", "/workspace"]
EXPOSE 3000 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js", "server", "--host", "0.0.0.0", "--port", "3000", "--bridge-port", "3456"]
