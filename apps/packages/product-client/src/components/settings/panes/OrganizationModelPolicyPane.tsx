import { useEffect, useMemo, useState } from "react";
import {
  useOrgAgentPolicy,
  useOrgAgentPolicyViolations,
  useUpdateOrgAgentPolicy,
} from "@proliferate/cloud-sdk-react";
import { Button } from "#product/primitives/Button";
import { Switch } from "#product/primitives/Switch";
import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { SettingsRow } from "#product/components/patterns/SettingsRow";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";

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

      <p className="text-body text-muted-foreground">
        Restricting members to specific models (per-model allowlists) is coming soon.
      </p>

      {policy.isLoading ? (
        <div className="text-ui-sm text-muted-foreground">Loading policy…</div>
      ) : policy.isError ? (
        <div className="text-ui-sm text-muted-foreground">Policy could not be loaded.</div>
      ) : (
        <>
          {!editable ? (
            <div className="text-ui-sm text-muted-foreground">
              Editing the agent policy requires a paid plan.
            </div>
          ) : null}

          {/* Harnesses */}
          <SettingsSection title="Harnesses">
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
          </SettingsSection>

          {/* Auth routes */}
          <SettingsSection title="Auth routes">
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
          </SettingsSection>

          {/* Save */}
          {updatePolicy.isError ? (
            <div className="text-ui text-destructive">
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
            {violations.isLoading ? (
              <div className="px-3.5 py-3.5 text-ui-sm text-muted-foreground">Checking…</div>
            ) : violations.isError ? (
              <div className="px-3.5 py-3.5 text-ui-sm text-muted-foreground">
                Conflicts could not be loaded.
              </div>
            ) : violationRows.length === 0 ? (
              <div className="px-3.5 py-3.5 text-ui-sm text-muted-foreground">
                No conflicts with current policy.
              </div>
            ) : (
              <table className="w-full divide-y divide-border-light text-left">
                <thead>
                  <tr>
                    <th className="px-3.5 pb-2 pt-3 text-left text-ui-sm font-normal text-muted-foreground">Member</th>
                    <th className="px-3.5 pb-2 pt-3 text-left text-ui-sm font-normal text-muted-foreground">Harness</th>
                    <th className="px-3.5 pb-2 pt-3 text-left text-ui-sm font-normal text-muted-foreground">Surface</th>
                    <th className="px-3.5 pb-2 pt-3 text-left text-ui-sm font-normal text-muted-foreground">Route</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {violationRows.map((violation) => (
                    <tr
                      key={`${violation.userId}-${violation.harnessKind}-${violation.surface}`}
                    >
                      <td className="px-3.5 py-2.5 text-ui text-foreground">
                        {violation.displayName ?? violation.email ?? violation.userId}
                      </td>
                      <td className="px-3.5 py-2.5 text-ui text-muted-foreground">
                        {HARNESS_OPTIONS.find((o) => o.value === violation.harnessKind)?.label ?? violation.harnessKind}
                      </td>
                      <td className="px-3.5 py-2.5 text-ui capitalize text-muted-foreground">
                        {violation.surface}
                      </td>
                      <td className="px-3.5 py-2.5 text-ui text-muted-foreground">
                        {ROUTE_OPTIONS.find((o) => o.value === violation.sourceKind)?.label ?? violation.sourceKind}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
    <SettingsRow label={label} description={description}>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </SettingsRow>
  );
}
