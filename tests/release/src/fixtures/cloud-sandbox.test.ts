import assert from "node:assert/strict";
import { test } from "node:test";

import { isBillingCreditsExhaustedError } from "./cloud-sandbox.js";
import { ApiRequestError } from "./http.js";

test("isBillingCreditsExhaustedError recognizes the real 402 shape (bare code)", () => {
  const error = new ApiRequestError("POST", "/v1/cloud/cloud-sandbox/ensure", 402, {
    code: "billing_credits_exhausted",
    message: "Cloud usage is paused because your included sandbox hours are exhausted.",
    decision_type: "enforce_active_spend",
    reason: "credits_exhausted",
    remaining_seconds: 0,
  });
  assert.equal(isBillingCreditsExhaustedError(error), true);
});

test("isBillingCreditsExhaustedError recognizes the FastAPI HTTPException-wrapped shape", () => {
  const error = new ApiRequestError("POST", "/v1/cloud/cloud-sandbox/ensure", 402, {
    detail: { code: "billing_credits_exhausted" },
  });
  assert.equal(isBillingCreditsExhaustedError(error), true);
});

test("isBillingCreditsExhaustedError is false for other 402s and other statuses", () => {
  assert.equal(
    isBillingCreditsExhaustedError(new ApiRequestError("POST", "/x", 402, { code: "some_other_code" })),
    false,
  );
  assert.equal(
    isBillingCreditsExhaustedError(new ApiRequestError("POST", "/x", 409, { code: "billing_credits_exhausted" })),
    false,
  );
  assert.equal(isBillingCreditsExhaustedError(new Error("boom")), false);
});
