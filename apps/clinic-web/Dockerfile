# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/clinic-web/Dockerfile .
# The app is static files behind nginx; kamal-proxy terminates TLS and routes /api to the API container.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# No prompts and no git hook installation (lefthook) inside the image build.
ENV CI=true
RUN npm install -g pnpm@10.33.0 turbo@2.11.10
WORKDIR /app

FROM base AS prune
COPY . .
RUN turbo prune @vetora/clinic-web --docker

FROM base AS build
ARG SENTRY_ORG
ARG SENTRY_PROJECT
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# With the SENTRY_AUTH_TOKEN build secret present (CI), hidden source maps are uploaded and deleted from dist.
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)" \
    SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" \
    pnpm turbo run build --filter=@vetora/clinic-web
# Without a Sentry token the maps are still in dist; they must not reach the image.
RUN find apps/clinic-web/dist -name "*.map" -delete

FROM nginx:1.29-alpine AS deploy
COPY apps/clinic-web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/clinic-web/docker/10-runtime-config.sh /docker-entrypoint.d/10-runtime-config.sh
COPY --from=build /app/apps/clinic-web/dist /usr/share/nginx/html
EXPOSE 80
