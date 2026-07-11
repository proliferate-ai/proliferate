import assert from "node:assert/strict";
import test from "node:test";

import {
  checkDocumentVersion,
  compareVersions,
  parseVersion,
} from "./check-version-discipline.mjs";

test("parses and compares date-revision versions", () => {
  assert.deepEqual(parseVersion("2026-07-10.2"), { date: "2026-07-10", revision: 2 });
  assert.equal(parseVersion("v2"), null);
  assert.ok(compareVersions("2026-07-10.2", "2026-07-10.1") > 0);
  assert.ok(compareVersions("2026-07-11.1", "2026-07-10.9") > 0);
});

test("requires a version bump when document content changes", () => {
  const errors = checkDocumentVersion({
    label: "catalog",
    versionKey: "catalogVersion",
    base: { catalogVersion: "2026-07-10.1", agents: ["claude"] },
    current: { catalogVersion: "2026-07-10.1", agents: ["claude", "codex"] },
  });
  assert.deepEqual(errors, ["catalog: content changed without bumping catalogVersion"]);
});

test("accepts changed content with an increasing version", () => {
  const errors = checkDocumentVersion({
    label: "registry",
    versionKey: "registryVersion",
    base: { registryVersion: "2026-07-10.1", agents: ["claude"] },
    current: { registryVersion: "2026-07-10.2", agents: ["claude", "codex"] },
  });
  assert.deepEqual(errors, []);
});

test("rejects a version rollback", () => {
  const errors = checkDocumentVersion({
    label: "catalog",
    versionKey: "catalogVersion",
    base: { catalogVersion: "2026-07-10.2", agents: [] },
    current: { catalogVersion: "2026-07-10.1", agents: [] },
  });
  assert.match(errors.join("\n"), /must increase/);
});
