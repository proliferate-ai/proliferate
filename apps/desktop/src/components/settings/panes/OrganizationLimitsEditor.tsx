import { useState } from "react";
import type { BudgetLimitInput, OrgUserUsageRow } from "@proliferate/cloud-sdk";
import { useOrgLimits, useUpdateOrgLimits } from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SkeletonBlock, shimmerDelay } from "@/components/feedback/Skeleton";
import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";
import {
  capInputValue,
  capValueFromInput,
  draftRowsToInput,
  limitsToDraftRows,
  memberLabel,
  newDraftRow,
  usageForRow,
  usageSummaryLabel,
  type BudgetLimitDraftRow,
  type BudgetLimitKind,
  type BudgetLimitWindow,
} from "@/lib/domain/settings/organization-limits-presentation";

export function LimitsEditor({
  organizationId,
  members,
  byUserRows,
}: {
  organizationId: string | null;
  members: OrganizationMemberRecord[];
  byUserRows: OrgUserUsageRow[] | undefined;
}) {
  const limitsQuery = useOrgLimits(organizationId);
  const updateLimits = useUpdateOrgLimits(organizationId);
  const [draftRows, setDraftRows] = useState<BudgetLimitDraftRow[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = draftRows ?? limitsToDraftRows(limitsQuery.data?.limits);

  function updateRow(id: string, patch: Partial<BudgetLimitDraftRow>) {
    setSaveError(null);
    setDraftRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow(userId: string | null) {
    setSaveError(null);
    setDraftRows([...rows, newDraftRow(userId)]);
  }

  function removeRow(id: string) {
    setSaveError(null);
    setDraftRows(rows.filter((row) => row.id !== id));
  }

  async function handleSave() {
    setSaveError(null);
    const input: BudgetLimitInput[] = draftRowsToInput(rows);
    try {
      const saved = await updateLimits.mutateAsync(input);
      setDraftRows(limitsToDraftRows(saved.limits));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save limits.");
    }
  }

  return (
    <SettingsSection
      title="Limits"
      description="Cap compute seconds or LLM spend per calendar day or month, in UTC. Organization-wide rows apply to everyone; per-member rows override them."
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={handleSave}
          loading={updateLimits.isPending}
          disabled={limitsQuery.isLoading}
        >
          Save
        </Button>
      }
    >
      {limitsQuery.isLoading ? (
        <div className="space-y-2 py-3">
          {[0, 1].map((row) => (
            <SkeletonBlock key={row} className="h-10 w-full" style={shimmerDelay(row)} />
          ))}
        </div>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className="py-4 text-ui-sm text-muted-foreground">No limits configured yet.</div>
          ) : null}
          {rows.map((row) => (
            <LimitRow
              key={row.id}
              row={row}
              members={members}
              usedValue={usageForRow(row, byUserRows)}
              onChange={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
          {saveError ? <div className="pt-2 text-ui-sm text-destructive">{saveError}</div> : null}
          <div className="flex flex-wrap gap-2 py-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow(null)}>
              Add organization-wide limit
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => addRow(members[0]?.userId ?? null)}
              disabled={members.length === 0}
            >
              Add member limit
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function LimitRow({
  row,
  members,
  usedValue,
  onChange,
  onRemove,
}: {
  row: BudgetLimitDraftRow;
  members: OrganizationMemberRecord[];
  usedValue: number;
  onChange: (patch: Partial<BudgetLimitDraftRow>) => void;
  onRemove: () => void;
}) {
  const capFieldId = `budget-limit-cap-${row.id}`;

  return (
    <SettingsRow label={memberLabel(row.userId, members)} description={usageSummaryLabel(row.kind, usedValue)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Limit target"
          value={row.userId ?? "org"}
          onChange={(event) => onChange({ userId: event.target.value === "org" ? null : event.target.value })}
          className="w-40"
        >
          <option value="org">Organization-wide</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName || member.email}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Limit kind"
          value={row.kind}
          onChange={(event) => onChange({ kind: event.target.value as BudgetLimitKind })}
          className="w-28"
        >
          <option value="compute">Compute</option>
          <option value="llm">LLM</option>
        </Select>
        <Select
          aria-label="Limit window"
          value={row.window}
          onChange={(event) => onChange({ window: event.target.value as BudgetLimitWindow })}
          className="w-24"
        >
          <option value="day">Daily</option>
          <option value="month">Monthly</option>
        </Select>
        <div className="w-28">
          <Label htmlFor={capFieldId} className="sr-only">
            Cap
          </Label>
          <Input
            id={capFieldId}
            type="number"
            min={0}
            step={row.kind === "compute" ? 1 : 0.01}
            value={capInputValue(row.kind, row.capValue)}
            onChange={(event) =>
              onChange({ capValue: capValueFromInput(row.kind, Number(event.target.value)) })}
          />
        </div>
        <span className="w-12 text-ui-sm text-muted-foreground">
          {row.kind === "compute" ? "PCUs" : "USD"}
        </span>
        <Switch checked={row.enabled} onChange={(value) => onChange({ enabled: value })} aria-label="Limit enabled" />
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </SettingsRow>
  );
}
