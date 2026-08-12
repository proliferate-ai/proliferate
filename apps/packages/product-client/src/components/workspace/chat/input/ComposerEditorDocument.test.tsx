// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { $createTextNode, $getRoot, createEditor } from "lexical";
import {
  COMPOSER_NODES,
  isComposerSelectionPointInsideCode,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";

function withEditorUpdate(run: () => void) {
  const editor = createEditor({
    nodes: COMPOSER_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(run, { discrete: true });
}

describe("isComposerSelectionPointInsideCode", () => {
  // A cleared composer can briefly leave the selection pointing at the root
  // or at a node no longer attached to the document. The ancestor walk must
  // still terminate for those points (PRO-209: it previously spun forever,
  // freezing the renderer on the next keystroke).
  it("returns false when the selection point is the root node", () => {
    withEditorUpdate(() => {
      expect(isComposerSelectionPointInsideCode($getRoot(), 0)).toBe(false);
    });
  }, 2000);

  it("returns false when the selection point is a detached node", () => {
    withEditorUpdate(() => {
      expect(isComposerSelectionPointInsideCode($createTextNode("orphan"), 0)).toBe(false);
    });
  }, 2000);
});
