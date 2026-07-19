import { readdir, readFile, readlink } from "node:fs/promises";

const PROCESS_IDENTITY_PREFIX = "host-process-v1:";
export const RENDERER_PROCESS_INTENT_PREFIX = "process-intent:renderer:";

export interface HostProcessSnapshot {
  pid: number;
  parentPid: number;
  starttime: string;
  executable: string;
  argv: string[];
}

export interface HostProcessCustodyV1 {
  schema_version: 1;
  pid: number;
  starttime: string;
  executable: string;
  marker: string;
}

export interface HostProcessCustodyDeps {
  readProcess(pid: number): Promise<HostProcessSnapshot | null>;
  listProcesses(): Promise<HostProcessSnapshot[]>;
  signal(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
}

async function readLinuxProcess(pid: number): Promise<HostProcessSnapshot | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(") ");
    if (close < 0) {
      throw new Error(`process ${pid} has malformed /proc stat data.`);
    }
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const parentPid = Number(fields[1]);
    const starttime = fields[19];
    if (!Number.isSafeInteger(parentPid) || parentPid < 0 || !starttime || !/^\d+$/.test(starttime)) {
      throw new Error(`process ${pid} has malformed ownership fields.`);
    }
    const [executable, cmdline] = await Promise.all([
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/cmdline`),
    ]);
    return {
      pid,
      parentPid,
      starttime,
      executable,
      argv: cmdline.toString().split("\0").filter(Boolean),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const DEFAULT_DEPS: HostProcessCustodyDeps = {
  readProcess: readLinuxProcess,
  async listProcesses() {
    let names: string[];
    try {
      names = await readdir("/proc");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const snapshots = await Promise.all(
      names.filter((name) => /^\d+$/.test(name)).map((name) => readLinuxProcess(Number(name))),
    );
    return snapshots.filter((row): row is HostProcessSnapshot => row !== null);
  },
  signal(pid, signal) {
    process.kill(pid, signal);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function encode(identity: HostProcessCustodyV1): string {
  return `${PROCESS_IDENTITY_PREFIX}${Buffer.from(JSON.stringify(identity)).toString("base64url")}`;
}

export function decodeHostProcessCustody(value: string): HostProcessCustodyV1 | null {
  if (!value.startsWith(PROCESS_IDENTITY_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value.slice(PROCESS_IDENTITY_PREFIX.length), "base64url").toString("utf8"),
    ) as Partial<HostProcessCustodyV1>;
    if (
      parsed.schema_version !== 1 ||
      !Number.isSafeInteger(parsed.pid) ||
      (parsed.pid ?? 0) <= 0 ||
      typeof parsed.starttime !== "string" ||
      !/^\d+$/.test(parsed.starttime) ||
      typeof parsed.executable !== "string" ||
      !parsed.executable.startsWith("/") ||
      typeof parsed.marker !== "string" ||
      parsed.marker.length < 2
    ) {
      return null;
    }
    return parsed as HostProcessCustodyV1;
  } catch {
    return null;
  }
}

/** Captures a child only when `/proc` proves its exact executable and argv marker. */
export async function captureHostProcessCustody(
  pid: number | undefined,
  marker: string,
  deps: HostProcessCustodyDeps = DEFAULT_DEPS,
): Promise<string | null> {
  if (!pid || pid <= 0 || marker.length < 2) {
    return null;
  }
  const snapshot = await deps.readProcess(pid);
  if (!snapshot || !snapshot.argv.some((arg) => arg.includes(marker))) {
    return null;
  }
  return encode({
    schema_version: 1,
    pid,
    starttime: snapshot.starttime,
    executable: snapshot.executable,
    marker,
  });
}

/** Finds Playwright's one direct Chromium child and records its unique profile path. */
export async function capturePlaywrightBrowserCustody(
  parentPid: number,
  deps: HostProcessCustodyDeps = DEFAULT_DEPS,
): Promise<string | null> {
  const rows = await deps.listProcesses();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const descendsFrom = (row: HostProcessSnapshot): boolean => {
    const seen = new Set<number>();
    let next = row.parentPid;
    while (next > 0 && !seen.has(next)) {
      if (next === parentPid) return true;
      seen.add(next);
      next = byPid.get(next)?.parentPid ?? 0;
    }
    return false;
  };
  const matches = rows.filter((row) => {
    const marker = row.argv.find((arg) => arg.startsWith("--user-data-dir="));
    return descendsFrom(row) && row.argv.includes("--remote-debugging-pipe") && Boolean(marker);
  });
  if (matches.length !== 1) {
    return null;
  }
  const snapshot = matches[0]!;
  const marker = snapshot.argv.find((arg) => arg.startsWith("--user-data-dir="))!;
  return encode({
    schema_version: 1,
    pid: snapshot.pid,
    starttime: snapshot.starttime,
    executable: snapshot.executable,
    marker,
  });
}

/**
 * Stops only the exact original process. A missing process or reused PID is
 * already reconciled; an unverifiable identity fails closed without signalling.
 */
export async function stopHostProcessFromCustody(
  providerId: string | null,
  deps: HostProcessCustodyDeps = DEFAULT_DEPS,
): Promise<void> {
  if (providerId?.startsWith(RENDERER_PROCESS_INTENT_PREFIX)) {
    const marker = providerId.slice(RENDERER_PROCESS_INTENT_PREFIX.length);
    if (!marker.startsWith("/")) {
      throw new Error("renderer process intent marker is malformed.");
    }
    const matches = (await deps.listProcesses()).filter((row) =>
      row.argv.some((arg) => arg.includes(marker)),
    );
    if (matches.length > 1) {
      throw new Error("renderer process intent resolved ambiguously.");
    }
    if (matches.length === 0) return;
    const match = matches[0]!;
    providerId = encode({
      schema_version: 1,
      pid: match.pid,
      starttime: match.starttime,
      executable: match.executable,
      marker,
    });
  }
  const identity = decodeHostProcessCustody(providerId ?? "");
  if (!identity) {
    throw new Error("host process cleanup identity is not independently replayable.");
  }
  const live = await deps.readProcess(identity.pid);
  if (!live) {
    return;
  }
  if (
    live.starttime !== identity.starttime ||
    live.executable !== identity.executable ||
    !live.argv.some((arg) => arg.includes(identity.marker))
  ) {
    return; // PID was reused; the owned process is gone. Never signal the replacement.
  }
  deps.signal(identity.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await deps.sleep(100);
    if (!(await deps.readProcess(identity.pid))) {
      return;
    }
  }
  const afterTerm = await deps.readProcess(identity.pid);
  if (
    !afterTerm ||
    afterTerm.starttime !== identity.starttime ||
    afterTerm.executable !== identity.executable ||
    !afterTerm.argv.some((arg) => arg.includes(identity.marker))
  ) {
    return;
  }
  deps.signal(identity.pid, "SIGKILL");
  await deps.sleep(100);
  const afterKill = await deps.readProcess(identity.pid);
  if (afterKill?.starttime === identity.starttime) {
    throw new Error("owned host process remained alive after SIGKILL.");
  }
}
