import assert from "node:assert/strict";
import { test } from "node:test";

import { ORG_COMPUTE_ATTRIBUTION_FIXED, expectedComputeSubjectKind } from "./billing.js";

test("expectedComputeSubjectKind is personal until the org attribution fix lands", () => {
  assert.equal(expectedComputeSubjectKind(false), "personal");
});

test("expectedComputeSubjectKind is organization once the fix is flagged on", () => {
  assert.equal(expectedComputeSubjectKind(true), "organization");
});

test("ORG_COMPUTE_ATTRIBUTION_FIXED is false while PR #1028 is unmerged", () => {
  // Guards against flipping the flag without the migration/product change: this
  // must only become true once usage_segment.organization_id exists (#1028).
  assert.equal(ORG_COMPUTE_ATTRIBUTION_FIXED, false);
  assert.equal(expectedComputeSubjectKind(ORG_COMPUTE_ATTRIBUTION_FIXED), "personal");
});
