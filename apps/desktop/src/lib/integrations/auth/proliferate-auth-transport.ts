import {
  buildProliferateApiUrl,
} from "@/lib/infra/proliferate-api"

const CLOUD_UNAVAILABLE_MESSAGE =
  "Could not reach the Proliferate cloud. Local workspaces still work; sign-in requires the control plane."

export class AuthRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "AuthRequestError"
    this.status = status
  }
}

// True only when the server definitively rejected the credentials. Network
// failures are normalized to AuthRequestError(503) by normalizeTransportError,
// so an instanceof check alone would treat offline launches as sign-outs.
export function isDefinitiveAuthRejection(error: unknown): boolean {
  return (
    error instanceof AuthRequestError &&
    (error.status === 401 || error.status === 403)
  )
}

export function buildAuthUrl(path: string, baseUrl?: string): string {
  return buildProliferateApiUrl(path, baseUrl)
}

export async function fetchAuthResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw normalizeTransportError(error)
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    function onAbort() {
      window.clearTimeout(timeout)
      reject(abortError())
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function parseAuthError(response: Response): Promise<AuthRequestError> {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    if (typeof payload.detail === "string") {
      return new AuthRequestError(payload.detail, response.status)
    }
  } catch {
    // Fall through to status text.
  }

  return new AuthRequestError(
    response.statusText || "Authentication request failed",
    response.status,
  )
}

export function abortError(message = "Aborted"): Error {
  return new DOMException(message, "AbortError")
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError"
}

function normalizeTransportError(error: unknown): Error {
  if (isAbortError(error)) {
    return error
  }

  if (error instanceof AuthRequestError) {
    return error
  }

  return new AuthRequestError(CLOUD_UNAVAILABLE_MESSAGE, 503)
}
