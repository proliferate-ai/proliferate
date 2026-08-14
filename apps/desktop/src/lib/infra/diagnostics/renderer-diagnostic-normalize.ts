// Turns arbitrary renderer field values into bounded contract argument values.
// Every path that loses information sets `structural` so the emitted record
// declares itself redacted rather than silently shrinking.

import type { ArgumentValueV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import {
  MAX_ARGUMENT_DEPTH,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_ARGUMENT_OBJECT_FIELDS,
  MAX_SAFE_INTEGER,
  MAX_STRING_BYTES,
} from "@proliferate/product-client/internal/domain/diagnostics/limits";
import { isRendererDiagnosticSecretKey as isSecretKey } from "./renderer-diagnostic-secret-keys";
import { isName, isPlainRecord, textEncoder } from "./renderer-diagnostic-shape";
import { filterRendererDiagnosticText } from "./renderer-diagnostic-text";

export interface NormalizationState {
  structural: boolean;
  ancestors: Set<object>;
  remainingNodes: number;
  remainingValueBytes: number;
}

export function normalizeValue(
  value: unknown,
  depth: number,
  state: NormalizationState,
): ArgumentValueV1 {
  if (!reserveNormalizationNode(state)) {
    return marker("[truncated]", state);
  }
  if (typeof value === "string") {
    return {
      type: "string",
      value: consumeNormalizationText(
        filterText(value, MAX_STRING_BYTES, state),
        state,
      ),
    };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return marker(`[number:${String(value)}]`, state);
    }
    if (Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_INTEGER) {
      return { type: "integer", value };
    }
    return { type: "float", value };
  }
  if (value === null) {
    return marker("[null]", state);
  }
  if (typeof value !== "object") {
    return marker(`[${typeof value}]`, state);
  }
  if (depth >= MAX_ARGUMENT_DEPTH) {
    return marker("[truncated]", state);
  }
  if (state.ancestors.has(value)) {
    return marker("[circular]", state);
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return marker("[object]", state);
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const output: ArgumentValueV1[] = [];
      const limit = Math.min(value.length, MAX_ARGUMENT_LIST_ITEMS);
      for (let index = 0; index < limit; index += 1) {
        if (!normalizationBudgetAvailable(state)) {
          output.push(marker("[truncated]", state));
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        output.push(
          descriptor?.enumerable === true && "value" in descriptor
            ? normalizeValue(descriptor.value, depth + 1, state)
            : marker("[accessor]", state),
        );
      }
      if (value.length > MAX_ARGUMENT_LIST_ITEMS) {
        state.structural = true;
        output[MAX_ARGUMENT_LIST_ITEMS - 1] = marker("[truncated]", state);
      }
      return { type: "list", value: output };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return marker("[object]", state);
    }

    const output: Record<string, ArgumentValueV1> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    let admitted = 0;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) {
        continue;
      }
      if (admitted >= MAX_ARGUMENT_OBJECT_FIELDS) {
        state.structural = true;
        break;
      }
      if (isSecretKey(key)) {
        state.structural = true;
        continue;
      }
      if (!isName(key)) {
        state.structural = true;
        continue;
      }
      if (!consumeNormalizationKey(key, state)) {
        state.structural = true;
        break;
      }
      output[key] = "value" in descriptor
        ? normalizeValue(descriptor.value, depth + 1, state)
        : marker("[accessor]", state);
      admitted += 1;
    }
    return { type: "object", value: output };
  } finally {
    state.ancestors.delete(value);
  }
}

export function marker(value: string, state: NormalizationState): ArgumentValueV1 {
  state.structural = true;
  return { type: "string", value };
}

export function filterText(
  input: string,
  limit: number,
  state: NormalizationState,
): string {
  const filtered = filterRendererDiagnosticText(input, limit);
  state.structural ||= filtered.structural;
  return filtered.value;
}

function normalizationBudgetAvailable(state: NormalizationState): boolean {
  return state.remainingNodes > 0 && state.remainingValueBytes > 0;
}

function reserveNormalizationNode(state: NormalizationState): boolean {
  if (!normalizationBudgetAvailable(state)) {
    state.structural = true;
    return false;
  }
  state.remainingNodes -= 1;
  state.remainingValueBytes = Math.max(0, state.remainingValueBytes - 16);
  return true;
}

function consumeNormalizationKey(key: string, state: NormalizationState): boolean {
  const bytes = textEncoder.encode(key).byteLength;
  if (bytes > state.remainingValueBytes) {
    return false;
  }
  state.remainingValueBytes -= bytes;
  return true;
}

function consumeNormalizationText(value: string, state: NormalizationState): string {
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes <= state.remainingValueBytes) {
    state.remainingValueBytes -= bytes;
    return value;
  }
  state.remainingValueBytes = 0;
  state.structural = true;
  return "[truncated]";
}
