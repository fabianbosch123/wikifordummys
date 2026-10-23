# Build-Kontext ist das Wurzelverzeichnis des Repositorys:
#   docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @wiki/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @wiki/shared build && pnpm --filter @wiki/api build
# Nur Produktionsabhängigkeiten in ein eigenes Verzeichnis
RUN pnpm --filter @wiki/api deploy --prod --legacy /out \
 && cd /out && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && cp -r /repo/apps/api/dist /out/dist

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# Anhänge liegen außerhalb des Web-Roots in einem eigenen Volume (S7); ein neues Volume übernimmt diese Rechte
RUN mkdir -p /var/lib/wiki/attachments && chown node:node /var/lib/wiki/attachments && chmod 700 /var/lib/wiki/attachments
USER node
EXPOSE 3001
# Migrationen beim Start einspielen, dann die API starten
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && exec node dist/main.js"]
