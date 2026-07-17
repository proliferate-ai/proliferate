import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { E2bTemplateReceipt } from "./template.js";
import {
  SHARED_TEMPLATE_CUSTODY_KIND,
  assertSharedTemplateReceiptBinding,
  loadSharedTemplateCustody,
  markSharedTemplateAcquired,
  markSharedTemplateIntentReleasedWithoutAcquire,
  markSharedTemplateReleased,
  recordSharedTemplateIntent,
  sharedTemplateCustodyPath,
  type SharedTemplateCustodyClock,
  type SharedTemplateCustodyIdentityV1,
} from "./shared-template-custody.js";

const SOURCE_SHA = "a".repeat(40);
const INPUT_HASH = "b".repeat(64);
const TEMPLATE_NAME = "proliferate-runtime-qual-run-1";

function identity(overrides: Partial<SharedTemplateCustodyIdentityV1> = {}): SharedTemplateCustodyIdentityV1 {
  return {
    runId: "run-1",
    shardId: "shard-1",
    sourceSha: SOURCE_SHA,
    templateName: TEMPLATE_NAME,
    inputHash: INPUT_HASH,
    ...overrides,
  };
}

function receipt(overrides: Partial<E2bTemplateReceipt> = {}): E2bTemplateReceipt {
  return {
    artifact_id: `e2b-template/${TEMPLATE_NAME}`,
    templateId: "tmpl_immutable_1",
    buildId: "build_immutable_1",
    inputHash: INPUT_HASH,
    bakedInputs: [
      { destination: "/home/user/anyharness", sha256: "1".repeat(64) },
      { destination: "/home/user/.proliferate/bin/proliferate-worker", sha256: "2".repeat(64) },
      { destination: "/home/user/.proliferate/bin/proliferate-supervisor", sha256: "3".repeat(64) },
      { destination: "/home/user/.proliferate/bin/proliferate-git-credential-helper", sha256: "4".repeat(64) },
    ],
    ...overrides,
  };
}

function clock(iso: string): SharedTemplateCustodyClock {
  return { now: () => new Date(iso) };
}

async function withTempRun(fn: (runDir: string, filePath: string) => Promise<void>): Promise<void> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "shared-template-custody-"));
  try {
    await fn(runDir, sharedTemplateCustodyPath(runDir));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

test("intent is an atomic owner-only strict journal under the parent cleanup-custody directory", async () => {
  await withTempRun(async (runDir, filePath) => {
    const created = await recordSharedTemplateIntent(
      filePath,
      identity(),
      clock("2026-07-17T10:00:00.000Z"),
    );
    assert.deepEqual(created, {
      schema_version: 1,
      kind: SHARED_TEMPLATE_CUSTODY_KIND,
      run_id: "run-1",
      shard_id: "shard-1",
      source_sha: SOURCE_SHA,
      template_name: TEMPLATE_NAME,
      input_hash: INPUT_HASH,
      state: "intent",
      created_at: "2026-07-17T10:00:00.000Z",
      updated_at: "2026-07-17T10:00:00.000Z",
      receipt: null,
      released_at: null,
    });
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(filePath))).mode & 0o777, 0o700);
    assert.deepEqual(
      (await readdir(path.dirname(filePath))).filter((name) => name.endsWith(".tmp")),
      [],
    );
    assert.deepEqual(await loadSharedTemplateCustody(filePath, identity()), created);
    assert.equal(path.dirname(filePath), path.join(runDir, "cleanup-custody"));
  });
});

test("intent → acquired → released is monotonic, receipt-bound, and idempotent", async () => {
  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity(), clock("2026-07-17T10:00:00.000Z"));
    const acquired = await markSharedTemplateAcquired(
      filePath,
      identity(),
      receipt(),
      clock("2026-07-17T10:00:01.000Z"),
    );
    assert.equal(acquired.state, "acquired");
    assert.deepEqual(acquired.receipt, receipt());
    assert.deepEqual(
      await markSharedTemplateAcquired(
        filePath,
        identity(),
        receipt(),
        clock("2026-07-17T10:00:02.000Z"),
      ),
      acquired,
    );

    const released = await markSharedTemplateReleased(
      filePath,
      identity(),
      receipt(),
      clock("2026-07-17T10:00:03.000Z"),
    );
    assert.equal(released.state, "released");
    assert.equal(released.released_at, "2026-07-17T10:00:03.000Z");
    assert.deepEqual(
      await markSharedTemplateReleased(
        filePath,
        identity(),
        receipt(),
        clock("2026-07-17T10:00:04.000Z"),
      ),
      released,
    );
    await assert.rejects(recordSharedTemplateIntent(filePath, identity()), /cannot be reopened/);
    await assert.rejects(markSharedTemplateAcquired(filePath, identity(), receipt()), /cannot be reacquired/);
  });
});

