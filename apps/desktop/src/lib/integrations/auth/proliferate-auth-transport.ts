import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api"

// The transport error/fetch primitives are product-owned (they are shared with
// the promoted public auth probes). This host module re-exports them through the
// package `internal/*` reverse seam so host and product share one
// `AuthRequestError` class (instanceof-stable) and one `isAbortError` predicate.
export {
  AuthRequestError,
  isDefinitiveAuthRejection,
  fetchAuthResponse,
  delay,
  parseAuthError,
  abortError,
  isAbortError,
} from "@proliferate/product-client/internal/lib/access/cloud/auth-transport"

// `buildAuthUrl` stays host: it defaults to the host deployment base URL, which
// only the host can read.
export function buildAuthUrl(path: string, baseUrl?: string): string {
  return buildProliferateApiUrl(path, baseUrl)
}
