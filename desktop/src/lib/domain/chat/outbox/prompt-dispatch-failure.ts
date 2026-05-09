export interface PromptDispatchFailure {
  deliveryState: "failed_before_dispatch" | "unknown_after_dispatch";
  message: string;
}

export function classifyPromptDispatchFailure(
  error: unknown,
  requestStarted: boolean,
): PromptDispatchFailure {
  if (!requestStarted) {
    return {
      deliveryState: "failed_before_dispatch",
      message: sanitizePromptDispatchErrorMessage(error),
    };
  }
  const status = readErrorStatus(error);
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return {
      deliveryState: "failed_before_dispatch",
      message: sanitizePromptDispatchErrorMessage(error),
    };
  }
  return {
    deliveryState: "unknown_after_dispatch",
    message: sanitizePromptDispatchErrorMessage(error),
  };
}

function sanitizePromptDispatchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Prompt delivery failed.";
}

function readErrorStatus(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== "object" || depth > 2) {
    return null;
  }
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    problem?: { status?: unknown };
    response?: { status?: unknown };
    cause?: unknown;
  };
  if (typeof candidate.status === "number") {
    return candidate.status;
  }
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  if (typeof candidate.problem?.status === "number") {
    return candidate.problem.status;
  }
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }
  return readErrorStatus(candidate.cause, depth + 1);
}
