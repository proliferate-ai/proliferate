import { useMemo } from "react";
import {
  parseWorkflowDefinition,
  spineAgentNodes,
  type WorkflowDefinition,
} from "@proliferate/product-domain/workflows/definition";
import { workflowStepStrip } from "@proliferate/product-domain/workflows/presentation";
import {
  annotateIntegrationReadiness,
  orderRecommendedWorkflows,
  readinessChipLabel,
  type RecommendedWorkflowView,
} from "@proliferate/product-domain/workflows/run-launch";
import { WorkflowStepGlyphStrip } from "@proliferate/product-ui/workflows/WorkflowStepGlyphStrip";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Play } from "@proliferate/ui/icons";
import { useWorkflows, useWorkflowRuns, useWorkflowDetail } from "@/hooks/access/cloud/workflows/use-workflows";
import { useWorkflowsEnabled } from "@/hooks/access/cloud/use-server-features";
import { useWorkflowRunLauncher } from "@/hooks/access/cloud/workflows/use-workflow-run-launcher";
import { useCloudIntegrations } from "@/hooks/cloud/facade/use-cloud-integrations";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import type { WorkflowResponse } from "@/hooks/access/cloud/workflows/types";

const DEFAULT_STRIP_LIMIT = 4;

interface WorkflowRecommendedStripProps {
  /** Cap the number of cards shown (R5 strip). */
  limit?: number;
}

/**
 * The R5 "Recommended workflows" strip — the org's own workflows, most-recently
 * run first (seeds included; the seeding pass takes over later). One of the
 * three R1 launch doors: cards open the SAME launch modal via the shared
 * launcher. Renders nothing until the org has at least one workflow.
 */
export function WorkflowRecommendedStrip({ limit = DEFAULT_STRIP_LIMIT }: WorkflowRecommendedStripProps) {
  const workflowsEnabled = useWorkflowsEnabled();
  const workflowsQuery = useWorkflows(false, workflowsEnabled);
  const runsQuery = useWorkflowRuns(null);
  const launcher = useWorkflowRunLauncher();
  const { activeOrganizationId } = useActiveOrganization();
  const { integrations: cloudIntegrations } = useCloudIntegrations(activeOrganizationId);

  const workflows = workflowsQuery.data?.workflows ?? [];
  const runs = runsQuery.data?.runs ?? [];
  // D-003 launch flag read after the hooks (hook order), before any render.
  const stripHidden = !workflowsEnabled;

  // Readiness chip (spec 5.3 honesty rule): a namespace only counts as
  // connected when there's a ready account behind it — same bar as the
  // editor's "Connect X" gating (WorkflowEditorScreen).
  const connectedProviders = useMemo(
    () =>
      new Set(
        cloudIntegrations
          .filter((integration) => integration.accountId !== null && integration.health === "ready")
          .map((integration) => integration.namespace),
      ),
    [cloudIntegrations],
  );

  const byId = useMemo(() => {
    const map = new Map<string, WorkflowResponse>();
    for (const workflow of workflows) {
      map.set(workflow.id, workflow);
    }
    return map;
  }, [workflows]);

  const ordered = useMemo<RecommendedWorkflowView[]>(
    () =>
      orderRecommendedWorkflows(
        workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
        })),
        runs.map((run) => ({ workflowId: run.workflowId, createdAt: run.startedAt ?? run.createdAt })),
        { limit },
      ),
    [workflows, runs, limit],
  );

  if (stripHidden || workflows.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Recommended workflows</span>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {ordered.map((view) => {
          const workflow = byId.get(view.id);
          if (!workflow) {
            return null;
          }
          return (
            <WorkflowRecommendedCard
              key={view.id}
              workflow={workflow}
              connectedProviders={connectedProviders}
              onRun={launcher.open}
            />
          );
        })}
      </div>
      {launcher.modal}
    </div>
  );
}

/** One strip card. Fetches the workflow's definition (cached) for the glyph
 * strip + provider icons, and opens the launch modal on Run. */
function WorkflowRecommendedCard({
  workflow,
  connectedProviders,
  onRun,
}: {
  workflow: WorkflowResponse;
  connectedProviders: ReadonlySet<string>;
  onRun: (workflow: WorkflowResponse, definition: WorkflowDefinition) => void;
}) {
  const detail = useWorkflowDetail(workflow.id);
  const definition = useMemo<WorkflowDefinition | null>(() => {
    const raw = detail.data?.currentVersion?.definition;
    return raw ? parseWorkflowDefinition(raw) : null;
  }, [detail.data]);

  const providers = useMemo(() => {
    if (!definition) {
      return [];
    }
    return Array.from(new Set(spineAgentNodes(definition).map((agent) => agent.harness)));
  }, [definition]);

  const glyphs = useMemo(() => (definition ? workflowStepStrip(definition) : []), [definition]);

  const readinessLabel = useMemo(() => {
    if (!definition) {
      return null;
    }
    const readiness = annotateIntegrationReadiness(definition.integrations, connectedProviders);
    return readinessChipLabel(readiness);
  }, [definition, connectedProviders]);

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background p-3.5 transition-colors hover:border-border-heavy">
      <div className="flex items-center gap-1.5">
        {providers.map((provider) => (
          <ProviderIcon key={provider} kind={provider} className="size-3.5 text-muted-foreground" />
        ))}
        {readinessLabel ? (
          <Badge tone="warning" className="ml-auto gap-1 text-[11px]">
            {readinessLabel}
          </Badge>
        ) : null}
      </div>
      <h4 className="mt-2 truncate text-ui-sm font-medium text-foreground">{workflow.name}</h4>
      {workflow.description ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {workflow.description}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <WorkflowStepGlyphStrip glyphs={glyphs} />
        <Button
          size="sm"
          variant="secondary"
          className="gap-1"
          disabled={definition === null}
          onClick={() => {
            if (definition) {
              onRun(workflow, definition);
            }
          }}
        >
          <Play className="size-3" />
          Run
        </Button>
      </div>
    </div>
  );
}
