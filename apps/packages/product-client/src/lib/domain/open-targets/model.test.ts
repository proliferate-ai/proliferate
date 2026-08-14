import { describe, expect, it } from "vitest";
import {
  fileReferenceOpenWithTargets,
  type OpenTarget,
} from "#product/lib/domain/open-targets/model";

describe("fileReferenceOpenWithTargets", () => {
  it("keeps concrete editors and excludes Finder, Terminal, and copy actions", () => {
    const targets: OpenTarget[] = [
      { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
      { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
      { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      { id: "copy-path", label: "Copy path", kind: "copy" },
    ];

    expect(fileReferenceOpenWithTargets(targets)).toEqual([targets[1]]);
  });
});
