import type { FunctionInvocationMethod } from "@proliferate/cloud-sdk/client/integrations";

/**
 * Presentation logic for the personal "Functions" settings pane (track 1b
 * phase 3, below Integrations): the create/edit form validation mirrors the
 * server's rules (name shape, method enum, URL, args-schema JSON), so the
 * common mistakes surface inline before a round trip.
 */

export const FUNCTION_INVOCATION_METHODS: FunctionInvocationMethod[] = [
  "get",
  "post",
  "patch",
  "put",
  "delete",
];

/** Mirrors the server's invocation-name rule — this is the gateway tool
 * address the agent calls, so it's slug-shaped and immutable post-create. */
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface FunctionInvocationFormInput {
  name: string;
  displayName: string;
  description: string;
  endpointUrl: string;
  method: string;
  /** Raw textarea contents; empty means "no schema" (`{}`). */
  argsSchemaText: string;
}

export interface FunctionInvocationFormErrors {
  name?: string;
  endpointUrl?: string;
  method?: string;
  argsSchemaText?: string;
}

/**
 * Validates the create/edit form. `null` means valid — call
 * `parseFunctionInvocationArgsSchema` next to get the JSON-parsed schema.
 */
export function validateFunctionInvocationForm(
  input: FunctionInvocationFormInput,
): FunctionInvocationFormErrors | null {
  const errors: FunctionInvocationFormErrors = {};
  if (!NAME_PATTERN.test(input.name.trim())) {
    errors.name =
      "Use 1-64 lowercase letters, digits, or '_', starting with a letter — this is "
      + "the name the agent calls.";
  }
  if (!isValidEndpointUrl(input.endpointUrl.trim())) {
    errors.endpointUrl = "Enter a valid http(s) URL.";
  }
  if (!FUNCTION_INVOCATION_METHODS.includes(input.method.trim().toLowerCase() as FunctionInvocationMethod)) {
    errors.method = "Choose a method.";
  }
  if (parseArgsSchemaText(input.argsSchemaText) === undefined) {
    errors.argsSchemaText = "Args schema must be valid JSON for a JSON Schema object.";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** Parses the args-schema textarea into the request payload. Call only after
 * `validateFunctionInvocationForm` returns `null`. */
export function parseFunctionInvocationArgsSchema(
  argsSchemaText: string,
): Record<string, unknown> {
  return parseArgsSchemaText(argsSchemaText) ?? {};
}

/** `undefined` = invalid (not JSON, or not a JSON object); anything else is
 * the parsed object (empty text is treated as `{}` — no schema). */
function parseArgsSchemaText(argsSchemaText: string): Record<string, unknown> | undefined {
  const trimmed = argsSchemaText.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function isValidEndpointUrl(value: string): boolean {
  if (!value) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "";
}

export function functionInvocationMethodLabel(method: string): string {
  return method.toUpperCase();
}

/** Row status chip text for the §2 per-invocation default-access toggle. */
export function functionInvocationChatScopeLabel(chatScopeEnabled: boolean): string {
  return chatScopeEnabled ? "Enabled for chat" : "Workflow only";
}

/**
 * Inline message for a failed create/edit/rotate call. API validation errors
 * (invalid_payload, function_invocation_name_taken, ...) carry a
 * human-readable message; anything else falls back to a generic line.
 */
export function functionInvocationSubmitError(apiMessage: string | null): string {
  if (apiMessage) {
    return apiMessage;
  }
  return "The function could not be saved. Try again.";
}
