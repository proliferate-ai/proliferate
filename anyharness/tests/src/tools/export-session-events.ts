import { parseArgs } from "node:util";
import {
  exportSessionEvents,
  exportSessionRawNotifications,
  formatExportedSessionEvents,
} from "./session-event-export.js";

interface ParsedCliArgs {
  sessionId: string;
  baseUrl: string;
  authToken?: string;
  afterSeq?: number;
  outPath?: string;
  rawOutPath?: string;
}

export async function runExportSessionEventsCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const events = await exportSessionEvents({
    sessionId: args.sessionId,
    baseUrl: args.baseUrl,
    authToken: args.authToken,
    afterSeq: args.afterSeq,
    outPath: args.outPath,
  });
  if (args.rawOutPath) {
    await exportSessionRawNotifications({
      sessionId: args.sessionId,
      baseUrl: args.baseUrl,
      authToken: args.authToken,
      afterSeq: args.afterSeq,
      outPath: args.rawOutPath,
    });
  }
  if (!args.outPath) {
    process.stdout.write(formatExportedSessionEvents(events));
  }
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "session-id": { type: "string" },
      "base-url": { type: "string" },
      "auth-token": { type: "string" },
      "after-seq": { type: "string" },
      out: { type: "string" },
      "raw-out": { type: "string" },
    },
  });

  const sessionId = values["session-id"]?.trim();
  const baseUrl = values["base-url"]?.trim() || process.env.ANYHARNESS_BASE_URL?.trim();
  const authToken = values["auth-token"]?.trim() || process.env.ANYHARNESS_AUTH_TOKEN?.trim();
  const afterSeqValue = values["after-seq"]?.trim();

  if (!sessionId) {
    throw new Error("--session-id is required");
  }
  if (!baseUrl) {
    throw new Error("--base-url is required");
  }

  return {
    sessionId,
    baseUrl,
    authToken: authToken || undefined,
    afterSeq: afterSeqValue ? Number(afterSeqValue) : undefined,
    outPath: values.out?.trim() || undefined,
    rawOutPath: values["raw-out"]?.trim() || undefined,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExportSessionEventsCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
