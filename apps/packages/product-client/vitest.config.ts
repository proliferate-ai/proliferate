import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// In-package `#product/*` imports resolve to source under test (never dist),
// mirroring the tsconfig `paths` mapping. Runtime resolution is a separate
// concern: package.json `imports` points `#product/*` at compiled `dist`.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// The moved product tree imports the AnyHarness SDK/React packages by their
// public specifiers. Tests run against those packages' source (as the Desktop
// vitest config did) so they do not require a prior build.
//
// Resolving that source needs `anyharness/sdk-react/node_modules` to exist,
// which a normal `pnpm install` creates. It is deliberately NOT aliased or
// stubbed here: when it is missing, the cause is a checkout whose
// `node_modules` were symlinked in from another clone rather than installed
// (donor-symlink dev setups, review worktrees), and the fix belongs in that
// checkout — `pnpm install`, or the same symlink for that directory. Papering
// it into committed config would hide a real install failure from CI.
const anyharnessSdk = fileURLToPath(
  new URL("../../../anyharness/sdk/src/index.ts", import.meta.url),
);
const anyharnessSdkReact = fileURLToPath(
  new URL("../../../anyharness/sdk-react/src/index.ts", import.meta.url),
);

// The test lane injects the retained Desktop measurement engine as the sink
// (see `vitest.setup.ts`, ruling R1). That engine resolves its own `@/*`
// specifiers against Desktop `src`; map them here for the test lane only.
// Product-client source itself has zero `@/*` imports (all rewritten to
// `#product/*`), so this alias only affects the injected Desktop modules.
const desktopSrc = fileURLToPath(new URL("../../desktop/src", import.meta.url));

// A handful of modules import the package's own host surface by its PUBLIC
// specifier (`@proliferate/product-client/host/*`) rather than through
// `#product/*`. That subpath is an `exports` entry pointing at compiled `dist`,
// so in the test lane it resolves only after a package build — and any test
// whose graph touches one of those modules is unrunnable without one. Mapping
// the public subpath at source, exactly as `#product/*` is mapped above, keeps
// the same "tests run against source, never dist" rule the config already
// states, instead of making a build a precondition for running one file.
const hostDir = fileURLToPath(new URL("./src/host", import.meta.url));

// The retained Desktop measurement engine injected by `vitest.setup.ts`
// reaches the diagnostics port back through the sibling
// `@proliferate/product-client/internal/*` subpath, which is mapped to
// source for the same reason (see the alias above).
const internalDir = srcDir;

export default defineConfig({
  resolve: {
    // Force a single React instance across the package boundary. Without this,
    // a moved component (e.g. AutomationRunLocationSelector) can render against a
    // second React copy resolved through the package's own node_modules, which
    // breaks hooks/jsdom rendering in the moved test lane (R5 ruling).
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^#product\//, replacement: `${srcDir}/` },
      { find: /^@proliferate\/product-client\/host\//, replacement: `${hostDir}/` },
      { find: /^@proliferate\/product-client\/internal\//, replacement: `${internalDir}/` },
      { find: /^@anyharness\/sdk-react$/, replacement: anyharnessSdkReact },
      { find: /^@anyharness\/sdk$/, replacement: anyharnessSdk },
      { find: /^@\//, replacement: `${desktopSrc}/` },
    ],
  },
  test: {
    // Node by default (as Desktop); jsdom is opted in per-file via a
    // `// @vitest-environment jsdom` pragma where a DOM is required.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `src/generated/agent-*.json` is gitignored and produced by the package's
    // own asset step, which today only runs as part of `build`/`prepare`. Any
    // test whose graph reaches `bundled-agent-catalog.ts` therefore fails on a
    // fresh checkout. Running the existing generator here — not committing its
    // output, and not building the package — makes the test lane self-sufficient
    // for a single-file run.
    globalSetup: ["./vitest.global-setup.ts"],
    // Inject the retained Desktop measurement engine as the port sink.
    setupFiles: ["./vitest.setup.ts"],
  },
});
