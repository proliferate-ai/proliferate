import type { ReactElement } from "react"

import { AddRepoFlowHost } from "#product/components/workspace/repo-setup/AddRepoFlowHost"
import { CloudRepoActionDialogHost } from "#product/components/workspace/repo-setup/CloudRepoActionDialogHost"
import { MaterializationHealthPassHost } from "#product/components/workspace/repo-setup/MaterializationHealthPassHost"
import { RepoSetupModalHost } from "#product/components/workspace/repo-setup/RepoSetupModalHost"
import { WorkspaceAvailabilityActionHost } from "#product/components/workspace/repo-setup/WorkspaceAvailabilityActionHost"
import { HarnessUpdateToastPresenter } from "#product/components/feedback/HarnessUpdateToastPresenter"
import { AuthenticatedAppHost } from "#product/pages/AuthenticatedAppHost"
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider"
import "./authenticated.css"

/**
 * Internal, lazy-loaded authenticated product root.
 *
 * Loaded via `React.lazy(() => import("#product/app/AuthenticatedProductClient"))`
 * from the public shell (`App`), so the authenticated app host subtree and its
 * repository/workspace hosts are a dynamic chunk that login/public routes
 * never eagerly pull. It is a stable default export because that is the shape
 * `React.lazy` requires.
 */
export default function AuthenticatedProductClient(): ReactElement {
  return (
    <CoworkThreadLaunchProvider>
      <AuthenticatedAppHost />
      <RepoSetupModalHost />
      <AddRepoFlowHost />
      <CloudRepoActionDialogHost />
      <WorkspaceAvailabilityActionHost />
      <MaterializationHealthPassHost />
      <HarnessUpdateToastPresenter />
    </CoworkThreadLaunchProvider>
  )
}
