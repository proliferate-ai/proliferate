// Windows-compatible esbuild script for sandbox-daemon.
// Replaces the CLI bundle script which breaks on Windows due to shell quoting
// of the --banner:js='#!/usr/bin/env node' argument.
import * as esbuild from "esbuild";
import { chmodSync, mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/daemon.cjs",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  external: ["pino-pretty"],
});

chmodSync("dist/daemon.cjs", "755");
console.log("sandbox-daemon bundled → dist/daemon.cjs");
