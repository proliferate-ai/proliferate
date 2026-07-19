import type { ReactElement } from "react"

import { HarnessUpdateToastPresenter } from "#product/components/feedback/HarnessUpdateToastPresenter"
import { SupportModalHost } from "#product/components/support/SupportModalHost"

/**
 * Product utility hosts that have no anonymous Web behavior.
 *
 * App lazy-loads this module for authenticated/auth-optional Web and for every
 * Desktop posture, preserving Desktop's pre-auth local-runtime behavior while
 * keeping the public Web login shell independent of agent and support trees.
 */
export default function ProductUtilityHosts(): ReactElement {
  return (
    <>
      <SupportModalHost />
      <HarnessUpdateToastPresenter />
    </>
  )
}
