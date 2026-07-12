import assert from "node:assert/strict";
import { test } from "node:test";

import { gitAuthenticationEnvironment } from "./git.js";

test("Git authentication keeps the raw token out of URLs and command arguments", () => {
  const token = "ghp_SENTINEL_git_token_must_not_enter_argv";
  const auth = gitAuthenticationEnvironment(token);
  assert.equal(auth.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(auth.env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.equal(String(auth.env.GIT_CONFIG_VALUE_0).includes(token), false);
  assert.ok(auth.sensitiveValues.includes(token));

  const cleanClone = ["clone", "https://github.com/example/repo.git", "/tmp/repo"];
  assert.equal(cleanClone.join(" ").includes(token), false);
  assert.equal(cleanClone.join(" ").includes("x-access-token"), false);
});
