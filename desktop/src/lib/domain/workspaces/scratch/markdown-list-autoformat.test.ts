import { describe, expect, it } from "vitest";
import { applyScratchMarkdownEnterAutoformat } from "./markdown-list-autoformat";

describe("applyScratchMarkdownEnterAutoformat", () => {
  it("continues dash bullets", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first",
      selectionStart: 7,
      selectionEnd: 7,
    })).toEqual({
      value: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("continues star bullets", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "* first",
      selectionStart: 7,
      selectionEnd: 7,
    })).toEqual({
      value: "* first\n* ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("continues checklist items as unchecked tasks", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- [x] done",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "- [x] done\n- [ ] ",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it("removes an empty bullet marker to exit the list", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "- first\n",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("removes an empty checklist marker to exit the task list", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first\n  - [ ] ",
      selectionStart: 16,
      selectionEnd: 16,
    })).toEqual({
      value: "- first\n  ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("removes an empty checklist marker without requiring trailing whitespace", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- [ ]",
      selectionStart: 5,
      selectionEnd: 5,
    })).toEqual({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
  });

  it("preserves indentation for continued bullets", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "  - nested",
      selectionStart: 10,
      selectionEnd: 10,
    })).toEqual({
      value: "  - nested\n  - ",
      selectionStart: 15,
      selectionEnd: 15,
    });
  });

  it("replaces selected text with the inserted continued marker", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first selected",
      selectionStart: 7,
      selectionEnd: 16,
    })).toEqual({
      value: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("does not intercept Enter at the start of a list item", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first",
      selectionStart: 0,
      selectionEnd: 0,
    })).toBeNull();
  });

  it("does not intercept Enter inside a bullet marker", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- first",
      selectionStart: 1,
      selectionEnd: 1,
    })).toBeNull();
  });

  it("does not remove an empty marker when the caret is before the marker end", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- ",
      selectionStart: 0,
      selectionEnd: 0,
    })).toBeNull();
  });

  it("does not intercept Enter inside a task marker", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "- [ ] task",
      selectionStart: 4,
      selectionEnd: 4,
    })).toBeNull();
  });

  it("returns null for non-list lines", () => {
    expect(applyScratchMarkdownEnterAutoformat({
      value: "plain text",
      selectionStart: 10,
      selectionEnd: 10,
    })).toBeNull();
  });
});
