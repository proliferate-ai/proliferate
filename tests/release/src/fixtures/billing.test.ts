import assert from "node:assert/strict";
import { test } from "node:test";

import { ORG_COMPUTE_ATTRIBUTION_FIXED } from "./billing.js";

test("ORG_COMPUTE_ATTRIBUTION_FIXED is true now that PR #1028 is merged", () => {
  // Guards against flipping the flag back without the migration/product change:
  // this must stay true because usage_segment.organization_id exists (#1028,
  // merged 2026-07-06). The paying subject (billing_subject_id) is unaffected —
  // #1028 only added attribution/enforcement scope, not who pays.
  assert.equal(ORG_COMPUTE_ATTRIBUTION_FIXED, true);
});
