import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GATEWAY_UNSUPPORTED_HARNESSES,
  gatewayQualificationUnsupportedMessage,
  gatewayUnsupportedMessage,
  isGatewayQualificationCapabilityUnsupported,
} from "./gateway-unsupported-harnesses.js";

test("GATEWAY_UNSUPPORTED_HARNESSES contains exactly cursor (the only harness with no gateway auth slot)", () => {
  assert.ok(GATEWAY_UNSUPPORTED_HARNESSES.has("cursor"));
  assert.equal(GATEWAY_UNSUPPORTED_HARNESSES.size, 1);
});

test("gatewayUnsupportedMessage names the harness and the caller's context, without dropping the account-key fact", () => {
  const message = gatewayUnsupportedMessage("cursor", "its LOCAL-4 baseline turn cannot run on the gateway-enrolled world");
  assert.match(message, /^\[cursor\]/);
  assert.match(message, /its LOCAL-4 baseline turn cannot run on the gateway-enrolled world/);
  assert.match(message, /account key, not a provider key/);
});

test("Grok is unsupported only for the three approved evidence capabilities", () => {
  for (const capability of ["chat-spend", "config", "integration-audit"] as const) {
    assert.equal(isGatewayQualificationCapabilityUnsupported("grok", capability), true);
    assert.match(
      gatewayQualificationUnsupportedMessage("grok", capability, "cannot qualify") ?? "",
      /typed unsupported, temporary product policy/,
    );
  }
  assert.equal(isGatewayQualificationCapabilityUnsupported("codex", "chat-spend"), false);
  assert.equal(gatewayQualificationUnsupportedMessage("codex", "chat-spend", "cannot qualify"), null);
});
