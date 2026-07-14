import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The five non-conflicting ports a local world binds (spec "World startup"
 * step 1). Allocated up front by the candidate builder
 * (`scripts/ci-cd/build-local-qualification-candidates.mjs`) — `server` and
 * `anyharness` are baked into the Desktop renderer's build-time VITE_* URLs —
 * so the world MUST reuse this exact allocation rather than re-probing.
 *
 * Kept in this leaf module (fs only, no Playwright/Docker) so both the world
 * constructor and the CLI (`cli/command.ts`, `cli/run.ts`) can consume it
 * without pulling in the heavy world graph.
 */
export interface LocalWorldPorts {
  server: number;
  postgres: number;
  redis: number;
  anyharness: number;
  renderer: number;
}

/** Filename of the ports sidecar the builder writes next to `candidate-build.json`. */
export const LOCAL_WORLD_PORTS_FILENAME = "local-world-ports.json";

const PORT_KEYS = ["server", "postgres", "redis", "anyharness", "renderer"] as const;

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65_536;
}

/** Parses and validates a ports payload; throws on any malformed field. */
export function parseLocalWorldPorts(raw: unknown, source: string): LocalWorldPorts {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: expected a JSON object of port assignments.`);
  }
  const record = raw as Record<string, unknown>;
  const ports = {} as LocalWorldPorts;
  for (const key of PORT_KEYS) {
    const value = record[key];
    if (!isValidPort(value)) {
      throw new Error(`${source}: "${key}" must be an integer TCP port (1-65535), got ${JSON.stringify(value)}.`);
    }
    ports[key] = value;
  }
  return ports;
}

/**
 * Reads the run directory's `local-world-ports.json` sidecar. Returns `null`
 * when the file is absent (a diagnostic run may omit it; the world scenario
 * then fails closed with a bounded reason), and throws when it exists but is
 * malformed.
 */
export async function readLocalWorldPortsFile(runDir: string): Promise<LocalWorldPorts | null> {
  const filePath = path.join(runDir, LOCAL_WORLD_PORTS_FILENAME);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
  return parseLocalWorldPorts(parsed, filePath);
}
