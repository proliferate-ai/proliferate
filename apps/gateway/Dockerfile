FROM node:20-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/environment ./packages/environment
COPY packages/logger ./packages/logger
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue
COPY packages/gateway-clients ./packages/gateway-clients
COPY packages/triggers ./packages/triggers
COPY packages/services ./packages/services
COPY packages/providers ./packages/providers
COPY packages/db ./packages/db
COPY apps/gateway ./apps/gateway

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build workspace packages
RUN pnpm --filter @proliferate/logger build
RUN pnpm --filter @proliferate/shared build
RUN pnpm --filter @proliferate/environment build
RUN pnpm --filter @proliferate/queue build
RUN pnpm --filter @proliferate/db build
RUN pnpm --filter @proliferate/gateway-clients build
RUN pnpm --filter @proliferate/triggers build
RUN pnpm --filter @proliferate/services build

EXPOSE 8787

WORKDIR /app/apps/gateway

CMD ["pnpm", "start"]
