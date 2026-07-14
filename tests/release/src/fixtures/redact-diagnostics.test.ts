import assert from "node:assert/strict";
import { test } from "node:test";

import { redactDiagnostics, scrubSecretText } from "./redact-diagnostics.js";

test("scrubSecretText scrubs bearer tokens, sk-/vk- keys, and JWTs", () => {
  assert.equal(scrubSecretText("Authorization: Bearer abc.def-123"), "Authorization: [REDACTED]");
  assert.equal(scrubSecretText("key=sk-live-abcdef123456 end"), "key=[REDACTED] end");
  assert.equal(scrubSecretText("virtual vk-user-9-deadbeef done"), "virtual [REDACTED] done");
  assert.equal(scrubSecretText("t=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "t=[REDACTED]");
});

test("scrubSecretText leaves non-secret identifiers intact", () => {
  const safe = "workspace ws-123 session s-456 request req-789 status 401";
  assert.equal(scrubSecretText(safe), safe);
});

test("redactDiagnostics redacts secret-named keys wholesale and scrubs nested string values", () => {
  const input = {
    stateJson: {
      apiKey: "sk-live-should-be-gone",
      token: "vk-user-1-abcdef",
      workspaceId: "ws-42",
      nested: { authorization: "Bearer zzz", note: "raw sk-live-embedded here" },
    },
    list: ["Bearer leak", "plain text"],
  };
  const out = redactDiagnostics(input) as Record<string, unknown>;
  const state = out.stateJson as Record<string, unknown>;
  assert.equal(state.apiKey, "[REDACTED]");
  assert.equal(state.token, "[REDACTED]");
  assert.equal(state.workspaceId, "ws-42");
  const nested = state.nested as Record<string, unknown>;
  assert.equal(nested.authorization, "[REDACTED]");
  assert.equal(nested.note, "raw [REDACTED] here");
  assert.deepEqual(out.list, ["[REDACTED]", "plain text"]);
});
