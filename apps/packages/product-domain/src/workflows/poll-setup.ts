/**
 * Pure mappings for the two RULED `/init` poll setup flows (mental-model §5,
 * RULED 2026-07-09; track 1d phase 2).
 *
 * Flow 1 (workflow-from-poll): the server probes `<endpoint>/init` and derives
 * a starting `inputs` skeleton from the sample item
 * (`derive_inputs_from_sample`, server-side). `deriveWorkflowInputsFromPollSample`
 * projects that wire shape into `WorkflowInputSpec[]` so a new definition can be
 * seeded with it directly.
 *
 * Flow 2 (poll-trigger-from-workflow): a `poll_signature_mismatch` error's
 * `extra_detail.mismatches` (`diff_item_against_schema`, server-side) is a flat
 * list of human-readable strings, one per field that doesn't track the
 * workflow's declared inputs. `parsePollSignatureMismatches` recovers the
 * field name from each message (best-effort) so the setup UI can render one row
 * per mismatched field instead of re-parsing a single concatenated message.
 */

import { WORKFLOW_INPUT_TYPES, WORKFLOW_MAX_ARGS, isWorkflowIdentifier, type WorkflowInputSpec, type WorkflowInputType } from "./definition";

/** The wire shape of one derived input (`PollInputSpecResponse`): `type` rides
 * over the network as a bare string, not yet narrowed to `WorkflowInputType`. */
export interface PollDerivedInputSpec {
  name: string;
  type: string;
  required: boolean;
}

/** The wire shape of one skipped sample field (`PollSkippedFieldResponse`): a
 * non-scalar (array/object/null) field the server couldn't turn into a v2 input,
 * with a human `reason` the flow-1 UI shows so the author knows what was left out. */
export interface PollSkippedField {
  name: string;
  reason: string;
}

function isWorkflowInputType(value: string): value is WorkflowInputType {
  return (WORKFLOW_INPUT_TYPES as readonly string[]).includes(value);
}

/**
 * Flow 1: project the server's derived-inputs skeleton into `WorkflowInputSpec[]`
 * a new definition's `inputs` can be set to directly. Defensive mirror of the
 * server's own derivation guarantees (legal identifier, known input type,
 * capped at `WORKFLOW_MAX_ARGS`, de-duplicated by name) — never throws on a
 * malformed entry, it just drops it, since a partial skeleton the author can
 * still fix by hand beats a hard failure at hand-off time.
 */
export function deriveWorkflowInputsFromPollSample(
  derivedInputs: readonly PollDerivedInputSpec[],
): WorkflowInputSpec[] {
  const inputs: WorkflowInputSpec[] = [];
  const seen = new Set<string>();
  for (const candidate of derivedInputs) {
    if (inputs.length >= WORKFLOW_MAX_ARGS) break;
    if (!isWorkflowIdentifier(candidate.name) || seen.has(candidate.name)) continue;
    if (!isWorkflowInputType(candidate.type)) continue;
    seen.add(candidate.name);
    inputs.push({ name: candidate.name, type: candidate.type, required: candidate.required });
  }
  return inputs;
}

/** One field-level entry in a poll-signature diff — `field` is `null` when the
 * message couldn't be attributed to a single declared input (e.g. a top-level
 * "data must be a JSON object" failure). */
export interface PollFieldMismatch {
  field: string | null;
  message: string;
}

// Mirrors poll_contract.py's diff_item_against_schema message shapes:
//   "data is missing required property 'foo'."
//   "data.foo must be of type 'string'."
//   "data.foo must be one of [...]."
const MISSING_PROPERTY_RE = /missing required property '([^']+)'/;
const FIELD_PATH_RE = /^data\.([A-Za-z_][A-Za-z0-9_]*)\b/;

/**
 * Flow 2: turn the structured `mismatches` list (an error's
 * `extra_detail.mismatches`, wired through `ProliferateClientError.details`)
 * into one row per field, so the setup UI can render a readable list rather
 * than a single run-on message.
 */
export function parsePollSignatureMismatches(
  mismatches: readonly string[],
): PollFieldMismatch[] {
  return mismatches.map((message) => {
    const missing = message.match(MISSING_PROPERTY_RE);
    if (missing) return { field: missing[1], message };
    const pathed = message.match(FIELD_PATH_RE);
    if (pathed) return { field: pathed[1], message };
    return { field: null, message };
  });
}
