FROM node:22-bookworm-slim AS build

WORKDIR /usr/src/app

# sqlite3 is a native module and ships prebuilt binaries for some platforms
# only. The toolchain is installed here and deliberately absent from the
# runtime stage, so the shipped image does not carry a compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4040 \
    DATA_DIR=/usr/src/app/data

WORKDIR /usr/src/app

# curl is only here to serve the healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app/data

USER node

EXPOSE 4040

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4040/healthz || exit 1

CMD ["node", "src/server.js"]
