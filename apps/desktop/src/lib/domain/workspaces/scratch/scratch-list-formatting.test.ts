import { describe, expect, it } from "vitest";
import {
  applyScratchListEnterFormatting,
  parseScratchMarkdownListPrefix,
} from "./scratch-list-formatting";

describe("parseScratchMarkdownListPrefix", () => {
  it("parses markdown bullet prefixes", () => {
    expect(parseScratchMarkdownListPrefix("  - nested")).toEqual({
      kind: "bullet",
      checked: false,
      indent: "  ",
      marker: "-",
      prefixLength: 4,
      checkboxOffset: null,
      body: "nested",
    });
  });

  it("parses markdown task prefixes", () => {
    expect(parseScratchMarkdownListPrefix("- [x] done")).toEqual({
      kind: "task",
      checked: true,
      indent: "",
      marker: "-",
      prefixLength: 5,
      checkboxOffset: 3,
      body: "done",
    });
  });
});

describe("applyScratchListEnterFormatting", () => {
  it("continues markdown dash bullets", () => {
    expect(applyScratchListEnterFormatting({
      value: "- first",
      selectionStart: 7,
      selectionEnd: 7,
    })).toEqual({
      value: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
      changes: {
        from: 7,
        to: 7,
        insert: "\n- ",
      },
    });
  });

  it("continues markdown checklist items as unchecked tasks while preserving marker style", () => {
    expect(applyScratchListEnterFormatting({
      value: "* [x] done",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "* [x] done\n* [ ] ",
      selectionStart: 17,
      selectionEnd: 17,
      changes: {
        from: 10,
        to: 10,
        insert: "\n* [ ] ",
      },
    });
  });

  it("continues literal bullets", () => {
    expect(applyScratchListEnterFormatting({
      value: "• first",
      selectionStart: 7,
      selectionEnd: 7,
    })).toEqual({
      value: "• first\n• ",
      selectionStart: 10,
      selectionEnd: 10,
      changes: {
        from: 7,
        to: 7,
        insert: "\n• ",
      },
    });
  });

  it("continues literal checkbox items as unchecked tasks", () => {
    expect(applyScratchListEnterFormatting({
      value: "☑ done",
      selectionStart: 6,
      selectionEnd: 6,
    })).toEqual({
      value: "☑ done\n☐ ",
      selectionStart: 9,
      selectionEnd: 9,
      changes: {
        from: 6,
        to: 6,
        insert: "\n☐ ",
      },
    });
  });

  it("removes an empty markdown bullet marker to exit the list", () => {
    expect(applyScratchListEnterFormatting({
      value: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "- first\n",
      selectionStart: 8,
      selectionEnd: 8,
      changes: {
        from: 8,
        to: 10,
        insert: "",
      },
    });
  });

  it("removes an empty literal task marker to exit the list", () => {
    expect(applyScratchListEnterFormatting({
      value: "☐ ",
      selectionStart: 2,
      selectionEnd: 2,
    })).toEqual({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      changes: {
        from: 0,
        to: 2,
        insert: "",
      },
    });
  });

  it("preserves indentation for continued literal bullets", () => {
    expect(applyScratchListEnterFormatting({
      value: "  • nested",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "  • nested\n  • ",
      selectionStart: 15,
      selectionEnd: 15,
      changes: {
        from: 10,
        to: 10,
        insert: "\n  • ",
      },
    });
  });

  it("replaces selected text with the inserted continued marker", () => {
    expect(applyScratchListEnterFormatting({
      value: "• first selected",
      selectionStart: 7,
      selectionEnd: 16,
    })).toEqual({
      value: "• first\n• ",
      selectionStart: 10,
      selectionEnd: 10,
      changes: {
        from: 7,
        to: 16,
        insert: "\n• ",
      },
    });
  });

  it("does not intercept Enter at the start of a list item", () => {
    expect(applyScratchListEnterFormatting({
      value: "- first",
      selectionStart: 0,
      selectionEnd: 0,
    })).toBeNull();
  });

  it("does not intercept Enter inside a task marker", () => {
    expect(applyScratchListEnterFormatting({
      value: "- [ ] task",
      selectionStart: 4,
      selectionEnd: 4,
    })).toBeNull();
  });

  it("returns null for non-list lines", () => {
    expect(applyScratchListEnterFormatting({
      value: "plain text",
      selectionStart: 10,
      selectionEnd: 10,
    })).toBeNull();
  });
});
