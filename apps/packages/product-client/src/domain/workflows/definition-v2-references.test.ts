import { describe, expect, it } from "vitest";
import { collectPromptReferences, parsePromptTokens } from "./definition-v2";

// The `@input:`/`@doc:` reference grammar, split from the structural-validation
// cases in `definition-v2.test.ts` to keep both files under the max-lines
// threshold. Scan-then-validate is the contract under test: a reference is
// either well-formed for its kind or a reported error, never a silent
// non-match and never a prefix match against the valid head of a typo.

describe("parsePromptTokens", () => {
  it("returns a single text token for a prompt with no sigils", () => {
    expect(parsePromptTokens("Investigate the ticket")).toEqual([
      { kind: "text", text: "Investigate the ticket" },
    ]);
  });

  it("parses back-to-back tokens with no text between them", () => {
    expect(parsePromptTokens("@input:a@doc:b")).toEqual([
      { kind: "input", name: "a", raw: "@input:a" },
      { kind: "doc", slug: "b", raw: "@doc:b" },
    ]);
  });

  it("parses a token at the very start of the prompt", () => {
    expect(parsePromptTokens("@input:ticket please investigate")).toEqual([
      { kind: "input", name: "ticket", raw: "@input:ticket" },
      { kind: "text", text: " please investigate" },
    ]);
  });

  it("parses a token at the very end of the prompt, with no trailing text segment", () => {
    expect(parsePromptTokens("please see @doc:notes")).toEqual([
      { kind: "text", text: "please see " },
      { kind: "doc", slug: "notes", raw: "@doc:notes" },
    ]);
  });

  it("ends a token at trailing prose punctuation, keeping it as trailing text", () => {
    expect(parsePromptTokens("See @doc:research-findings.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "doc", slug: "research-findings", raw: "@doc:research-findings" },
      { kind: "text", text: "." },
    ]);
  });

  it("accepts a mixed-case input name with an underscore and a digit", () => {
    expect(parsePromptTokens("Research @input:Topic_2 now")).toEqual([
      { kind: "text", text: "Research " },
      { kind: "input", name: "Topic_2", raw: "@input:Topic_2" },
      { kind: "text", text: " now" },
    ]);
  });

  it("leaves an unknown sigil as plain text", () => {
    expect(parsePromptTokens("Contact @foo:bar for help")).toEqual([
      { kind: "text", text: "Contact @foo:bar for help" },
    ]);
  });

  it("leaves a bare sigil with nothing after the colon as plain text", () => {
    expect(parsePromptTokens("@input: nothing follows the colon")).toEqual([
      { kind: "text", text: "@input: nothing follows the colon" },
    ]);
  });

  it("reports a mis-cased sigil as malformed instead of a resolved reference", () => {
    // `@INPUT:` is the dangerous case: the substituting planes only recognize
    // the lowercase sigil, so a reference that reads as resolved here would
    // survive into the prompt verbatim at run time.
    expect(parsePromptTokens("@INPUT:topic and @Doc:notes")).toEqual([
      {
        kind: "malformed",
        sigil: "input",
        token: "topic",
        reason: "sigil_case",
        raw: "@INPUT:topic",
      },
      { kind: "text", text: " and " },
      {
        kind: "malformed",
        sigil: "doc",
        token: "notes",
        reason: "sigil_case",
        raw: "@Doc:notes",
      },
    ]);
  });

  it("reports an underscore in a doc slug as malformed, not as a shorter valid slug", () => {
    expect(parsePromptTokens("Write @doc:my_doc now")).toEqual([
      { kind: "text", text: "Write " },
      {
        kind: "malformed",
        sigil: "doc",
        token: "my_doc",
        reason: "invalid_token",
        raw: "@doc:my_doc",
      },
      { kind: "text", text: " now" },
    ]);
  });

  it("reports interior junk after an otherwise-valid slug as malformed, not a prefix match", () => {
    expect(parsePromptTokens("Open @doc:plan.md")).toEqual([
      { kind: "text", text: "Open " },
      {
        kind: "malformed",
        sigil: "doc",
        token: "plan.md",
        reason: "invalid_token",
        raw: "@doc:plan.md",
      },
    ]);
  });

  it("reports a leading-dash doc slug as malformed", () => {
    expect(parsePromptTokens("Open @doc:-bad")).toEqual([
      { kind: "text", text: "Open " },
      {
        kind: "malformed",
        sigil: "doc",
        token: "-bad",
        reason: "invalid_token",
        raw: "@doc:-bad",
      },
    ]);
  });

  it("reports a dash in an input name as malformed (dashes are node-id-only)", () => {
    expect(parsePromptTokens("@input:Ticket-ID")).toEqual([
      {
        kind: "malformed",
        sigil: "input",
        token: "Ticket-ID",
        reason: "invalid_token",
        raw: "@input:Ticket-ID",
      },
    ]);
  });

  it("reports a sigil followed only by prose punctuation as malformed", () => {
    expect(parsePromptTokens("Write @doc:, then stop")).toEqual([
      { kind: "text", text: "Write " },
      {
        kind: "malformed",
        sigil: "doc",
        token: "",
        reason: "missing_token",
        raw: "@doc:",
      },
      { kind: "text", text: ", then stop" },
    ]);
  });

  it("covers the whole string when segments are concatenated back together", () => {
    const prompt =
      "Resolve @input:ticket using @doc:runbook, then @INPUT:owner signs @doc:plan.md off.";
    const tokens = parsePromptTokens(prompt);
    const reassembled = tokens.map((token) =>
      token.kind === "text" ? token.text : token.raw
    ).join("");
    expect(reassembled).toBe(prompt);
  });
});

describe("collectPromptReferences", () => {
  it("dedupes repeated references, preserving first-appearance order", () => {
    const prompt =
      "Resolve @input:ticket, check @doc:notes, then @input:ticket again, " +
      "consult @input:other and @doc:notes once more.";
    expect(collectPromptReferences(prompt)).toEqual({
      inputs: ["ticket", "other"],
      docs: ["notes"],
      malformed: [],
    });
  });

  it("returns empty arrays for a prompt with no references", () => {
    expect(collectPromptReferences("Just investigate the issue.")).toEqual({
      inputs: [],
      docs: [],
      malformed: [],
    });
  });

  it("collects malformed references separately, deduped by source span", () => {
    expect(
      collectPromptReferences("@doc:my_doc, @input:ok, @doc:my_doc again"),
    ).toEqual({
      inputs: ["ok"],
      docs: [],
      malformed: [
        {
          sigil: "doc",
          token: "my_doc",
          reason: "invalid_token",
          raw: "@doc:my_doc",
        },
      ],
    });
  });
});

