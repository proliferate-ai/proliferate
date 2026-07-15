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
  new URL("../../anyharness/sdk/src/index.ts", import.meta.url),
);
const anyharnessSdkReact = fileURLToPath(
  new URL("../../anyharness/sdk-react/src/index.ts", import.meta.url),
);

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
    ],
  },
  test: {
    // Node by default (as Desktop); jsdom is opted in per-file via a
    // `// @vitest-environment jsdom` pragma where a DOM is required.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
