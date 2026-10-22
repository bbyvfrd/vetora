# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile .
# Turborepo's prune pattern (node_modules/turbo/docs/guides/tools/docker.mdx): install only what the API needs.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.33.0 turbo@2.11.10
WORKDIR /app

FROM base AS prune
COPY . .
RUN turbo prune @vetora/api --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@vetora/api

FROM base AS deploy
ENV NODE_ENV=production
# Readable stack traces from the shipped source maps without uploading them anywhere.
ENV NODE_OPTIONS=--enable-source-maps
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
