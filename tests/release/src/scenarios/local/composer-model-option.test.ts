import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composerModelSelectionMatches,
  resolveVisibleComposerModelOptionId,
  waitForComposerModelSelection,
} from "./composer-model-option.js";

test("exact composer model ids win without aliasing", () => {
  assert.equal(
    resolveVisibleComposerModelOptionId("gpt-5.4", ["haiku", "gpt-5.4"]),
    "gpt-5.4",
  );
});

test("canonical Haiku 4.5 gateway ids resolve to the unique live Claude alias", () => {
  const visible = ["opus[1m]", "sonnet", "haiku", "claude-fable-5"];
  assert.equal(resolveVisibleComposerModelOptionId("claude-haiku-4-5", visible), "haiku");
  assert.equal(
    resolveVisibleComposerModelOptionId("anthropic/claude-haiku-4-5-20251001", visible),
    "haiku",
  );
  assert.equal(composerModelSelectionMatches("claude-haiku-4-5", "haiku"), true);
});

test("alias resolution fails closed for duplicates and version-ambiguous families", () => {
  assert.equal(resolveVisibleComposerModelOptionId("gpt-5.4", ["gpt-5.4", "gpt-5.4"]), null);
  assert.equal(resolveVisibleComposerModelOptionId("claude-haiku-4-5", ["haiku", "haiku"]), null);
  assert.equal(resolveVisibleComposerModelOptionId("claude-sonnet-4-5", ["sonnet"]), null);
  assert.equal(resolveVisibleComposerModelOptionId("claude-opus-4-5", ["opus[1m]"]), null);
  assert.equal(resolveVisibleComposerModelOptionId("claude-fable-5", ["haiku"]), null);
});

test("selection wait accepts the live Haiku alias after route reconciliation", async () => {
  const selected = [null, "sonnet", "haiku"];
  assert.equal(
    await waitForComposerModelSelection(
      async () => {
        const next = selected.shift();
        return next === undefined ? "haiku" : next;
      },
      "claude-haiku-4-5",
      100,
      1,
    ),
    "haiku",
  );
});

test("selection wait fails closed on a non-equivalent visible alias", async () => {
  await assert.rejects(
    waitForComposerModelSelection(async () => "sonnet", "claude-haiku-4-5", 0, 0),
    /last selected option: "sonnet"/,
  );
});
