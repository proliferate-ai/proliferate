import { useMemo } from "react";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { buildWorkflowCardView } from "@proliferate/product-domain/workflows/presentation";
import type { WorkflowLastRunView } from "@proliferate/product-domain/workflows/presentation";
import type { WorkflowStatusTone } from "@proliferate/product-domain/workflows/run-status";
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";
import { WorkflowCard } from "./WorkflowCard";

export interface WorkflowCardContainerProps {
  workflow: WorkflowResponse;
  lastRun: WorkflowLastRunView | null;
  lastRunTone: WorkflowStatusTone;
  runBusy?: boolean;
  onOpen: (workflowId: string) => void;
  onRun: (workflow: WorkflowResponse, definition: WorkflowDefinition) => void;
}

/**
 * Fetches a workflow's current definition (for the glyph strip + Run args gate)
 * and renders the presentational card. Detail is cached; the free-plan cap keeps
 * the number of cards tiny.
 */
export function WorkflowCardContainer({
  workflow,
  lastRun,
  lastRunTone,
  runBusy = false,
  onOpen,
  onRun,
}: WorkflowCardContainerProps) {
  const detail = useWorkflowDetail(workflow.id);
  const definition = useMemo<WorkflowDefinition | null>(() => {
    const raw = detail.data?.currentVersion?.definition;
    return raw ? parseWorkflowDefinition(raw) : null;
  }, [detail.data]);

  const view = useMemo(
    () =>
      buildWorkflowCardView({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        definition: definition ?? parseWorkflowDefinition(null),
        lastRun,
      }),
    [workflow.id, workflow.name, workflow.description, definition, lastRun],
  );

  return (
    <WorkflowCard
      view={view}
      lastRunTone={lastRunTone}
      runBusy={runBusy}
      runDisabled={definition === null}
      onOpen={() => onOpen(workflow.id)}
      onRun={() => {
        if (definition) {
          onRun(workflow, definition);
        }
      }}
    />
  );
}
