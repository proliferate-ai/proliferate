import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createEmptyDefinition,
  isParallelGroup,
  serializeWorkflowDefinition,
  type WorkflowAgentNode,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTemplate } from "@proliferate/product-domain/workflows/templates";
import { deriveWorkflowInputsFromPollSample } from "@proliferate/product-domain/workflows/poll-setup";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflowMutations } from "@/hooks/access/cloud/workflows/use-workflow-mutations";
import { useInspectPollEndpoint } from "@/hooks/access/cloud/workflows/use-inspect-poll-endpoint";
import type { PollInspectResponse } from "@/hooks/access/cloud/workflows/types";
import type { WorkflowPollInspectSubmit } from "@/components/workflows/home/WorkflowPollInspectModal";

interface DesktopCatalogAgent {
  kind: string;
  defaultModelId: string | null;
  models: { id: string }[];
}

function defaultNodeFromCatalog(agents: readonly DesktopCatalogAgent[] | undefined): WorkflowAgentNode {
  const agent = agents?.[0];
  return {
    slot: "main",
    harness: agent?.kind ?? "claude",
    model: agent?.defaultModelId ?? agent?.models[0]?.id ?? "sonnet",
    steps: [],
  };
}

/** Re-default the template's first agent node to the owner's first catalog agent. */
function withDefaultAgent(
  definition: WorkflowDefinition,
  agents: readonly DesktopCatalogAgent[] | undefined,
): WorkflowDefinition {
  const agent = agents?.[0];
  const [first, ...rest] = definition.agents;
  // Seed templates are single-node; a parallel-group first entry is left as-is
  // (re-defaulting a group's harness/model is the editor phase's concern).
  if (!agent || !first || isParallelGroup(first)) {
    return definition;
  }
  return {
    ...definition,
    agents: [
      { ...first, harness: agent.kind, model: agent.defaultModelId ?? agent.models[0]?.id ?? first.model },
      ...rest,
    ],
  };
}

/**
 * Workflow-creation orchestration for the home screen (WS0B-U): start from
 * scratch, start from a template, and the two-phase workflow-from-poll flow
 * (probe `/init`, review the derived inputs, then hand off — mental-model
 * §5). Every path ends the same way: create the workflow, then navigate into
 * its editor.
 */
export function useWorkflowCreateFlows() {
  const navigate = useNavigate();
  const catalogQuery = useCloudAgentCatalog();
  const { createMutation } = useWorkflowMutations();
  const inspectPollMutation = useInspectPollEndpoint();

  const [createError, setCreateError] = useState<string | null>(null);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<PollInspectResponse | null>(null);

  const agents = catalogQuery.data?.agents as DesktopCatalogAgent[] | undefined;

  const createAndEdit = (name: string, description: string | null, definition: WorkflowDefinition) => {
    setCreateError(null);
    createMutation.mutate(
      {
        name,
        description: description ?? undefined,
        definition: serializeWorkflowDefinition(definition),
      },
      {
        onSuccess: (detail) => navigate(`/workflows/${detail.workflow.id}/edit`),
        // Surfaced through the same banner as run errors — a silent create
        // failure otherwise just stops the spinner with no explanation.
        onError: (error) => setCreateError(error.message),
      },
    );
  };

  const startFromScratch = () =>
    createAndEdit("Untitled workflow", null, createEmptyDefinition(defaultNodeFromCatalog(agents)));

  const useTemplate = (template: WorkflowTemplate) =>
    createAndEdit(template.name, template.description, withDefaultAgent(template.definition, agents));

  // Flow 1 (workflow-from-poll, mental-model §5): probe /init, derive a starting
  // `inputs` skeleton from the sample, then hand off into the editor exactly like
  // any other creation path (`createAndEdit`) — a bad /init is a hard error shown
  // in the modal, nothing is created.
  const openPollModal = () => {
    setPollError(null);
    setPollResult(null);
    setPollModalOpen(true);
  };

  const closePollModal = () => {
    setPollModalOpen(false);
    setPollError(null);
    setPollResult(null);
  };

  // Phase 1: probe /init and hold the result so the modal can review it (derived
  // inputs + any sample fields that couldn't become inputs) before hand-off.
  const startFromPoll = (submit: WorkflowPollInspectSubmit) => {
    setPollError(null);
    inspectPollMutation.mutate(
      { url: submit.url, authHeader: submit.authHeader, authValue: submit.authValue },
      {
        onSuccess: (result) => setPollResult(result),
        onError: (error) => setPollError(error.message),
      },
    );
  };

  // Phase 2: seed a new definition with the derived inputs and hand off into the
  // editor exactly like any other creation path (`createAndEdit`).
  const confirmFromPoll = () => {
    if (!pollResult) return;
    const inputs = deriveWorkflowInputsFromPollSample(pollResult.derivedInputs);
    const definition = {
      ...createEmptyDefinition(defaultNodeFromCatalog(agents)),
      inputs,
    };
    closePollModal();
    createAndEdit("Untitled workflow", null, definition);
  };

  return {
    createError,
    isCreating: createMutation.isPending,
    isInspectingPoll: inspectPollMutation.isPending,
    startFromScratch,
    useTemplate,
    pollModalOpen,
    pollError,
    pollResult,
    openPollModal,
    closePollModal,
    startFromPoll,
    confirmFromPoll,
  };
}
