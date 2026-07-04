import { useEffect, useMemo, useState } from "react";
import {
  useOrgAgentPolicy,
  useOrgAgentPolicyViolations,
  useUpdateOrgAgentPolicy,
} from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Label } from "@proliferate/ui/primitives/Label";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";

const ROUTE_OPTIONS = [
  { value: "native", label: "Native (harness sign-in)" },
  { value: "api_key", label: "API key" },
  { value: "gateway", label: "Gateway" },
] as const;

const HARNESS_OPTIONS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "grok", label: "Grok CLI" },
] as const;

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
  // Everything checked means "no restriction" (stored as null).
  if (options.every((option) => checked.has(option.value))) {
    return null;
  }
  return options
    .filter((option) => checked.has(option.value))
    .map((option) => option.value);
}

export function OrganizationAgentPolicySection({
  organizationId,
}: {
  organizationId: string | null;
}) {
  const policy = useOrgAgentPolicy(organizationId);
  const violations = useOrgAgentPolicyViolations(organizationId);
  const updatePolicy = useUpdateOrgAgentPolicy(organizationId);

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
    <SettingsSection
      title="Agent policy"
      description="Allowed auth routes and harnesses for members. Conflicts are flagged only — nothing is blocked."
    >
      <div className="space-y-5 py-1">
        {policy.isLoading ? (
          <div className="text-ui-sm text-muted-foreground">Loading agent policy…</div>
        ) : policy.isError ? (
          <div className="text-ui-sm text-muted-foreground">
            Agent policy could not be loaded.
          </div>
        ) : (
          <>
            {!editable ? (
              <div className="text-ui-sm text-muted-foreground">
                Editing the agent policy requires a paid plan.
              </div>
            ) : null}
            <div className="grid gap-6 sm:grid-cols-2">
              <PolicyChecklist
                legend="Allowed routes"
                options={ROUTE_OPTIONS}
                checked={checkedRoutes}
                disabled={!editable || updatePolicy.isPending}
                onToggle={(value) => toggle(checkedRoutes, setCheckedRoutes, value)}
              />
              <PolicyChecklist
                legend="Allowed harnesses"
                options={HARNESS_OPTIONS}
                checked={checkedHarnesses}
                disabled={!editable || updatePolicy.isPending}
                onToggle={(value) => toggle(checkedHarnesses, setCheckedHarnesses, value)}
              />
            </div>
            {updatePolicy.isError ? (
              <div className="text-ui-sm text-destructive">
                {updatePolicy.error instanceof Error
                  ? updatePolicy.error.message
                  : "Agent policy could not be saved."}
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
          </>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <SettingsEyebrow>Conflicts</SettingsEyebrow>
        <p className="mt-1 text-ui-sm leading-[1.45] text-muted-foreground">
          Member selections that fall outside this policy. Flagged only — nothing is blocked.
        </p>
        <div className="mt-3">
          {violations.isLoading ? (
            <div className="text-ui-sm text-muted-foreground">Checking member selections…</div>
          ) : violations.isError ? (
            <div className="text-ui-sm text-muted-foreground">
              Conflicts could not be loaded.
            </div>
          ) : violationRows.length === 0 ? (
            <div className="text-ui-sm text-muted-foreground">
              No member selections conflict with this policy.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <SettingsEyebrow as="th" className="pb-2 pr-4 text-left">Member</SettingsEyebrow>
                  <SettingsEyebrow as="th" className="pb-2 pr-4 text-left">Harness</SettingsEyebrow>
                  <SettingsEyebrow as="th" className="pb-2 pr-4 text-left">Surface</SettingsEyebrow>
                  <SettingsEyebrow as="th" className="pb-2 text-left">Route</SettingsEyebrow>
                </tr>
              </thead>
              <tbody>
                {violationRows.map((violation) => (
                  <tr
                    key={`${violation.userId}-${violation.harnessKind}-${violation.surface}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="py-2.5 pr-4 text-ui text-foreground">
                      {violation.displayName ?? violation.email ?? violation.userId}
                    </td>
                    <td className="py-2.5 pr-4 text-ui-sm text-muted-foreground">
                      {harnessLabel(violation.harnessKind)}
                    </td>
                    <td className="py-2.5 pr-4 text-ui-sm capitalize text-muted-foreground">
                      {violation.surface}
                    </td>
                    <td className="py-2.5 text-ui-sm text-muted-foreground">
                      {routeLabel(violation.sourceKind)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function PolicyChecklist({
  legend,
  options,
  checked,
  disabled,
  onToggle,
}: {
  legend: string;
  options: readonly { value: string; label: string }[];
  checked: Set<string>;
  disabled: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2.5">
      <SettingsEyebrow as="legend">{legend}</SettingsEyebrow>
      {options.map((option) => (
        <Label
          key={option.value}
          className="flex items-center gap-2 text-ui text-foreground"
        >
          <Checkbox
            checked={checked.has(option.value)}
            disabled={disabled}
            onCheckedChange={() => onToggle(option.value)}
          />
          {option.label}
        </Label>
      ))}
    </fieldset>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function harnessLabel(value: string): string {
  return HARNESS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function routeLabel(value: string): string {
  return ROUTE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