test("run, shard, source, and input-hash mismatches reject without changing bytes", async () => {
  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity());
    const before = await readFile(filePath);
    const mismatches: SharedTemplateCustodyIdentityV1[] = [
      identity({ runId: "run-2", templateName: "proliferate-runtime-qual-run-2" }),
      identity({ shardId: "shard-2" }),
      identity({ sourceSha: "c".repeat(40) }),
      identity({ inputHash: "d".repeat(64) }),
    ];
    for (const mismatch of mismatches) {
      await assert.rejects(loadSharedTemplateCustody(filePath, mismatch), /does not belong to this run/);
      await assert.rejects(markSharedTemplateAcquired(filePath, mismatch, receipt()), /does not belong to this run/);
      assert.deepEqual(await readFile(filePath), before);
    }
    await assert.rejects(
      loadSharedTemplateCustody(filePath, identity({ templateName: "different-template" })),
      /exact run-derived qualification template name/,
    );
    assert.deepEqual(await readFile(filePath), before);
  });
});

test("receipt template and input identity must match the pre-create intent", async () => {
  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity());
    await assert.rejects(
      markSharedTemplateAcquired(filePath, identity(), receipt({ artifact_id: "e2b-template/other" })),
      /artifact_id does not match/,
    );
    await assert.rejects(
      markSharedTemplateAcquired(filePath, identity(), receipt({ inputHash: "e".repeat(64) })),
      /inputHash does not match/,
    );
    assert.equal((await loadSharedTemplateCustody(filePath)).state, "intent");
  });
});

test("a conflicting second provider receipt cannot overwrite first-write custody", async () => {
  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity());
    const first = receipt();
    await markSharedTemplateAcquired(filePath, identity(), first);
    const before = await readFile(filePath);
    await assert.rejects(
      markSharedTemplateAcquired(filePath, identity(), receipt({ templateId: "tmpl_other" })),
      /different receipt/,
    );
    await assert.rejects(
      markSharedTemplateReleased(filePath, identity(), receipt({ buildId: "build_other" })),
      /does not match/,
    );
    assert.deepEqual(await readFile(filePath), before);
    assert.deepEqual((await loadSharedTemplateCustody(filePath)).receipt, first);
  });
});

test("intent-only absence uses an explicit release transition and can never discard an acquired receipt", async () => {
  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity(), clock("2026-07-17T10:00:00.000Z"));
    const released = await markSharedTemplateIntentReleasedWithoutAcquire(
      filePath,
      identity(),
      clock("2026-07-17T10:00:01.000Z"),
    );
    assert.equal(released.state, "released");
    assert.equal(released.receipt, null);
    assert.deepEqual(await markSharedTemplateIntentReleasedWithoutAcquire(filePath, identity()), released);
    await assert.rejects(markSharedTemplateReleased(filePath, identity(), receipt()), /does not match/);
  });

  await withTempRun(async (_runDir, filePath) => {
    await recordSharedTemplateIntent(filePath, identity());
    await markSharedTemplateAcquired(filePath, identity(), receipt());
    await assert.rejects(
      markSharedTemplateIntentReleasedWithoutAcquire(filePath, identity()),
      /must be released with its exact receipt/,
    );
  });
});

test("loader rejects unknown fields, invalid phase shapes, noncanonical timestamps, and loose permissions", async () => {
  await withTempRun(async (_runDir, filePath) => {
    const intent = await recordSharedTemplateIntent(filePath, identity());
    await writeFile(filePath, JSON.stringify({ ...intent, surprise: true }), { mode: 0o600 });
    await assert.rejects(loadSharedTemplateCustody(filePath), /invalid keys/);

    await writeFile(filePath, JSON.stringify({ ...intent, receipt: receipt() }), { mode: 0o600 });
    await assert.rejects(loadSharedTemplateCustody(filePath), /Intent custody must have null receipt/);

    await writeFile(filePath, JSON.stringify({ ...intent, updated_at: "2026-07-17 10:00:00" }), { mode: 0o600 });
    await assert.rejects(loadSharedTemplateCustody(filePath), /canonical ISO-8601/);

    await writeFile(filePath, JSON.stringify(intent), { mode: 0o600 });
    await chmod(filePath, 0o644);
    await assert.rejects(loadSharedTemplateCustody(filePath), /mode 0600/);
  });
});

test("loader rejects symlinks and receipt fields that are unsafe or structurally ambiguous", async () => {
  await withTempRun(async (runDir, filePath) => {
    const target = path.join(runDir, "target.json");
    await writeFile(target, "{}", { mode: 0o600 });
    await recordSharedTemplateIntent(filePath, identity());
    await rm(filePath);
    await (await import("node:fs/promises")).symlink(target, filePath);
    assert.equal((await lstat(filePath)).isSymbolicLink(), true);
    await assert.rejects(loadSharedTemplateCustody(filePath), /regular file/);
  });

  assert.throws(
    () => assertSharedTemplateReceiptBinding(identity(), receipt({ templateId: "unsafe id" })),
    /safe bounded provider identifier/,
  );
  assert.throws(
    () =>
      assertSharedTemplateReceiptBinding(
        identity(),
        receipt({
          bakedInputs: [
            { destination: "/home/user/duplicate", sha256: "1".repeat(64) },
            { destination: "/home/user/duplicate", sha256: "2".repeat(64) },
          ],
        }),
      ),
    /unique paths/,
  );
});
