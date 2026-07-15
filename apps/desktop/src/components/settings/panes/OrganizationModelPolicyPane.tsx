import { useEffect, useMemo, useState } from "react";
import {
  useOrgAgentPolicy,
  useOrgAgentPolicyViolations,
  useUpdateOrgAgentPolicy,
} from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";

const ROUTE_OPTIONS: readonly { value: string; label: string; description: string }[] = [
  { value: "native", label: "Native", description: "Sign in through the harness directly" },
  { value: "api_key", label: "API key", description: "Members supply their own provider key" },
  { value: "gateway", label: "Gateway", description: "Route through the organization gateway" },
];

const HARNESS_OPTIONS: readonly { value: string; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic CLI agent" },
  { value: "codex", label: "Codex", description: "OpenAI CLI agent" },
  { value: "opencode", label: "OpenCode", description: "Open-source CLI agent" },
  { value: "gemini", label: "Gemini CLI", description: "Google CLI agent" },
  { value: "grok", label: "Grok CLI", description: "xAI CLI agent" },
];

function checkedSet(
  allowed: string[] | null | undefined,
  options: readonly { value: string }[],
): Set<string> {
  if (allowed == null) {
    return new Set(options.map((option) => option.value));
  }
  return new Set(allowed);
}

function toAllowedList(
  checked: Set<string>,
  options: readonly { value: string }[],
): string[] | null {
  if (options.every((option) => checked.has(option.value))) {
    return null;
  }
  return options
    .filter((option) => checked.has(option.value))
    .map((option) => option.value);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function OrganizationModelPolicyPane() {
  const { activeOrganizationId } = useActiveOrganization();
  const policy = useOrgAgentPolicy(activeOrganizationId);
  const violations = useOrgAgentPolicyViolations(activeOrganizationId);
  const updatePolicy = useUpdateOrgAgentPolicy(activeOrganizationId);

  const [checkedRoutes, setCheckedRoutes] = useState<Set<string>>(new Set());
  const [checkedHarnesses, setCheckedHarnesses] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!policy.data) {
      return;
    }
    setCheckedRoutes(checkedSet(policy.data.allowedRoutes, ROUTE_OPTIONS));
    setCheckedHarnesses(checkedSet(policy.data.allowedHarnesses, HARNESS_OPTIONS));
  }, [policy.data]);

  const editable = policy.data?.editable === true;

  const dirty = useMemo(() => {
    if (!policy.data) {
      return false;
    }
    const savedRoutes = checkedSet(policy.data.allowedRoutes, ROUTE_OPTIONS);
    const savedHarnesses = checkedSet(policy.data.allowedHarnesses, HARNESS_OPTIONS);
    return (
      !setsEqual(checkedRoutes, savedRoutes)
      || !setsEqual(checkedHarnesses, savedHarnesses)
    );
  }, [policy.data, checkedRoutes, checkedHarnesses]);

  function toggle(
    set: Set<string>,
    update: (next: Set<string>) => void,
    value: string,
  ) {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    update(next);
  }

  async function handleSave() {
    await updatePolicy.mutateAsync({
      allowedRoutes: toAllowedList(checkedRoutes, ROUTE_OPTIONS),
      allowedHarnesses: toAllowedList(checkedHarnesses, HARNESS_OPTIONS),
    });
    await violations.refetch();
  }

  const violationRows = violations.data?.violations ?? [];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Model policy"
        description="Which agents and auth routes organization members can use."
      />

      <p className="text-sm text-muted-foreground">
        Restricting members to specific models (per-model allowlists) is coming soon.
      </p>

      {policy.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading policy…</div>
      ) : policy.isError ? (
        <div className="text-sm text-muted-foreground">Policy could not be loaded.</div>
      ) : (
        <>
          {!editable ? (
            <div className="text-sm text-muted-foreground">
              Editing the agent policy requires a paid plan.
            </div>
          ) : null}

          {/* Harnesses */}
          <SettingsSection title="Harnesses">
            <div className="overflow-clip rounded-lg bg-foreground/5">
              {HARNESS_OPTIONS.map((option) => (
                <PolicySwitchRow
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  checked={checkedHarnesses.has(option.value)}
                  disabled={!editable || updatePolicy.isPending}
                  onChange={() => toggle(checkedHarnesses, setCheckedHarnesses, option.value)}
                />
              ))}
            </div>
          </SettingsSection>

          {/* Auth routes */}
          <SettingsSection title="Auth routes">
            <div className="overflow-clip rounded-lg bg-foreground/5">
              {ROUTE_OPTIONS.map((option) => (
                <PolicySwitchRow
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  checked={checkedRoutes.has(option.value)}
                  disabled={!editable || updatePolicy.isPending}
                  onChange={() => toggle(checkedRoutes, setCheckedRoutes, option.value)}
                />
              ))}
            </div>
          </SettingsSection>

          {/* Save */}
          {updatePolicy.isError ? (
            <div className="text-sm text-destructive">
              {updatePolicy.error instanceof Error
                ? updatePolicy.error.message
                : "Policy could not be saved."}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              loading={updatePolicy.isPending}
              disabled={!editable || !dirty || updatePolicy.isPending}
              onClick={() => {
                void handleSave();
              }}
            >
              Save policy
            </Button>
          </div>

          {/* Conflicts */}
          <SettingsSection title="Conflicts" description="Existing member selections outside this policy. New selections are blocked; these stay flagged until each member updates them.">
            <div className="overflow-clip rounded-lg bg-foreground/5">
              {violations.isLoading ? (
                <div className="px-3.5 py-3.5 text-sm text-muted-foreground">Checking…</div>
              ) : violations.isError ? (
                <div className="px-3.5 py-3.5 text-sm text-muted-foreground">
                  Conflicts could not be loaded.
                </div>
              ) : violationRows.length === 0 ? (
                <div className="px-3.5 py-3.5 text-sm text-muted-foreground">
                  No conflicts with current policy.
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-light">
                      <SettingsEyebrow as="th" className="px-3.5 pb-2 pt-3 text-left">Member</SettingsEyebrow>
                      <SettingsEyebrow as="th" className="px-3.5 pb-2 pt-3 text-left">Harness</SettingsEyebrow>
                      <SettingsEyebrow as="th" className="px-3.5 pb-2 pt-3 text-left">Surface</SettingsEyebrow>
                      <SettingsEyebrow as="th" className="px-3.5 pb-2 pt-3 text-left">Route</SettingsEyebrow>
                    </tr>
                  </thead>
                  <tbody>
                    {violationRows.map((violation) => (
                      <tr
                        key={`${violation.userId}-${violation.harnessKind}-${violation.surface}`}
                        className="border-b border-border-light last:border-b-0"
                      >
                        <td className="px-3.5 py-2.5 text-sm text-foreground">
                          {violation.displayName ?? violation.email ?? violation.userId}
                        </td>
                        <td className="px-3.5 py-2.5 text-sm text-muted-foreground">
                          {HARNESS_OPTIONS.find((o) => o.value === violation.harnessKind)?.label ?? violation.harnessKind}
                        </td>
                        <td className="px-3.5 py-2.5 text-sm capitalize text-muted-foreground">
                          {violation.surface}
                        </td>
                        <td className="px-3.5 py-2.5 text-sm text-muted-foreground">
                          {ROUTE_OPTIONS.find((o) => o.value === violation.sourceKind)?.label ?? violation.sourceKind}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </SettingsSection>
        </>
      )}
    </section>
  );
}

function PolicySwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        <div className="text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">
        <Switch checked={checked} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  );
}
