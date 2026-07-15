import assert from "node:assert/strict";
import { test } from "node:test";

import { e2bVerificationAvailable } from "./e2b-verify.js";

test("e2bVerificationAvailable is false when RELEASE_E2E_E2B_API_KEY is unset or blank", () => {
  assert.equal(e2bVerificationAvailable({}), false);
  assert.equal(e2bVerificationAvailable({ RELEASE_E2E_E2B_API_KEY: "   " }), false);
});

test("e2bVerificationAvailable is true when RELEASE_E2E_E2B_API_KEY is set", () => {
  assert.equal(e2bVerificationAvailable({ RELEASE_E2E_E2B_API_KEY: "e2b_test_key" }), true);
});
