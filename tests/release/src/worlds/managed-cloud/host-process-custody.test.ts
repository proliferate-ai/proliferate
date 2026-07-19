import assert from "node:assert/strict";
import { test } from "node:test";

import {
  captureHostProcessCustody,
  capturePlaywrightBrowserCustody,
  decodeHostProcessCustody,
  stopHostProcessFromCustody,
  type HostProcessCustodyDeps,
  type HostProcessSnapshot,
} from "./host-process-custody.js";

function snapshot(overrides: Partial<HostProcessSnapshot> = {}): HostProcessSnapshot {
  return {
    pid: 44,
    parentPid: 10,
    starttime: "9001",
    executable: "/usr/bin/node",
    argv: ["/usr/bin/node", "-e", "server", "/owned/renderer"],
    ...overrides,
  };
}

function deps(rows: HostProcessSnapshot[]): { value: HostProcessCustodyDeps; signals: string[] } {
  const current = new Map(rows.map((row) => [row.pid, row]));
  const signals: string[] = [];
  return {
    signals,
    value: {
      async readProcess(pid) {
        return current.get(pid) ?? null;
      },
      async listProcesses() {
        return [...current.values()];
      },
      signal(pid, signal) {
        signals.push(`${pid}:${signal}`);
        current.delete(pid);
      },
      async sleep() {},
    },
  };
}

test("captures and stops only an exact renderer process", async () => {
  const harness = deps([snapshot()]);
  const encoded = await captureHostProcessCustody(44, "/owned/renderer", harness.value);
  assert.ok(encoded);
  assert.equal(decodeHostProcessCustody(encoded)?.starttime, "9001");
  await stopHostProcessFromCustody(encoded, harness.value);
  assert.deepEqual(harness.signals, ["44:SIGTERM"]);
});

test("a reused pid is reconciled without signalling the replacement", async () => {
  const original = deps([snapshot()]);
  const encoded = await captureHostProcessCustody(44, "/owned/renderer", original.value);
  const replacement = deps([snapshot({ starttime: "9002", argv: ["unrelated"] })]);
  await stopHostProcessFromCustody(encoded, replacement.value);
  assert.deepEqual(replacement.signals, []);
});

test("browser custody requires one direct remote-debugging child and exact profile marker", async () => {
  const browser = snapshot({
    pid: 55,
    parentPid: 999,
    executable: "/opt/chrome/chrome",
    argv: ["chrome", "--remote-debugging-pipe", "--user-data-dir=/tmp/pw-owned"],
  });
  const harness = deps([browser]);
  const encoded = await capturePlaywrightBrowserCustody(999, harness.value);
  assert.equal(decodeHostProcessCustody(encoded ?? "")?.marker, "--user-data-dir=/tmp/pw-owned");
  assert.equal(await capturePlaywrightBrowserCustody(998, harness.value), null);
});

test("unverifiable legacy pid identities fail closed", async () => {
  await assert.rejects(() => stopHostProcessFromCustody("pid:44", deps([]).value), /not independently replayable/);
});
