import { describe, expect, it } from "vitest";
import {
  applyScratchListIndentFormatting,
  applyScratchListEnterFormatting,
  applyScratchListOutdentFormatting,
  parseScratchMarkdownListPrefix,
  shouldScratchBackspaceOutdent,
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

  it("parses markdown ordered prefixes", () => {
    expect(parseScratchMarkdownListPrefix("  12) nested")).toEqual({
      kind: "ordered",
      checked: false,
      indent: "  ",
      marker: "12)",
      prefixLength: 6,
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
      prefixLength: 6,
      checkboxOffset: 3,
      body: "done",
    });
  });

  it("does not parse markdown task prefixes until the trailing space is typed", () => {
    expect(parseScratchMarkdownListPrefix("- [ ]")).toEqual({
      kind: "bullet",
      checked: false,
      indent: "",
      marker: "-",
      prefixLength: 2,
      checkboxOffset: null,
      body: "[ ]",
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

  it("continues markdown ordered lists while preserving delimiter style", () => {
    expect(applyScratchListEnterFormatting({
      value: "1. first",
      selectionStart: 8,
      selectionEnd: 8,
    })).toEqual({
      value: "1. first\n2. ",
      selectionStart: 12,
      selectionEnd: 12,
      changes: {
        from: 8,
        to: 8,
        insert: "\n2. ",
      },
    });

    expect(applyScratchListEnterFormatting({
      value: "1) first",
      selectionStart: 8,
      selectionEnd: 8,
    })).toEqual({
      value: "1) first\n2) ",
      selectionStart: 12,
      selectionEnd: 12,
      changes: {
        from: 8,
        to: 8,
        insert: "\n2) ",
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

  it("preserves indentation for continued markdown ordered lists", () => {
    expect(applyScratchListEnterFormatting({
      value: "  9. nested",
      selectionStart: 11,
      selectionEnd: 11,
    })).toEqual({
      value: "  9. nested\n  10. ",
      selectionStart: 18,
      selectionEnd: 18,
      changes: {
        from: 11,
        to: 11,
        insert: "\n  10. ",
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

  it("removes an empty markdown ordered marker to exit the list", () => {
    expect(applyScratchListEnterFormatting({
      value: "1. first\n2. ",
      selectionStart: 12,
      selectionEnd: 12,
    })).toEqual({
      value: "1. first\n",
      selectionStart: 9,
      selectionEnd: 9,
      changes: {
        from: 9,
        to: 12,
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

describe("applyScratchListIndentFormatting", () => {
  it("indents markdown bullet lines with real spaces", () => {
    expect(applyScratchListIndentFormatting({
      value: "- first",
      selectionStart: 7,
      selectionEnd: 7,
    })).toEqual({
      value: "    - first",
      selectionStart: 11,
      selectionEnd: 11,
      changes: [{
        from: 0,
        to: 0,
        insert: "    ",
      }],
    });
  });

  it("indents ordered and task list lines", () => {
    expect(applyScratchListIndentFormatting({
      value: "1. first\n- [ ] task",
      selectionStart: 0,
      selectionEnd: 19,
    })).toEqual({
      value: "    1. first\n    - [ ] task",
      selectionStart: 4,
      selectionEnd: 27,
      changes: [
        {
          from: 0,
          to: 0,
          insert: "    ",
        },
        {
          from: 9,
          to: 9,
          insert: "    ",
        },
      ],
    });
  });

  it("indents literal list lines", () => {
    expect(applyScratchListIndentFormatting({
      value: "☐ task",
      selectionStart: 6,
      selectionEnd: 6,
    })).toEqual({
      value: "    ☐ task",
      selectionStart: 10,
      selectionEnd: 10,
      changes: [{
        from: 0,
        to: 0,
        insert: "    ",
      }],
    });
  });

  it("indents every selected line", () => {
    expect(applyScratchListIndentFormatting({
      value: "- first\nplain\n1. third",
      selectionStart: 0,
      selectionEnd: 22,
    })).toEqual({
      value: "    - first\n    plain\n    1. third",
      selectionStart: 4,
      selectionEnd: 34,
      changes: [
        {
          from: 0,
          to: 0,
          insert: "    ",
        },
        {
          from: 8,
          to: 8,
          insert: "    ",
        },
        {
          from: 14,
          to: 14,
          insert: "    ",
        },
      ],
    });
  });

  it("indents plain text lines", () => {
    expect(applyScratchListIndentFormatting({
      value: "plain text",
      selectionStart: 0,
      selectionEnd: 10,
    })).toEqual({
      value: "    plain text",
      selectionStart: 4,
      selectionEnd: 14,
      changes: [{
        from: 0,
        to: 0,
        insert: "    ",
      }],
    });
  });
});

describe("applyScratchListOutdentFormatting", () => {
  it("outdents markdown bullet lines by one indent unit", () => {
    expect(applyScratchListOutdentFormatting({
      value: "    - first",
      selectionStart: 11,
      selectionEnd: 11,
    })).toEqual({
      value: "- first",
      selectionStart: 7,
      selectionEnd: 7,
      changes: [{
        from: 0,
        to: 4,
        insert: "",
      }],
    });
  });

  it("outdents ordered and task list selections", () => {
    expect(applyScratchListOutdentFormatting({
      value: "    1. first\n    - [ ] task",
      selectionStart: 4,
      selectionEnd: 27,
    })).toEqual({
      value: "1. first\n- [ ] task",
      selectionStart: 0,
      selectionEnd: 19,
      changes: [
        {
          from: 0,
          to: 4,
          insert: "",
        },
        {
          from: 13,
          to: 17,
          insert: "",
        },
      ],
    });
  });

  it("outdents a single leading space when that is the current indent", () => {
    expect(applyScratchListOutdentFormatting({
      value: " - first",
      selectionStart: 8,
      selectionEnd: 8,
    })).toEqual({
      value: "- first",
      selectionStart: 7,
      selectionEnd: 7,
      changes: [{
        from: 0,
        to: 1,
        insert: "",
      }],
    });
  });

  it("outdents plain text lines", () => {
    expect(applyScratchListOutdentFormatting({
      value: "    plain\n - second",
      selectionStart: 0,
      selectionEnd: 19,
    })).toEqual({
      value: "plain\n- second",
      selectionStart: 0,
      selectionEnd: 14,
      changes: [
        {
          from: 0,
          to: 4,
          insert: "",
        },
        {
          from: 10,
          to: 11,
          insert: "",
        },
      ],
    });
  });

  it("returns null when selected lines are already flush", () => {
    expect(applyScratchListOutdentFormatting({
      value: "plain\n- first",
      selectionStart: 0,
      selectionEnd: 13,
    })).toBeNull();
  });
});

describe("shouldScratchBackspaceOutdent", () => {
  it("returns true when backspacing at an indent boundary", () => {
    expect(shouldScratchBackspaceOutdent({
      value: "    - first",
      selectionStart: 4,
      selectionEnd: 4,
    })).toBe(true);
  });

  it("returns true when backspacing at a nested indent boundary", () => {
    expect(shouldScratchBackspaceOutdent({
      value: "        plain",
      selectionStart: 8,
      selectionEnd: 8,
    })).toBe(true);
  });

  it("returns false outside leading indentation", () => {
    expect(shouldScratchBackspaceOutdent({
      value: "    plain",
      selectionStart: 6,
      selectionEnd: 6,
    })).toBe(false);
  });

  it("returns false between indent boundaries", () => {
    expect(shouldScratchBackspaceOutdent({
      value: "    plain",
      selectionStart: 3,
      selectionEnd: 3,
    })).toBe(false);
  });

  it("returns false for ranged deletions", () => {
    expect(shouldScratchBackspaceOutdent({
      value: "    plain",
      selectionStart: 0,
      selectionEnd: 4,
    })).toBe(false);
  });
});
