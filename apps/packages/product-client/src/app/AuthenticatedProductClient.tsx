import type { ReactElement } from "react"

import { AddRepoFlowHost } from "#product/components/workspace/repo-setup/AddRepoFlowHost"
import { CloudRepoActionDialogHost } from "#product/components/workspace/repo-setup/CloudRepoActionDialogHost"
import { KeyboardShortcutsDialog } from "#product/components/workspace/shell/sidebar/KeyboardShortcutsDialog"
import { HarnessUpdateToastPresenter } from "#product/components/feedback/HarnessUpdateToastPresenter"
import { WorkflowResumePopoverPresenter } from "#product/components/workflows/run-view/WorkflowResumePopoverPresenter"
import { AuthenticatedAppHost } from "#product/pages/AuthenticatedAppHost"
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider"
import { WorkspaceArchiveActionsProvider } from "#product/providers/WorkspaceArchiveActionsProvider"
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
    <WorkspaceArchiveActionsProvider>
      <CoworkThreadLaunchProvider>
        <AuthenticatedAppHost />
        <AddRepoFlowHost />
        <CloudRepoActionDialogHost />
        <HarnessUpdateToastPresenter />
        <WorkflowResumePopoverPresenter />
        <KeyboardShortcutsDialog />
      </CoworkThreadLaunchProvider>
    </WorkspaceArchiveActionsProvider>
  )
}
