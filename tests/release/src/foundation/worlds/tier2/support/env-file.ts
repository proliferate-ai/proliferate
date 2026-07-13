/**
 * Parse a `KEY=value` / `export KEY=value` file as pure data — never `source`
 * it as shell (per this workstream's hard rule: local secrets load by parsing,
 * ambient environment wins). Used to read Stripe test-mode credentials out of
 * `~/.proliferate-local/dev/release-e2e.env` without ever executing it.
 */

import { readFileSync } from "node:fs";

export function parseEnvFileAsData(filePath: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const result: Record<string, string> = {};
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}
