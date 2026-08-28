import { describe, expect, it } from "vitest";
import {
  contextDocMentionWorkspacePath,
  filterContextDocMentionCandidates,
  formatContextDocMentionToken,
  isValidContextDocMentionRef,
  parseContextDocMentionDestination,
  resolveContextDocMentionTokens,
  type ContextDocMentionCandidate,
} from "#product/lib/domain/chat/composer/context-doc-mention";

const REF = { runId: "run-01j8", filename: "01-plan.md" };

function candidate(overrides: Partial<ContextDocMentionCandidate> = {}): ContextDocMentionCandidate {
  return {
    docId: "doc-1",
    runId: "run-01j8",
    slug: "plan",
    filename: "01-plan.md",
    runLabel: "Release checklist",
    ...overrides,
  };
}

describe("formatContextDocMentionToken", () => {
  it("serializes to the @doc token with both ref halves in the destination", () => {
    expect(formatContextDocMentionToken("01-plan.md", REF))
      .toBe("[01-plan.md](@doc:run-01j8/01-plan.md)");
  });

  it("escapes markdown-significant characters in the label", () => {
    expect(formatContextDocMentionToken("[plan]", REF))
      .toBe("[\\[plan\\]](@doc:run-01j8/01-plan.md)");
  });

  it("falls back to a plain escaped label when the ref cannot serialize", () => {
    expect(formatContextDocMentionToken("plan", { runId: "run/../etc", filename: "01-plan.md" }))
      .toBe("plan");
  });
});

describe("parseContextDocMentionDestination", () => {
  it("round-trips a formatted destination back to its ref", () => {
    expect(parseContextDocMentionDestination("@doc:run-01j8/01-plan.md")).toEqual(REF);
  });

  it("splits on the first separator so filenames keep any later slash rejected", () => {
    // A second slash lands in the filename half, which the segment rule rejects.
    expect(parseContextDocMentionDestination("@doc:run-01j8/a/b.md")).toBeNull();
  });

  it.each([
    ["missing prefix", "run-01j8/01-plan.md"],
    ["no separator", "@doc:run-01j8"],
    ["empty run id", "@doc:/01-plan.md"],
    ["empty filename", "@doc:run-01j8/"],
    ["traversal run id", "@doc:../01-plan.md"],
    ["traversal filename", "@doc:run-01j8/.."],
    ["whitespace in filename", "@doc:run-01j8/01 plan.md"],
    ["backslash in filename", "@doc:run-01j8/01\\plan.md"],
    ["control character", "@doc:run-01j8/01\u0007plan.md"],
    ["bracket in filename", "@doc:run-01j8/01[a].md"],
  ])("rejects %s", (_reason, destination) => {
    expect(parseContextDocMentionDestination(destination)).toBeNull();
  });
});

describe("isValidContextDocMentionRef", () => {
  it("accepts real run ids and filenames with hyphens and dots", () => {
    expect(isValidContextDocMentionRef(REF)).toBe(true);
  });

  it("rejects dot and dot-dot segments", () => {
    expect(isValidContextDocMentionRef({ runId: ".", filename: "a.md" })).toBe(false);
    expect(isValidContextDocMentionRef({ runId: "run-1", filename: ".." })).toBe(false);
  });
});

describe("resolveContextDocMentionTokens", () => {
  it("rewrites a token to a workspace-relative context-dir file link", () => {
    expect(resolveContextDocMentionTokens("Read [01-plan.md](@doc:run-01j8/01-plan.md) first"))
      .toBe("Read [01-plan.md](.proliferate/context/01-plan.md) first");
    expect(contextDocMentionWorkspacePath(REF)).toBe(".proliferate/context/01-plan.md");
  });

  it("resolves every token and leaves file links and web links untouched", () => {
    const prompt = "Compare [01-plan.md](@doc:run-a/01-plan.md) with "
      + "[setup.md](docs/setup.md) and [Docs](https://example.com) then "
      + "[notes.md](@doc:run-b/notes.md)";
    expect(resolveContextDocMentionTokens(prompt)).toBe(
      "Compare [01-plan.md](.proliferate/context/01-plan.md) with "
      + "[setup.md](docs/setup.md) and [Docs](https://example.com) then "
      + "[notes.md](.proliferate/context/notes.md)",
    );
  });

  it("leaves a token with an unparseable destination untouched", () => {
    const prose = "See [plan](@doc:no-separator) here";
    expect(resolveContextDocMentionTokens(prose)).toBe(prose);
  });

  it("keeps a label that differs from the filename", () => {
    expect(resolveContextDocMentionTokens("[the plan](@doc:run-01j8/01-plan.md)"))
      .toBe("[the plan](.proliferate/context/01-plan.md)");
  });
});

describe("filterContextDocMentionCandidates", () => {
  it("returns all valid candidates in given order for an empty query", () => {
    const docs = [
      candidate({ docId: "doc-1", filename: "01-plan.md" }),
      candidate({ docId: "doc-2", filename: "02-findings.md" }),
    ];
    expect(filterContextDocMentionCandidates(docs, "")).toEqual(docs);
  });

  it("matches on filename, slug, and run label case-insensitively", () => {
    const docs = [
      candidate({ docId: "doc-1", filename: "01-plan.md", slug: "plan", runLabel: "Release" }),
      candidate({ docId: "doc-2", filename: "02-findings.md", slug: "findings", runLabel: "Audit" }),
    ];
    expect(filterContextDocMentionCandidates(docs, "FIND").map((doc) => doc.docId))
      .toEqual(["doc-2"]);
    expect(filterContextDocMentionCandidates(docs, "release").map((doc) => doc.docId))
      .toEqual(["doc-1"]);
  });

  it("drops duplicate doc ids and candidates whose ref cannot serialize", () => {
    const docs = [
      candidate({ docId: "doc-1" }),
      candidate({ docId: "doc-1", filename: "duplicate.md" }),
      candidate({ docId: "doc-2", filename: "has space.md" }),
    ];
    expect(filterContextDocMentionCandidates(docs, "")).toEqual([docs[0]]);
  });
});
