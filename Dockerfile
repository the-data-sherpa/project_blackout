FROM node:24.21.0-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build-tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM build-tools AS dependencies
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

FROM dependencies AS server-build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/server apps/server
RUN npm run build:contracts && npm run build -w @blackout/server

FROM dependencies AS web-build
COPY tsconfig.base.json ./
COPY scripts scripts
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build:contracts && npm run build -w @blackout/web

FROM build-tools AS server-dependencies
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@blackout/server --workspace=@blackout/contracts

FROM base AS server
ENV NODE_ENV=production API_HOST=0.0.0.0 DATABASE_PATH=/app/data/blackout.sqlite
COPY --from=server-dependencies /app/node_modules ./node_modules
COPY --from=server-build /app/apps/server/package.json ./apps/server/package.json
COPY --from=server-build /app/apps/server/dist ./apps/server/dist
COPY --from=server-build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=server-build /app/packages/contracts/dist ./packages/contracts/dist
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build /app/apps/web/.next/standalone ./
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
