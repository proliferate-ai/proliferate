/**
 * RFC 8785 (JCS) canonical JSON serialization.
 *
 * The workflow-run wire contract carries `bundleDigest` and
 * `runtimePayloadDigest` fields defined as "SHA-256 over the RFC 8785
 * canonical JSON bytes of the covered object". This module produces those
 * canonical bytes for TypeScript consumers. It has a Python twin
 * (`server/proliferate/server/workflows/domain/canonical.py`) and a Rust twin
 * (`anyharness/crates/anyharness-contract/src/canonical.rs`); the golden
 * fixtures under `fixtures/contracts/workflow-run/` are the cross-language
 * correctness fence.
 *
 * ECMAScript is the language RFC 8785 is defined against, so the scalar
 * rendering is native here: `JSON.stringify` on a string applies exactly the
 * minimal escaping, `JSON.stringify` on a finite number is exactly
 * `Number::toString` (including `-0` -> `"0"`), and the default string sort
 * compares UTF-16 code units.
 *
 * Validation posture (shared with the twins): each language rejects integer
 * literals outside the IEEE-754 exact range (`|integer| > 2**53`) wherever its
 * parser preserves the exact value — Python for every `int`, Rust for literals
 * fitting `i64`/`u64`. `JSON.parse` has already rounded such literals to a
 * double before this module can see them, so here (and in Rust for literals
 * overflowing `u64`/`i64`) they canonicalize as that double, byte-identically
 * across the two. The Python side is the strict gate at the Cloud write
 * boundary. Strings containing lone surrogates are rejected in every language
 * (Rust cannot even represent them), so no digest exists for them anywhere.
 *
 * Input must be a parsed JSON value (`null`, booleans, finite numbers,
 * strings, arrays, and plain objects). Anything else is rejected — including
 * non-plain objects such as `Date`, `Map`, `Set`, and class instances, whose
 * enumerable own keys (usually none) would otherwise silently canonicalize as
 * `{}` and produce a digest for a value that has no JSON identity.
 */

// A surrogate code unit that does not form a valid pair. Matched on UTF-16
// code units (no `u` flag) so a well-formed pair never matches.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeString(value: string): string {
  if (LONE_SURROGATE.test(value)) {
    throw new Error("Cannot canonicalize a string containing lone surrogates.");
  }
  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return serializeString(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("Cannot canonicalize a non-finite number.");
      }
      return JSON.stringify(value);
    }
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      if (!isPlainObject(value)) {
        throw new Error(
          "Cannot canonicalize a non-plain object (Date, Map, Set, and class instances have no JSON canonical form).",
        );
      }
      const record = value as Record<string, unknown>;
      // Default string sort is UTF-16 code-unit order, as RFC 8785 requires.
      const keys = Object.keys(record).sort();
      const members = keys.map(
        (key) => `${serializeString(key)}:${canonicalJson(record[key])}`,
      );
      return `{${members.join(",")}}`;
    }
    default:
      throw new Error(`Cannot canonicalize value of type ${typeof value}.`);
  }
}

/**
 * Members of a resolved run bundle covered by `bundleDigest` (PR2 design
 * §6.3). The wire wrapper (`contractVersion`, `runId`) is transport identity,
 * not logical content: two invocations with identical logical content share a
 * bundle digest regardless of run identity.
 */
const BUNDLE_DIGEST_FIELDS = [
  "definition",
  "arguments",
  "resolvedStages",
  "resolvedPlacement",
] as const;

/**
 * The canonical JSON text whose SHA-256 UTF-8 digest is `bundleDigest`:
 * ONLY the §6.3-covered bundle members, selected here so no call site can
 * accidentally widen the digest to the wire wrapper. Hashing stays with the
 * caller because this package must not assume a runtime crypto API.
 */
export function bundleDigestJson(bundle: unknown): string {
  if (!isPlainObject(bundle)) {
    throw new Error("Resolved bundle must be a plain JSON object.");
  }
  const covered: Record<string, unknown> = {};
  for (const field of BUNDLE_DIGEST_FIELDS) {
    if (!(field in bundle)) {
      throw new Error(`Resolved bundle is missing digest-covered field '${field}'.`);
    }
    covered[field] = bundle[field];
  }
  return canonicalJson(covered);
}

/**
 * The canonical JSON text whose SHA-256 UTF-8 digest is
 * `runtimePayloadDigest`: ONLY the immutable `run` object. The delivery wire
 * body is `{run, control}` plus the `expectedDataEpoch` transport
 * precondition; the epoch and the per-attempt monotonic `control` object are
 * excluded so a replay carrying updated cancellation state keeps the digest
 * of the first fixed payload.
 */
export function runtimePayloadDigestJson(payload: unknown): string {
  if (!isPlainObject(payload) || !("run" in payload)) {
    throw new Error("Delivery payload is missing the digest-covered 'run' object.");
  }
  return canonicalJson(payload.run);
}
