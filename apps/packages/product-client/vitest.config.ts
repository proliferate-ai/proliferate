import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// In-package `#product/*` imports resolve to source under test (never dist),
// mirroring the tsconfig `paths` mapping. Runtime resolution is a separate
// concern: package.json `imports` points `#product/*` at compiled `dist`.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// The moved product tree imports the AnyHarness SDK/React packages by their
// public specifiers. Tests run against those packages' source (as the Desktop
// vitest config did) so they do not require a prior build.
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

export default defineConfig({
  resolve: {
    // Force a single React instance across the package boundary. Without this,
    // a moved component (e.g. AutomationRunLocationSelector) can render against a
    // second React copy resolved through the package's own node_modules, which
    // breaks hooks/jsdom rendering in the moved test lane (R5 ruling).
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^#product\//, replacement: `${srcDir}/` },
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
    // Inject the retained Desktop measurement engine as the port sink.
    setupFiles: ["./vitest.setup.ts"],
  },
});
