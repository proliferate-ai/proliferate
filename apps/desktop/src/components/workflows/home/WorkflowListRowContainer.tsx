import { useMemo } from "react";
import {
  parseWorkflowDefinition,
  spineAgentNodes,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { runDotKind, coerceRunStatus } from "@proliferate/product-domain/workflows/run-status";
import { presetForRrule } from "@/lib/domain/automations/schedule/schedule";
import { formatScheduleControlLabel } from "@/lib/domain/automations/schedule/presentation";
import { useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowTriggers } from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import type { WorkflowResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import { WorkflowListRow, type WorkflowListRowView, type WorkflowRowTarget } from "./WorkflowListRow";

export interface WorkflowListRowContainerProps {
  workflow: WorkflowResponse;
  /** This workflow's most recent run, newest first (already sorted upstream). */
  lastRun: WorkflowRunResponse | null;
  lastRunAgoLabel: string | null;
  onOpen: (workflowId: string) => void;
  onRun: (workflow: WorkflowResponse, definition: WorkflowDefinition) => void;
  onEdit: (workflowId: string) => void;
  onArchive?: (workflowId: string) => void;
}

function rowTarget(mode: string | null | undefined): WorkflowRowTarget | null {
  if (mode === "personal_cloud") {
    return "cloud";
  }
  if (mode === "local") {
    return "local";
  }
  return null;
}

/**
 * Fetches a workflow's definition (agent/integration stacks) + triggers
 * (schedule chip) and renders the presentational list row. Details are cached
 * and the free-plan cap keeps row counts tiny, so per-row fetches are cheap.
 */
export function WorkflowListRowContainer({
  workflow,
  lastRun,
  lastRunAgoLabel,
  onOpen,
  onRun,
  onEdit,
  onArchive,
}: WorkflowListRowContainerProps) {
  const detail = useWorkflowDetail(workflow.id);
  const triggersQuery = useWorkflowTriggers(workflow.id);

  const definition = useMemo<WorkflowDefinition | null>(() => {
    const raw = detail.data?.currentVersion?.definition;
    return raw ? parseWorkflowDefinition(raw) : null;
  }, [detail.data]);

  const view = useMemo<WorkflowListRowView>(() => {
    const agents = definition ? spineAgentNodes(definition).map((node) => node.harness) : [];
    const scheduleTrigger = (triggersQuery.data ?? []).find(
      (trigger) => trigger.kind === "schedule" && trigger.enabled && trigger.schedule?.rrule,
    );
    const scheduleLabel = scheduleTrigger?.schedule?.rrule
      ? formatScheduleControlLabel(presetForRrule(scheduleTrigger.schedule.rrule), scheduleTrigger.schedule.rrule)
      : null;
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      agents,
      integrations: definition?.integrations ?? [],
      scheduleLabel,
      target: rowTarget(lastRun?.targetMode ?? scheduleTrigger?.targetMode),
      lastRun:
        lastRun && lastRunAgoLabel
          ? { dotKind: runDotKind(coerceRunStatus(lastRun.status)), agoLabel: lastRunAgoLabel }
          : null,
      isSeed: workflow.isSeed,
    };
  }, [workflow, definition, triggersQuery.data, lastRun, lastRunAgoLabel]);

  return (
    <WorkflowListRow
      view={view}
      runDisabled={definition === null}
      onOpen={() => onOpen(workflow.id)}
      onRun={() => {
        if (definition) {
          onRun(workflow, definition);
        }
      }}
      onEdit={() => onEdit(workflow.id)}
      onArchive={workflow.isSeed || !onArchive ? undefined : () => onArchive(workflow.id)}
    />
  );
}
