FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

WORKDIR /app

# Copy only what's needed for migrations
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/environment ./packages/environment
COPY packages/logger ./packages/logger
COPY packages/db ./packages/db

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @proliferate/db...

# Build the environment package (required by drizzle config)
RUN pnpm --filter @proliferate/environment build
RUN pnpm --filter @proliferate/logger build
RUN pnpm --filter @proliferate/db build

CMD ["pnpm", "--filter", "@proliferate/db", "db:migrate"]
