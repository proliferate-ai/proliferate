import type { ReactElement } from "react"

import { AuthenticatedAppHost } from "#product/pages/AuthenticatedAppHost"

/**
 * Internal, lazy-loaded authenticated product root.
 *
 * Loaded via `React.lazy(() => import("#product/app/AuthenticatedProductClient"))`
 * from the public shell (`App`), so the authenticated app host subtree (and its
 * editor/terminal chunks) is a dynamic chunk that the login/public routes never
 * eagerly pull. It is a stable default export because that is the shape
 * `React.lazy` requires.
 */
export default function AuthenticatedProductClient(): ReactElement {
  return <AuthenticatedAppHost />
}
