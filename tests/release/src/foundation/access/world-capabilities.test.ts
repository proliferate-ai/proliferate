import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ALL_WORLDS } from "../contracts/identity.js";
import { capabilityRequirementsForWorld, checkRequirement } from "./world-capabilities.js";

test("every world has an encoded (possibly empty) capability requirement list", () => {
  for (const world of ALL_WORLDS) {
    assert.doesNotThrow(() => capabilityRequirementsForWorld(world));
  }
});

test("no requirement kind other than the frozen preflight taxonomy is ever produced", () => {
  const allowed = new Set(["env-var", "file", "host-platform", "artifact-slot"]);
  for (const world of ALL_WORLDS) {
    for (const requirement of capabilityRequirementsForWorld(world)) {
      assert.ok(allowed.has(requirement.kind), `${world}: unexpected kind ${requirement.kind}`);
      assert.ok(requirement.requiredByCellKeys.length > 0);
    }
  }
});

test("desktop-upgrade requires a macOS host", () => {
  const requirements = capabilityRequirementsForWorld("desktop-upgrade");
  assert.ok(requirements.some((r) => r.kind === "host-platform" && r.name === "darwin"));
});

test("tier-2 base world needs no requirement outside billing cells", () => {
  const requirements = capabilityRequirementsForWorld("tier-2");
  assert.ok(requirements.every((r) => r.requiredByCellKeys.every((k) => k.endsWith(":billing"))));
});

test("checkRequirement/env-var: missing, malformed, and satisfied against an ambient map", () => {
  const requirement = capabilityRequirementsForWorld("local-runtime").find(
    (r) => r.name === "RELEASE_E2E_GATEWAY_BASE_URL",
  )!;
  assert.equal(checkRequirement(requirement, { ambient: {} }).status, "missing");
  assert.equal(
    checkRequirement(requirement, { ambient: { RELEASE_E2E_GATEWAY_BASE_URL: "not-a-url" } }).status,
    "malformed",
  );
  assert.equal(
    checkRequirement(requirement, { ambient: { RELEASE_E2E_GATEWAY_BASE_URL: "https://gateway.example.test" } })
      .status,
    "satisfied",
  );
});

test("checkRequirement/env-var never echoes the value, even for a satisfied secret", () => {
  const requirement = capabilityRequirementsForWorld("managed-cloud").find(
    (r) => r.name === "RELEASE_E2E_E2B_API_KEY",
  )!;
  const secret = "e2b_totally_fake_do_not_use_1234567890";
  const result = checkRequirement(requirement, { ambient: { RELEASE_E2E_E2B_API_KEY: secret } });
  assert.equal(result.status, "satisfied");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("checkRequirement/host-platform compares against process.platform", () => {
  const requirement = { kind: "host-platform" as const, name: "darwin", shape: null, requiredByCellKeys: ["x"] };
  const result = checkRequirement(requirement);
  assert.equal(result.status, process.platform === "darwin" ? "satisfied" : "missing");
});

test("checkRequirement/file: missing vs. present vs. not-a-regular-file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "world-capabilities-"));
  try {
    const file = path.join(dir, "key.pem");
    writeFileSync(file, "not a real key", "utf8");
    const present = checkRequirement({ kind: "file", name: file, shape: null, requiredByCellKeys: ["x"] });
    assert.equal(present.status, "satisfied");

    const missing = checkRequirement({
      kind: "file",
      name: path.join(dir, "absent.pem"),
      shape: null,
      requiredByCellKeys: ["x"],
    });
    assert.equal(missing.status, "missing");

    const notAFile = checkRequirement({ kind: "file", name: dir, shape: null, requiredByCellKeys: ["x"] });
    assert.equal(notAFile.status, "malformed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkRequirement/artifact-slot is explicitly out of local-shape scope", () => {
  const result = checkRequirement({ kind: "artifact-slot", name: "e2bTemplate", shape: null, requiredByCellKeys: ["x"] });
  assert.equal(result.status, "missing");
  assert.match(result.detail, /checked against a manifest/);
});
