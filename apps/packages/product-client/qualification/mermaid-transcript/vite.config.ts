import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const productSrc = fileURLToPath(new URL("../../src", import.meta.url));
const anyharnessSdk = fileURLToPath(new URL("../../../../anyharness/sdk/src/index.ts", import.meta.url));
const anyharnessSdkReact = fileURLToPath(
  new URL("../../../../anyharness/sdk-react/src/index.ts", import.meta.url),
);
const desktopSrc = fileURLToPath(new URL("../../../desktop/src", import.meta.url));
const hostDir = fileURLToPath(new URL("../../src/host", import.meta.url));
const filePathLinkStub = fileURLToPath(
  new URL("../../src/app/authenticated-mermaid-transcript-stubs.tsx", import.meta.url),
);
const highlightStub = fileURLToPath(
  new URL("../../src/app/authenticated-mermaid-transcript-highlight-stub.ts", import.meta.url),
);

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "#product/components/content/ui/FilePathLink",
        replacement: filePathLinkStub,
      },
      {
        find: "#product/hooks/ui/highlighting/use-highlighted-tokens",
        replacement: highlightStub,
      },
      { find: /^#product\//, replacement: `${productSrc}/` },
      { find: /^@proliferate\/product-client\/host\//, replacement: `${hostDir}/` },
      { find: /^@proliferate\/product-client\/internal\//, replacement: `${productSrc}/` },
      { find: /^@anyharness\/sdk-react$/, replacement: anyharnessSdkReact },
      { find: /^@anyharness\/sdk$/, replacement: anyharnessSdk },
      { find: /^@\//, replacement: `${desktopSrc}/` },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    hmr: false,
  },
});
