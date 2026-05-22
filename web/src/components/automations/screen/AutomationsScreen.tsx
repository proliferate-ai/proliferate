import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Cloud, Play, RefreshCw, Users } from "lucide-react";
import {
  runAutomationNow,
  type AutomationResponse,
  type AutomationRunResponse,
} from "@proliferate/cloud-sdk";
import {
  useAutomationRuns,
  useAutomations,
  useCloudClient,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";

type AutomationView = AutomationResponse & {
  scopeLabel: string;
};

export function AutomationsScreen() {
  const client = useCloudClient();
  const organizations = useOrganizations();
  const primaryOrganization = useMemo(
    () => (organizations.data?.organizations ?? []).find((organization) => {
      const role = organization.membership?.role;
      return organization.membership?.status === "active" && (role === "owner" || role === "admin");
    }) ?? null,
    [organizations.data?.organizations],
  );

  const personalAutomations = useAutomations({ ownerScope: "personal" });
  const teamAutomations = useAutomations({
    ownerScope: "organization",
    organizationId: primaryOrganization?.id ?? null,
    enabled: Boolean(primaryOrganization),
  });

  const automations = useMemo<AutomationView[]>(() => [
    ...(personalAutomations.data?.automations ?? []).map((automation) => ({
      ...automation,
      scopeLabel: "Personal",
    })),
    ...(teamAutomations.data?.automations ?? []).map((automation) => ({
      ...automation,
      scopeLabel: primaryOrganization?.name ?? "Team",
    })),
  ], [
    personalAutomations.data?.automations,
    primaryOrganization?.name,
    teamAutomations.data?.automations,
  ]);

  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId)
      ?? automations[0]
      ?? null,
    [automations, selectedAutomationId],
  );
  const runs = useAutomationRuns(selectedAutomation?.id ?? null, Boolean(selectedAutomation));
  const runNow = useMutation({
    mutationFn: async (automationId: string) => runAutomationNow(automationId, client),
    onSuccess: async () => {
      const refetches = [
        runs.refetch(),
        personalAutomations.refetch(),
      ];
      if (primaryOrganization) {
        refetches.push(teamAutomations.refetch());
      }
      await Promise.all(refetches);
    },
  });

  useEffect(() => {
    if (!selectedAutomationId && automations[0]) {
      setSelectedAutomationId(automations[0].id);
      return;
    }
    if (
      selectedAutomationId
      && automations.length > 0
      && !automations.some((automation) => automation.id === selectedAutomationId)
    ) {
      setSelectedAutomationId(automations[0].id);
    }
  }, [automations, selectedAutomationId]);

  const loading = personalAutomations.isLoading
    || organizations.isLoading
    || (Boolean(primaryOrganization) && teamAutomations.isLoading);
  const error = personalAutomations.error
    || organizations.error
    || (primaryOrganization ? teamAutomations.error : null);

  return (
    <ProductPageShell
      title="Automations"
      description="Personal and team cloud automations, with their latest run state."
      actions={(
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            void personalAutomations.refetch();
            if (primaryOrganization) {
              void teamAutomations.refetch();
            }
            void runs.refetch();
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </Button>
      )}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {loading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading automations
        </div>
      ) : error ? (
        <EmptyState
          title="Could not load automations"
          description="Refresh the page or sign in again."
        />
      ) : automations.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3">
            {automations.map((automation) => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                selected={selectedAutomation?.id === automation.id}
                latestRun={(selectedAutomation?.id === automation.id
                  ? runs.data?.runs?.[0]
                  : undefined)}
                onClick={() => setSelectedAutomationId(automation.id)}
              />
            ))}
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            {selectedAutomation ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{selectedAutomation.scopeLabel}</span>
                      <span className="text-muted-foreground/40">-</span>
                      <span>{targetLabel(selectedAutomation.targetMode)}</span>
                    </div>
                    <h2 className="mt-1 truncate text-sm font-semibold">
                      {selectedAutomation.title}
                    </h2>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedAutomation.gitOwner}/{selectedAutomation.gitRepoName}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={runNow.isPending}
                    onClick={() => void runNow.mutate(selectedAutomation.id)}
                  >
                    <Play size={13} />
                    Run now
                  </Button>
                </div>

                {runNow.error ? (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {runNow.error instanceof Error
                      ? runNow.error.message
                      : "Could not start automation."}
                  </div>
                ) : null}

                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">
                    Recent runs
                  </h3>
                  {runs.isLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">Loading runs</p>
                  ) : runs.error ? (
                    <p className="mt-3 text-sm text-muted-foreground">Runs could not be loaded.</p>
                  ) : runs.data?.runs?.length ? (
                    <div className="mt-3 grid gap-2">
                      {runs.data.runs.slice(0, 8).map((run) => (
                        <RunRow key={run.id} run={run} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No runs yet.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select an automation.</p>
            )}
          </section>
        </div>
      ) : (
        <EmptyState
          title="No automations yet"
          description="Create an automation from Desktop or the cloud setup flow."
        />
      )}
    </ProductPageShell>
  );
}

function AutomationCard({
  automation,
  selected,
  latestRun,
  onClick,
}: {
  automation: AutomationView;
  selected: boolean;
  latestRun?: AutomationRunResponse;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg border bg-card p-4 text-left transition",
        selected ? "border-ring/60" : "border-border hover:border-ring/40 hover:bg-accent/30",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-accent text-foreground">
              {automation.ownerScope === "organization" ? <Users size={15} /> : <Cloud size={15} />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{automation.title}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {automation.gitOwner}/{automation.gitRepoName}
              </p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {automation.enabled ? "On" : "Paused"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
          <CalendarClock size={13} />
          {automation.schedule.summary}
        </span>
        <span className="rounded-md border border-border px-2 py-1">
          {automation.scopeLabel}
        </span>
        <span className="rounded-md border border-border px-2 py-1">
          {targetLabel(automation.targetMode)}
        </span>
        {latestRun ? (
          <span className="rounded-md border border-border px-2 py-1">
            Latest: {latestRun.status}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function RunRow({ run }: { run: AutomationRunResponse }) {
  const workspaceId = run.cloudWorkspaceId;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{run.status}</span>
        <span className="text-[11px] text-muted-foreground">
          {formatDate(run.createdAt)}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {workspaceId ? `Workspace ${workspaceId}` : run.lastErrorMessage ?? run.triggerKind}
      </div>
    </div>
  );
}

function targetLabel(targetMode: string): string {
  if (targetMode === "shared_cloud") return "Team cloud";
  if (targetMode === "personal_cloud") return "Personal cloud";
  return "Local";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not started";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
