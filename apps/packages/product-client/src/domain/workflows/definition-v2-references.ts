/**
 * Gen-2 prompt reference grammar: the `@input:`/`@doc:` token scan shared by
 * the structural validator (`definition-v2.ts`) and the builder's chip
 * rendering. Split from the validator to keep both under the max-lines
 * threshold; the seam matches the test split (`definition-v2-references.test.ts`
 * vs `definition-v2.test.ts`).
 *
 * One grammar, three planes (CP wire models, the runtime's definition.rs, and
 * this module): identifiers are case-SENSITIVE and each kind has its own body
 * class, so a reference that reads fine here is a reference the other two
 * planes will substitute.
 */

/** `@doc:` slugs are strict lowercase kebab-case (`research-findings`). */
export const DOC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `@input:` names are identifier-like, mixed case allowed (`Topic_2`). */
export const INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Node ids are identifier-like and additionally allow dashes (`n_research-2`). */
export const NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Characters that belong to the surrounding prose rather than to any of the
 * three grammars, and so end a reference when they trail it: `@doc:notes.` at
 * the end of a sentence is a reference to `notes` plus a full stop. Peeled off
 * the *end* only — junk in the middle (`@doc:plan.md`) is part of the token and
 * makes it malformed, which is the whole point: prefix-matching `plan` out of
 * `plan.md` is how a typo silently becomes a different, valid reference.
 */
const TRAILING_PROSE_PATTERN = /[.,;:!?)\]}>"'`*»”’…]+$/;

export type MalformedPromptReferenceReason =
  /** The sigil word is not exactly lowercase (`@INPUT:topic`). */
  | "sigil_case"
  /** Nothing but prose punctuation followed the sigil (`@doc:.`). */
  | "missing_token"
  /** The token does not match its kind's grammar (`@doc:my_doc`). */
  | "invalid_token";

export interface MalformedPromptReference {
  /** Which grammar the author reached for, normalized to lower case. */
  sigil: "input" | "doc";
  /** The token as typed, with trailing prose punctuation removed. */
  token: string;
  reason: MalformedPromptReferenceReason;
  /** The exact source span, sigil included. */
  raw: string;
}

export type PromptToken =
  | { kind: "text"; text: string }
  | { kind: "input"; name: string; raw: string }
  | { kind: "doc"; slug: string; raw: string }
  | ({ kind: "malformed" } & MalformedPromptReference);

/**
 * Splits a prompt into an ordered sequence of text/`@input:`/`@doc:`/malformed
 * segments.
 *
 * Scanning and validation are two steps on purpose. The scan finds a sigil
 * followed by a run of non-space, non-`@` characters (so back-to-back
 * references still separate) and takes that whole run as the token; only then
 * is the token checked against its kind's grammar. A token that fails is a
 * `malformed` segment — an error the caller reports — never a silent non-match
 * and never a prefix match against the valid leading part of a typo.
 *
 * The sigil word is *found* case-insensitively but only accepted in lower
 * case: `@INPUT:topic` is a malformed reference, because the planes that
 * substitute references only recognize `@input:` and would leave it in the
 * prompt verbatim. Unknown sigils (`@foo:`) are not references at all and stay
 * plain text, as does a bare `@input:` with nothing after the colon — that is
 * a half-typed reference, not a wrong one.
 */
export function parsePromptTokens(prompt: string): PromptToken[] {
  // A fresh RegExp per call: a shared module-level `g` regex carries mutable
  // `lastIndex` state across calls, which would corrupt repeat invocations —
  // this parser is expected to run on every keystroke from chip rendering.
  const pattern = /@(input|doc):([^\s@]+)/gi;
  const tokens: PromptToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    const [, sigilText, candidate] = match;
    const token = candidate.replace(TRAILING_PROSE_PATTERN, "");
    // `@` + sigil word + `:` + token: the trailing prose peeled off the
    // candidate is not part of the reference and goes back to the text stream.
    const consumed = 1 + sigilText.length + 1 + token.length;
    const raw = prompt.slice(match.index, match.index + consumed);
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: prompt.slice(lastIndex, match.index) });
    }
    const sigil = sigilText.toLowerCase() === "input" ? "input" : "doc";
    const reason = malformedReferenceReason(sigilText, sigil, token);
    if (reason !== null) {
      tokens.push({ kind: "malformed", sigil, token, reason, raw });
    } else if (sigil === "input") {
      tokens.push({ kind: "input", name: token, raw });
    } else {
      tokens.push({ kind: "doc", slug: token, raw });
    }
    lastIndex = match.index + consumed;
    // Rewind the scanner over the peeled prose so it is scanned like any other
    // text rather than skipped. `consumed` always covers at least `@doc:`, so
    // this cannot fail to advance.
    pattern.lastIndex = lastIndex;
  }
  if (lastIndex < prompt.length) {
    tokens.push({ kind: "text", text: prompt.slice(lastIndex) });
  }
  return tokens;
}

/** `null` when the reference is well-formed for its kind. */
function malformedReferenceReason(
  sigilText: string,
  sigil: "input" | "doc",
  token: string,
): MalformedPromptReferenceReason | null {
  if (sigilText !== sigil) {
    return "sigil_case";
  }
  if (token.length === 0) {
    return "missing_token";
  }
  const grammar = sigil === "input" ? INPUT_NAME_PATTERN : DOC_SLUG_PATTERN;
  return grammar.test(token) ? null : "invalid_token";
}

/** Why a malformed reference is malformed, as a message fragment. */
export function describeMalformedReference(
  reference: MalformedPromptReference,
): string {
  switch (reference.reason) {
    case "sigil_case":
      return `the sigil must be lowercase “@${reference.sigil}:”`;
    case "missing_token":
      return reference.sigil === "input"
        ? "“@input:” must be followed by an input name"
        : "“@doc:” must be followed by a doc slug";
    case "invalid_token":
      return reference.sigil === "input"
        ? `input name “${reference.token}” must start with a letter and use only ` +
          "letters, digits, and underscores"
        : `doc slug “${reference.token}” must be lowercase kebab-case: letters and ` +
          "digits joined by single dashes";
  }
}

export interface PromptReferences {
  inputs: string[];
  docs: string[];
  malformed: MalformedPromptReference[];
}

/**
 * Distinct `@input:`/`@doc:` references in a prompt, in first-appearance
 * order, plus every malformed reference (deduped by source span).
 */
export function collectPromptReferences(prompt: string): PromptReferences {
  const inputs: string[] = [];
  const docs: string[] = [];
  const malformed: MalformedPromptReference[] = [];
  const seenInputs = new Set<string>();
  const seenDocs = new Set<string>();
  const seenMalformed = new Set<string>();
  for (const token of parsePromptTokens(prompt)) {
    if (token.kind === "input") {
      if (!seenInputs.has(token.name)) {
        seenInputs.add(token.name);
        inputs.push(token.name);
      }
    } else if (token.kind === "doc") {
      if (!seenDocs.has(token.slug)) {
        seenDocs.add(token.slug);
        docs.push(token.slug);
      }
    } else if (token.kind === "malformed") {
      if (!seenMalformed.has(token.raw)) {
        seenMalformed.add(token.raw);
        malformed.push({
          sigil: token.sigil,
          token: token.token,
          reason: token.reason,
          raw: token.raw,
        });
      }
    }
  }
  return { inputs, docs, malformed };
}
