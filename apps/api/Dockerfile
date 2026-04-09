# ===========================================
# Studio Beatriz Beltrão — API Dockerfile
# Multi-stage build for Turborepo monorepo
# ===========================================

# Stage 1: Builder
FROM node:22-alpine AS builder

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config files first (for better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json tsconfig.json ./

# Copy package.json for each workspace package
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ts-config/ packages/ts-config/
COPY packages/eslint-config/package.json packages/eslint-config/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Copy source code for API and its workspace dependencies
COPY apps/api/ apps/api/
COPY packages/db/ packages/db/
COPY packages/shared/ packages/shared/

# Copy assets (service-reference.yaml + PDF catalogs used by Sophia)
COPY assets/ assets/

# Build the API and its dependencies
RUN pnpm build --filter=@studio/api...

# Stage 2: Runner
FROM node:22-alpine AS runner

# Install pnpm and Google Workspace CLI (required for Google Calendar integration)
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
    && npm install -g @googleworkspace/cli \
    && apk add --no-cache curl

WORKDIR /app

# Copy the full workspace structure (built)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc /app/turbo.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/apps/api/dist/ ./apps/api/dist/
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/node_modules/ ./apps/api/node_modules/
COPY --from=builder /app/packages/db/dist/ ./packages/db/dist/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/node_modules/ ./packages/db/node_modules/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/node_modules/ ./packages/shared/node_modules/

# Copy assets (service-reference.yaml + PDF catalogs used by Sophia)
COPY --from=builder /app/assets/ ./assets/

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
