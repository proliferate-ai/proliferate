import { Template } from "e2b";

/**
 * Proliferate Base Template
 *
 * Full development environment with:
 * - Node.js 20 with pnpm/yarn
 * - Python 3.11 with uv/pip
 * - Caddy (for preview proxy)
 * - Docker & Docker Compose
 * - OpenCode CLI
 */
export const template = Template().fromDockerfile("e2b.Dockerfile");
