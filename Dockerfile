# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=kora-admin-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build

COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# Prisma generation only needs a syntactically valid datasource URL; it does
# not connect to the database. Runtime and migration containers receive the
# real secret from Compose's env_file, never from the image build context.
RUN DATABASE_URL=postgresql://image_build:image_build@127.0.0.1:5432/image_build pnpm prisma:generate \
    && pnpm build

FROM dependencies AS production-dependencies

RUN pnpm prune --prod

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3006

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json

USER node

EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3006/api/health/live').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/main.js"]

FROM build AS migrate

CMD ["pnpm", "prisma:migrate:deploy"]
