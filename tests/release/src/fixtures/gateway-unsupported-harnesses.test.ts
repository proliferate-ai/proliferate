import assert from "node:assert/strict";
import { test } from "node:test";

import { GATEWAY_UNSUPPORTED_HARNESSES, gatewayUnsupportedMessage } from "./gateway-unsupported-harnesses.js";

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
