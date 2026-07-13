import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BARE_NATIVE_SELECTORS,
  DEFAULT_QUALIFICATION_ALLOWLIST,
  NoEligibleModelError,
  cheapnessRank,
  chooseCheapestEligibleModel,
  isBareNativeSelector,
} from "./model-selection.js";

test("picks the cheapest allowlist entry the live probe actually offers", () => {
  const allowlist = ["claude-haiku-4-5", "claude-sonnet-4-5"];
  // Probe offers only sonnet — the picker must not invent the (cheaper) haiku.
  const choice = chooseCheapestEligibleModel("claude", allowlist, [
    "claude-sonnet-4-5",
    "claude-opus-4-1",
  ]);
  assert.equal(choice.modelId, "claude-sonnet-4-5");
  assert.equal(choice.fromAllowlist, true);
});

test("prefers the cheaper allowlist entry when both are probed", () => {
  const choice = chooseCheapestEligibleModel(
    "claude",
    ["claude-sonnet-4-5", "claude-haiku-4-5"],
    ["claude-haiku-4-5", "claude-sonnet-4-5"],
  );
  // Cheapness order wins over allowlist position.
  assert.equal(choice.modelId, "claude-haiku-4-5");
  assert.deepEqual(choice.rankedIntersection, ["claude-haiku-4-5", "claude-sonnet-4-5"]);
});

test("live probe is authoritative: never returns a catalog id the key cannot serve", () => {
  assert.throws(
    () => chooseCheapestEligibleModel("claude", ["claude-haiku-4-5"], []),
    NoEligibleModelError,
  );
});

test("falls back to the cheapest safe probed id when allowlist is disjoint", () => {
  const choice = chooseCheapestEligibleModel(
    "claude",
    ["claude-haiku-4-5"], // not offered by the probe
    ["claude-opus-4-1", "claude-haiku-4-6"],
  );
  assert.equal(choice.fromAllowlist, false);
  // haiku ranks cheaper than opus.
  assert.equal(choice.modelId, "claude-haiku-4-6");
});

test("fallback never selects a Fable-tier id even if it is the only probe", () => {
  assert.throws(
    () => chooseCheapestEligibleModel("claude", ["claude-haiku-4-5"], ["claude-fable-5"]),
    NoEligibleModelError,
  );
});

test("cheapnessRank orders cheap tiers first and Fable last", () => {
  assert.ok(cheapnessRank("claude-haiku-4-5") < cheapnessRank("claude-sonnet-4-5"));
  assert.ok(cheapnessRank("claude-sonnet-4-5") < cheapnessRank("claude-opus-4-1"));
  assert.ok(cheapnessRank("claude-fable-5") > cheapnessRank("claude-opus-4-1"));
  assert.equal(cheapnessRank("gpt-5-mini"), 0);
  assert.equal(cheapnessRank("grok-code-fast-1"), 0);
});

test("bare native selectors are recognised (gateway-ineligible)", () => {
  for (const id of BARE_NATIVE_SELECTORS) {
    assert.ok(isBareNativeSelector(id), `${id} should be a bare native selector`);
  }
  assert.ok(!isBareNativeSelector("claude-haiku-4-5"));
});

test("default allowlist is cheap-first and Fable-free", () => {
  for (const [harness, ids] of Object.entries(DEFAULT_QUALIFICATION_ALLOWLIST)) {
    assert.ok(ids.length > 0, `${harness} allowlist must be non-empty`);
    assert.ok(!ids.some((id) => /fable/i.test(id)), `${harness} allowlist must exclude Fable`);
  }
});
