import type { WorkflowRequiredInvocation } from "@proliferate/product-domain/workflows/definition";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { FieldLabel, InlineRow } from "./WorkflowStepFields";
import { WorkflowSelect } from "./WorkflowSelect";

/** The reserved virtual provider for owner HTTP function invocations (mirrors
 * `WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES` / gateway_grants.py). */
const FUNCTIONS_NAMESPACE = "functions";

export interface RequiredInvocationFunction {
  /** The gateway tool name (function-invocation `name`). */
  name: string;
  displayName: string | null;
}

export interface WorkflowRequiredInvocationFieldProps {
  /** The step's current gate, or `undefined` when no invocation is required. */
  value: WorkflowRequiredInvocation | undefined;
  /** The workflow-declared integration namespaces (the provider-tool universe). */
  integrations: readonly string[];
  /** The owner's function invocations (the `functions` provider's tool universe). */
  functionInvocations: readonly RequiredInvocationFunction[];
  onChange: (next: WorkflowRequiredInvocation | undefined) => void;
}

/**
 * Author a required agent invocation (feature spec §7.1/§7.3, WS9b item 2): the
 * step names exactly one capability the agent MUST invoke during its turn —
 * either a provider tool (`{provider, tool}` from a declared integration) or an
 * exact function invocation (`{provider:"functions", tool:<name>}`). Stores the
 * exact `{provider, tool}` wire shape the server compiler reads today
 * (definition parser `required_invocation`).
 */
export function WorkflowRequiredInvocationField({
  value,
  integrations,
  functionInvocations,
  onChange,
}: WorkflowRequiredInvocationFieldProps) {
  const enabled = value !== undefined;
  const isFunction = value?.provider === FUNCTIONS_NAMESPACE;
  const hasFunctions = integrations.includes(FUNCTIONS_NAMESPACE) && functionInvocations.length > 0;
  // Provider-tool namespaces are the declared integrations minus `functions`
  // (functions has its own, exact picker below).
  const providerNamespaces = integrations.filter((namespace) => namespace !== FUNCTIONS_NAMESPACE);

  const enable = () => {
    // Default to a function invocation when available (the launch path), else a
    // provider tool on the first declared namespace.
    if (hasFunctions) {
      onChange({ provider: FUNCTIONS_NAMESPACE, tool: functionInvocations[0]!.name });
    } else {
      onChange({ provider: providerNamespaces[0] ?? "", tool: "" });
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
      <InlineRow label="Require a tool call">
        <Switch
          aria-label="Require a tool call"
          checked={enabled}
          onChange={(on) => (on ? enable() : onChange(undefined))}
        />
      </InlineRow>
      {enabled ? (
        integrations.length === 0 ? (
          <p className="text-xs text-faint">
            Grant an integration or add a function invocation in Setup first — a required call names
            one of those capabilities.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {hasFunctions ? (
              <InlineRow label="Kind">
                <WorkflowSelect
                  ariaLabel="Required invocation kind"
                  value={isFunction ? "function" : "provider"}
                  className="w-44"
                  options={[
                    { value: "function", label: "Function invocation" },
                    { value: "provider", label: "Provider tool" },
                  ]}
                  onChange={(kind) =>
                    kind === "function"
                      ? onChange({ provider: FUNCTIONS_NAMESPACE, tool: functionInvocations[0]!.name })
                      : onChange({ provider: providerNamespaces[0] ?? "", tool: "" })
                  }
                />
              </InlineRow>
            ) : null}
            {isFunction ? (
              <InlineRow label="Function">
                <WorkflowSelect
                  ariaLabel="Required function invocation"
                  value={value!.tool}
                  placeholder="Choose a function"
                  className="w-56"
                  options={functionInvocations.map((fn) => ({
                    value: fn.name,
                    label: fn.displayName?.trim() || fn.name,
                  }))}
                  onChange={(tool) => onChange({ provider: FUNCTIONS_NAMESPACE, tool })}
                />
              </InlineRow>
            ) : (
              <>
                <InlineRow label="Provider">
                  <WorkflowSelect
                    ariaLabel="Required invocation provider"
                    value={value!.provider}
                    placeholder="Choose a provider"
                    className="w-44"
                    options={providerNamespaces.map((namespace) => ({
                      value: namespace,
                      label: namespace,
                    }))}
                    onChange={(provider) => onChange({ provider, tool: value!.tool })}
                  />
                </InlineRow>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Tool name</FieldLabel>
                  <Input
                    className="font-mono"
                    value={value!.tool}
                    placeholder="exact_tool_name"
                    onChange={(event) =>
                      onChange({ provider: value!.provider, tool: event.target.value })
                    }
                  />
                </div>
              </>
            )}
            <p className="text-xs text-faint">
              The step only completes once a gateway receipt proves this exact call for the current
              attempt.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
