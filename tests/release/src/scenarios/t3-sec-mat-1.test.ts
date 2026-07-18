import assert from "node:assert/strict";
import { test } from "node:test";

import { assertWorkspaceSecretMaterialized } from "./t3-sec-mat-1.js";

const workspaceEnvPath = "/home/user/workspace/repos/example/repo/.proliferate/env/workspace.env";
const secretPath = "/home/user/workspace/repos/example/repo/.private/token.txt";
const manifestPath = "/home/user/workspace/repos/example/repo/.proliferate/env/workspace.manifest.json";
const secretContent = "workspace-secret";
const secretSha256 = "fe54432b6be58e44c9c3a59bc3f0205bcd6e48f990c8e5d15b12b6138265a5a0";

test("workspace secret proof accepts an empty generated env file and verifies the file plus manifest", () => {
  assert.doesNotThrow(() =>
    assertWorkspaceSecretMaterialized({
      workspaceEnvPath,
      workspaceEnvRead: { content: "", error: null },
      secretPath,
      secretRead: { content: secretContent, error: null },
      secretContent,
      manifestPath,
      manifestRead: {
        content: JSON.stringify({ env: {}, files: { [secretPath]: secretSha256 }, versions: {} }),
        error: null,
      },
    }),
  );
});

test("workspace secret proof rejects a missing secret file", () => {
  assert.throws(
    () =>
      assertWorkspaceSecretMaterialized({
        workspaceEnvPath,
        workspaceEnvRead: { content: "", error: null },
        secretPath,
        secretRead: { content: null, error: "not found" },
        secretContent,
        manifestPath,
        manifestRead: {
          content: JSON.stringify({ env: {}, files: { [secretPath]: secretSha256 }, versions: {} }),
          error: null,
        },
      }),
    /must contain the workspace file secret/,
  );
});

test("workspace secret proof rejects a stale manifest checksum", () => {
  assert.throws(
    () =>
      assertWorkspaceSecretMaterialized({
        workspaceEnvPath,
        workspaceEnvRead: { content: "", error: null },
        secretPath,
        secretRead: { content: secretContent, error: null },
        secretContent,
        manifestPath,
        manifestRead: {
          content: JSON.stringify({ env: {}, files: { [secretPath]: "stale" }, versions: {} }),
          error: null,
        },
      }),
    /must match sha256\(content\)/,
  );
});
