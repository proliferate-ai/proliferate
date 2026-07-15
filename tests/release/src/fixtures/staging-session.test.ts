import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseStagingSessionState, stagingSessionAvailable, stagingSessionStatePath } from "./staging-session.js";

test("stagingSessionStatePath honours the override and otherwise uses the default home path", () => {
  assert.equal(stagingSessionStatePath({ RELEASE_E2E_STAGING_SESSION_STATE: "/tmp/state.json" }), "/tmp/state.json");
  assert.equal(
    stagingSessionStatePath({}),
    path.join(os.homedir(), ".proliferate-local/dev/release-e2e-staging-session.json"),
  );
  // whitespace-only override is treated as unset
  assert.equal(
    stagingSessionStatePath({ RELEASE_E2E_STAGING_SESSION_STATE: "   " }),
    path.join(os.homedir(), ".proliferate-local/dev/release-e2e-staging-session.json"),
  );
});

test("stagingSessionAvailable is true with a bootstrap token even if no state file exists", () => {
  assert.equal(
    stagingSessionAvailable({ RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN: "rt_x" }, () => false),
    true,
  );
});

test("stagingSessionAvailable is true with an existing state file and no bootstrap token", () => {
  assert.equal(stagingSessionAvailable({}, () => true), true);
});

test("stagingSessionAvailable is false with neither a bootstrap token nor a state file", () => {
  assert.equal(stagingSessionAvailable({}, () => false), false);
});

test("parseStagingSessionState trims and accepts a well-formed state file", () => {
  const state = parseStagingSessionState(JSON.stringify({ refreshToken: "  rt_abc  ", accessToken: "at_abc" }));
  assert.equal(state?.refreshToken, "rt_abc");
  assert.equal(state?.accessToken, "at_abc");
});

test("parseStagingSessionState rejects a missing or blank refreshToken", () => {
  assert.equal(parseStagingSessionState(JSON.stringify({ accessToken: "at_abc" })), undefined);
  assert.equal(parseStagingSessionState(JSON.stringify({ refreshToken: "   " })), undefined);
});
