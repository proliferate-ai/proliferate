import { useMemo, useState } from "react";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { Zap } from "@proliferate/ui/icons";
import { useWorkflows, useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import {
  useWorkflowRunLauncher,
  type WorkflowChatOrigin,
} from "@/hooks/access/cloud/workflows/use-workflow-run-launcher";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  isCloudWorkspaceId,
  parseCloudWorkspaceSyntheticId,
} from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";

const COMPOSER_WORKFLOW_LIST_LIMIT = 8;

export interface ComposerWorkflowRunButtonProps {
  /** The chat's own session/workspace (spec run-from-chat R1 door 1) — the
   * affordance is hidden until a session + workspace exist (nothing to bind
   * or run against yet). */
  activeSessionId: string | null;
  harness: string | null;
  workspaceUiKey: string | null;
}

/**
 * The composer's "run a workflow" door (R1's third entry point, gap①). A
 * lightning-bolt icon button beside the other composer controls opens a
 * quiet picker of the org's workflows; picking one opens the SAME
 * `WorkflowRunArgsModal` via `useWorkflowRunLauncher`, pre-targeted at this
 * chat's workspace with the current session offered as a bind candidate.
 */
export function ComposerWorkflowRunButton({
  activeSessionId,
  harness,
  workspaceUiKey,
}: ComposerWorkflowRunButtonProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const workflowsQuery = useWorkflows();
  const launcher = useWorkflowRunLauncher();
  const sessionTitle = useSessionDirectoryStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.title ?? null : null,
  );

  const workflows = useMemo(
    () => (workflowsQuery.data?.workflows ?? []).slice(0, COMPOSER_WORKFLOW_LIST_LIMIT),
    [workflowsQuery.data],
  );

  if (!workspaceUiKey || workflows.length === 0) {
    return null;
  }

  const chatOriginBase: Omit<WorkflowChatOrigin, "sessionId" | "harness"> = isCloudWorkspaceId(workspaceUiKey)
    ? {
        title: sessionTitle,
        targetMode: "personal_cloud" as WorkflowTargetMode,
        workspaceId: parseCloudWorkspaceSyntheticId(workspaceUiKey) ?? workspaceUiKey,
      }
    : {
        title: sessionTitle,
        targetMode: "local" as WorkflowTargetMode,
        workspaceId: workspaceUiKey,
      };

  const chatOrigin: WorkflowChatOrigin | undefined =
    activeSessionId && harness
      ? { ...chatOriginBase, sessionId: activeSessionId, harness }
      : undefined;

  return (
    <>
      <PopoverButton
        trigger={(
          <ComposerControlButton
            iconOnly
            icon={<Zap className="size-4" />}
            label="Run a workflow"
            title="Run a workflow"
            aria-label="Run a workflow"
          />
        )}
        align="end"
        side="top"
        offset={8}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        onOpenChange={setPopoverOpen}
      >
        {(close) => (
          <ComposerPopoverSurface className="w-64 p-1.5">
            <div className="space-y-0.5">
              {workflows.map((workflow) => (
                <ComposerWorkflowMenuItem
                  key={workflow.id}
                  workflow={workflow}
                  enabled={popoverOpen}
                  onSelect={(definition) => {
                    close();
                    launcher.open(workflow, definition, chatOrigin);
                  }}
                />
              ))}
            </div>
          </ComposerPopoverSurface>
        )}
      </PopoverButton>
      {launcher.modal}
    </>
  );
}

/** One picker row — prefetches its definition while the popover is open so
 * selecting it can open the launch modal immediately (same lazy-fetch shape
 * as `WorkflowRecommendedCard`). */
function ComposerWorkflowMenuItem({
  workflow,
  enabled,
  onSelect,
}: {
  workflow: WorkflowResponse;
  enabled: boolean;
  onSelect: (definition: WorkflowDefinition) => void;
}) {
  const detail = useWorkflowDetail(workflow.id, enabled);
  const definition = useMemo<WorkflowDefinition | null>(() => {
    const raw = detail.data?.currentVersion?.definition;
    return raw ? parseWorkflowDefinition(raw) : null;
  }, [detail.data]);

  return (
    <PopoverMenuItem
      label={workflow.name}
      disabled={!definition}
      onClick={() => {
        if (definition) {
          onSelect(definition);
        }
      }}
    />
  );
}
