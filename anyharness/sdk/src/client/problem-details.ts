import type { ProblemDetails } from "../types/runtime.js";

/**
 * RFC 7807 normalization: what the client is willing to believe about an error
 * body, and what it deliberately refuses to reshape.
 *
 * Lifted out of `core.ts` because it is a self-contained decision table, not
 * transport plumbing — and because `core.ts` is at its line cap.
 */

export interface ProblemDetailsFallback {
  title: string;
  status: number;
}

export function normalizeProblemDetails(
  value: unknown,
  fallback: ProblemDetailsFallback,
): ProblemDetails {
  const source = isJsonObject(value) ? value : {};
  const problem: ProblemDetails = {
    type: typeof source.type === "string" ? source.type : "about:blank",
    title: typeof source.title === "string" ? source.title : fallback.title,
    status: isHttpStatus(source.status) ? source.status : fallback.status,
  };

  if (typeof source.code === "string" || source.code === null) {
    problem.code = source.code;
  }
  if (typeof source.detail === "string" || source.detail === null) {
    problem.detail = source.detail;
  }
  if (typeof source.instance === "string" || source.instance === null) {
    problem.instance = source.instance;
  }
  // `extra` is the RFC 7807 extension slot the runtime uses for structured
  // refusal payloads (the unarchive scenario body, the git-lock file path). It is
  // passed through UNTOUCHED and unvalidated on purpose: this normalizer's job is
  // the envelope, and reshaping the payload here would silently drop whichever
  // key a future refusal adds — the dialog that renders it is the only thing that
  // knows the shape.
  if (source.extra !== undefined) {
    problem.extra = source.extra;
  }

  return problem;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}
