import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Emit the gitignored `src/generated/agent-*.json` before any test collects.
 *
 * `bundled-agent-catalog.ts` and `provider-config-fields.ts` import those two
 * documents with `?raw`, so every test whose module graph reaches them fails to
 * resolve on a fresh checkout. The documents are copies of
 * `catalogs/agents/{catalog,registry}.json` and are deliberately not committed
 * (no checked-in duplicate of the repo-root catalog), which leaves the test lane
 * depending on a step only `build`/`prepare` used to run.
 *
 * This runs that same generator — `scripts/copy-product-client-assets.mjs`, the
 * one the package build already calls — and nothing else. No `tsc`, no
 * workspace build: a single-file `vitest run <path>` is enough to make the lane
 * self-sufficient, and the generated files stay out of git.
 */
export default function setup(): void {
  const script = fileURLToPath(
    new URL("./scripts/copy-product-client-assets.mjs", import.meta.url),
  );
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}
