import type { ProblemDetails } from "../types/runtime.js";

interface ProblemDetailsFallback {
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

  return problem;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}
