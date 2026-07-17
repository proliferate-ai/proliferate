import { createServer } from "node:http";

import { armPostReportExitWatchdog } from "./exit-watchdog.js";

const mode = process.argv[2];
if (mode === "leak") {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  console.log("Combined report written: fixture-report.json");
  process.exitCode = 0;
  armPostReportExitWatchdog({ graceMs: 75 });
} else if (mode === "clean") {
  console.log("Combined report written: fixture-report.json");
  process.exitCode = 0;
  armPostReportExitWatchdog({ graceMs: 5_000 });
} else {
  throw new Error(`unknown fixture mode: ${mode ?? "<missing>"}`);
}
