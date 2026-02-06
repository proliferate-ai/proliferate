import { Template } from "e2b";

/**
 * Proliferate Base Template
 *
 * Full development environment with:
 * - Node.js 20 with pnpm/yarn
 * - Python 3.11 with uv/pip
 * - PostgreSQL 15
 * - Redis
 * - Mailcatcher
 * - Caddy (for preview proxy)
 * - Playwright with Chromium
 * - Docker & Docker Compose
 * - OpenCode CLI
 */
export const template = Template().fromDockerfile("e2b.Dockerfile");
