import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { CircleAlert, Check } from "@proliferate/ui/icons";

/** One selectable gateway provider (spec 6.1 / L21): a namespace visible to the
 * owner, restricted client-side to the launch set (issues, slack). */
export interface WorkflowFunctionProviderOption {
  namespace: string;
  displayName: string;
  /** Whether the owner has a ready account for this provider today. StartRun
   * (not save) is the real gate (L22) — this is just an editor-time hint. */
  connected: boolean;
}

export interface WorkflowFunctionsCardProps {
  /** E3: namespace-level grant — the integration namespaces this workflow's
   * agents may use. No per-tool selection; the gateway treats a granted
   * namespace as "all tools of that provider" at call time. */
  integrations: readonly string[];
  providers: readonly WorkflowFunctionProviderOption[];
  onChange: (integrations: string[]) => void;
}

/**
 * The Integrations section (spec 1.5 / 6.3, PR E, E3 namespace-only): declares
 * the integration namespaces this workflow's agents may use. Provider choices
 * are restricted client-side to the L21 launch set intersected with the owner's
 * visible integrations (`providers` prop) — everything else is "more arrive
 * later". Cloud-only (§5.3): the persistent caption below is LOUD by ruling, not
 * just a tooltip. There is no per-tool selection under E3 — granting a namespace
 * grants every tool of that provider.
 */
export function WorkflowFunctionsCard({ integrations, providers, onChange }: WorkflowFunctionsCardProps) {
  const granted = new Set(integrations);

  const toggle = (namespace: string) => {
    if (granted.has(namespace)) {
      onChange(integrations.filter((ns) => ns !== namespace));
    } else {
      onChange([...integrations, namespace]);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Integrations</span>
        {integrations.length > 0 ? (
          <span className="text-xs text-faint">
            {integrations.length} {integrations.length === 1 ? "integration" : "integrations"}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-faint">
        Grant this workflow&apos;s agents access to a connected integration. Granting an
        integration exposes all of its tools. Available now: Issues, Slack — more integrations
        arrive later.
      </p>

      {integrations.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Integrations require cloud runs — local runs will fail with an explicit error.
        </p>
      ) : null}

      {providers.length === 0 ? (
        <p className="text-xs text-faint">
          No Issues or Slack integration is visible yet — connect one in Settings → Integrations
          to grant it here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {providers.map((provider) => {
            const on = granted.has(provider.namespace);
            return (
              <Button
                key={provider.namespace}
                type="button"
                variant="unstyled"
                size="unstyled"
                onClick={() => toggle(provider.namespace)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  on
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {on ? <Check className="size-3.5" aria-hidden /> : null}
                <span>{provider.displayName}</span>
                {!provider.connected ? (
                  <Badge tone="neutral" className="py-0 text-[10px]">
                    not connected
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface WorkflowAgentIntegrationsRowProps {
  /** The workflow-level granted namespaces (this row's option universe). */
  workflowIntegrations: readonly string[];
  /** Display names for the workflow's namespaces, keyed by namespace. */
  displayNames: ReadonlyMap<string, string>;
  /** `undefined` = this slot keeps the full workflow-level list (default). */
  value: readonly string[] | undefined;
  onChange: (next: string[] | undefined) => void;
}

/**
 * Per-agent integration narrowing (track 3c phase 2, data-contract §3: the
 * resolved plan is already per-slot, so this is a resolver-only change with
 * a quiet editor surface). Same toggle-chip atom as the workflow-level card
 * above, scoped to the workflow's own granted namespaces — narrowing can only
 * ever be a subset. Rendered in the agent panel, only when the workflow
 * declares at least one integration.
 */
export function WorkflowAgentIntegrationsRow({
  workflowIntegrations,
  displayNames,
  value,
  onChange,
}: WorkflowAgentIntegrationsRowProps) {
  const narrowed = value !== undefined;
  const selected = new Set(value ?? workflowIntegrations);

  const toggle = (namespace: string) => {
    const base = value ?? workflowIntegrations;
    const next = base.includes(namespace)
      ? base.filter((ns) => ns !== namespace)
      : [...base, namespace];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">Integrations</span>
        {narrowed ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            All workflow integrations
          </Button>
        ) : (
          <span className="text-xs text-faint">All workflow integrations</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {workflowIntegrations.map((namespace) => {
          const on = selected.has(namespace);
          return (
            <Button
              key={namespace}
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => toggle(namespace)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {on ? <Check className="size-3.5" aria-hidden /> : null}
              <span>{displayNames.get(namespace) ?? namespace}</span>
            </Button>
          );
        })}
      </div>
      {narrowed ? (
        <p className="text-xs text-faint">
          Selects which of the workflow&apos;s integrations this agent is granted. All agents in a
          run share the run&apos;s gateway grant today.
        </p>
      ) : null}
    </div>
  );
}
