FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8.15.1 --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/environment ./packages/environment
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue
COPY packages/gateway-clients ./packages/gateway-clients
COPY packages/db ./packages/db
COPY packages/triggers ./packages/triggers
COPY packages/services ./packages/services
COPY apps/web ./apps/web

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first
RUN pnpm --filter @proliferate/environment build
RUN pnpm --filter @proliferate/shared build
RUN pnpm --filter @proliferate/queue build
RUN pnpm --filter @proliferate/db build
RUN pnpm --filter @proliferate/gateway-clients build
RUN pnpm --filter @proliferate/triggers build
RUN pnpm --filter @proliferate/services build

# Build Next.js with standalone output
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_BUILD_STANDALONE=true
# Skip Sentry during Docker builds if no token
ENV SENTRY_AUTH_TOKEN=""
ENV SKIP_ENV_VALIDATION=true
ENV RESEND_API_KEY=re_123
ENV EMAIL_FROM=noreply@example.com
ENV BETTER_AUTH_SECRET=dev-secret
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:8787
ARG NEXT_PUBLIC_BILLING_ENABLED=false
ARG NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=false
ARG NEXT_PUBLIC_INTEGRATIONS_ENABLED=false
ARG NEXT_PUBLIC_SENTRY_DSN=https://example.invalid/1
ARG NEXT_PUBLIC_GITHUB_APP_SLUG=local
ARG NEXT_PUBLIC_INTERCOM_APP_ID=local
ARG NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID=local
ARG NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID=local
ARG NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID=local
ARG NEXT_PUBLIC_POSTHOG_HOST=
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_USE_NANGO_GITHUB=false
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL}
ENV NEXT_PUBLIC_BILLING_ENABLED=${NEXT_PUBLIC_BILLING_ENABLED}
ENV NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=${NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION}
ENV NEXT_PUBLIC_INTEGRATIONS_ENABLED=${NEXT_PUBLIC_INTEGRATIONS_ENABLED}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_GITHUB_APP_SLUG=${NEXT_PUBLIC_GITHUB_APP_SLUG}
ENV NEXT_PUBLIC_INTERCOM_APP_ID=${NEXT_PUBLIC_INTERCOM_APP_ID}
ENV NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID=${NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID}
ENV NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID=${NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID}
ENV NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID=${NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID}
ENV NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}
ENV NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY}
ENV NEXT_PUBLIC_USE_NANGO_GITHUB=${NEXT_PUBLIC_USE_NANGO_GITHUB}
ENV SERVICE_TO_SERVICE_AUTH_TOKEN=dev-token
ENV USER_SECRETS_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

RUN pnpm --filter @proliferate/web build

# Production image
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV WEB_PORT=3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "PORT=${WEB_PORT:-${PORT:-3000}} node apps/web/server.js"]
