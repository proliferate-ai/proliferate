import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { BudgetLimitInput, OrgUserUsageRow } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useLlmBalance,
  useOrgLimits,
  useOrgUsageByUser,
  useOrgUserUsageTimeseries,
  useUpdateOrgLimits,
  useUsageTimeseries,
} from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Select } from "@proliferate/ui/primitives/Select";
import {
  SegmentedControl,
} from "@proliferate/ui/primitives/SegmentedControl";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SkeletonBlock, shimmerDelay } from "@/components/feedback/Skeleton";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";
import {
  USAGE_GRANULARITY_OPTIONS,
  USAGE_KIND_ITEMS,
  USAGE_RANGE_OPTIONS,
  buildOrgUsageRows,
  capInputValue,
  capValueFromInput,
  chartMax,
  computeGrantBalance,
  draftRowsToInput,
  formatUsd,
  limitsToDraftRows,
  llmGrantBalance,
  memberLabel,
  newDraftRow,
  secondsToPcus,
  toChartPoints,
  usageForRow,
  usageSummaryLabel,
  type BudgetBalanceView,
  type BudgetLimitDraftRow,
  type BudgetLimitKind,
  type BudgetLimitWindow,
  type OrgUsageRowView,
  type UsageChartKind,
  type UsageChartPoint,
  type UsageGranularity,
  type UsageRangeDays,
} from "@/lib/domain/settings/organization-limits-presentation";

const EMPTY_MEMBERS: OrganizationMemberRecord[] = [];

export function OrganizationBudgetsPane() {
  const { activeOrganization, activeOrganizationId, organizationsQuery } = useActiveOrganization();
  const membersQuery = useOrganizationMembers(activeOrganizationId);
  const members = membersQuery.data?.members ?? EMPTY_MEMBERS;

  const [range, setRange] = useState<UsageRangeDays>(30);
  const [granularity, setGranularity] = useState<UsageGranularity>("day");
  const [kind, setKind] = useState<UsageChartKind>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const hasOrganization = Boolean(activeOrganizationId);
  const orgOwner = activeOrganizationId
    ? { ownerScope: "organization" as const, organizationId: activeOrganizationId }
    : undefined;

  const billingQuery = useCloudBilling(orgOwner, hasOrganization);
  const llmBalanceQuery = useLlmBalance(orgOwner, hasOrganization);
  const timeseriesQuery = useUsageTimeseries({ granularity, days: range, kind }, orgOwner, hasOrganization);
  const byUserQuery = useOrgUsageByUser(activeOrganizationId, range);
  const userTimeseriesQuery = useOrgUserUsageTimeseries(activeOrganizationId, selectedUserId, {
    granularity,
    days: range,
    kind,
  });

  const computeBalance = computeGrantBalance(billingQuery.data);
  const llmBalance = llmGrantBalance(llmBalanceQuery.data);
  const chartPoints = useMemo(
    () => toChartPoints(timeseriesQuery.data?.buckets, granularity),
    [timeseriesQuery.data, granularity],
  );
  const userChartPoints = useMemo(
    () => toChartPoints(userTimeseriesQuery.data?.buckets, granularity),
    [userTimeseriesQuery.data, granularity],
  );
  const usageRows = useMemo(
    () => buildOrgUsageRows(byUserQuery.data?.users),
    [byUserQuery.data],
  );
  const selectedRow = usageRows.find((row) => row.userId === selectedUserId) ?? null;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Usage & limits"
        description="Track compute seconds and LLM spend, and set caps for the organization or individual members."
      />

      {!activeOrganization && organizationsQuery.isLoading ? (
        <div className="text-ui-sm text-muted-foreground">Loading organization…</div>
      ) : null}

      <SettingsSection
        title="Balances"
        description="Compute units and LLM credits have separate balances — never combined into one figure."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <BudgetBalanceCard {...computeBalance} loading={billingQuery.isLoading} />
          <BudgetBalanceCard {...llmBalance} loading={llmBalanceQuery.isLoading} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Consumption"
        description="Compute seconds and LLM spend never share an axis, so the chart juxtaposes them instead of summing."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <Select
                aria-label="Usage range"
                value={String(range)}
                onChange={(event) => setRange(Number(event.target.value) as UsageRangeDays)}
              >
                {USAGE_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <div className="w-32">
              <Select
                aria-label="Usage granularity"
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as UsageGranularity)}
              >
                {USAGE_GRANULARITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <SegmentedControl
              items={USAGE_KIND_ITEMS}
              value={kind}
              onChange={setKind}
              ariaLabel="Usage kind"
            />
          </div>
        }
      >
        <UsageBarChart points={chartPoints} kind={kind} loading={timeseriesQuery.isLoading} />
      </SettingsSection>

      {selectedUserId && selectedRow ? (
        <UserDrillDown
          row={selectedRow}
          points={userChartPoints}
          loading={userTimeseriesQuery.isLoading}
          kind={kind}
          onBack={() => setSelectedUserId(null)}
        />
      ) : (
        <OrgUsageTable
          rows={usageRows}
          loading={byUserQuery.isLoading}
          onSelectUser={setSelectedUserId}
        />
      )}

      <LimitsEditor
        organizationId={activeOrganizationId}
        members={members}
        byUserRows={byUserQuery.data?.users}
      />
    </section>
  );
}

function BudgetBalanceCard({
  label,
  available,
  total,
  used,
  percentAvailable,
  loading,
}: BudgetBalanceView & { loading?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3 rounded-lg border border-border-light bg-foreground/[0.02] p-4">
        <SkeletonBlock className="h-4 w-24" style={shimmerDelay(0)} />
        <SkeletonBlock className="h-6 w-32" style={shimmerDelay(1)} />
        <SkeletonBlock className="h-4 w-full" style={shimmerDelay(2)} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-light bg-foreground/[0.02] p-4">
      <div className="space-y-1">
        <div className="text-ui font-medium text-foreground">{label}</div>
        <div className="text-title font-semibold tracking-tight text-foreground">{available}</div>
        <div className="text-ui-sm text-muted-foreground">available of {total}</div>
      </div>
      <ProgressBar
        value={percentAvailable}
        className="h-4 overflow-hidden rounded-full border border-border-light bg-foreground/5 p-0.5"
        indicatorClassName="h-full rounded-full bg-primary/70"
        aria-label={`${label} available`}
      />
      <div className="flex items-center justify-between text-ui-sm text-muted-foreground">
        <span>{used}</span>
        <span>{percentAvailable}% remaining</span>
      </div>
    </div>
  );
}

function UsageBarChart({
  points,
  kind,
  loading,
}: {
  points: UsageChartPoint[];
  kind: UsageChartKind;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-48 items-end gap-2 rounded-lg border border-border-light bg-foreground/[0.02] p-4">
        {Array.from({ length: 8 }, (_, index) => (
          <SkeletonBlock
            key={index}
            className="flex-1"
            style={{ height: `${30 + (index % 3) * 20}%`, ...shimmerDelay(index) }}
          />
        ))}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border-light bg-foreground/[0.02] text-ui-sm text-muted-foreground">
        No usage in this range.
      </div>
    );
  }

  const showCompute = kind !== "llm";
  const showLlm = kind !== "compute";
  const maxCompute = chartMax(points.map((point) => secondsToPcus(point.computeSeconds)));
  const maxLlm = chartMax(points.map((point) => point.llmCostUsd));

  return (
    <div className="rounded-lg border border-border-light bg-foreground/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-4 pb-3 text-ui-sm text-muted-foreground">
        {showCompute ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Compute (PCUs)
          </span>
        ) : null}
        {showLlm ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-foreground/60" />
            LLM ($)
          </span>
        ) : null}
      </div>
      <div className="flex h-40 items-end gap-2">
        {points.map((point, index) => {
          const computeValue = secondsToPcus(point.computeSeconds);
          const computePercent = Math.round((computeValue / maxCompute) * 100);
          const llmPercent = Math.round((point.llmCostUsd / maxLlm) * 100);
          return (
            <div key={`${point.label}-${index}`} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center gap-1">
                {showCompute ? (
                  <div
                    className="w-full max-w-3 rounded-t-sm bg-primary/70"
                    style={{ height: `${Math.max(computePercent, computeValue > 0 ? 2 : 0)}%` }}
                    title={`${point.label}: ${computeValue.toFixed(1)} PCUs`}
                  />
                ) : null}
                {showLlm ? (
                  <div
                    className="w-full max-w-3 rounded-t-sm bg-foreground/40"
                    style={{ height: `${Math.max(llmPercent, point.llmCostUsd > 0 ? 2 : 0)}%` }}
                    title={`${point.label}: ${formatUsd(point.llmCostUsd)}`}
                  />
                ) : null}
              </div>
              <span className="text-ui-sm text-muted-foreground">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrgUsageTable({
  rows,
  loading,
  onSelectUser,
}: {
  rows: OrgUsageRowView[];
  loading: boolean;
  onSelectUser: (userId: string) => void;
}) {
  return (
    <SettingsSection title="Usage by member" description="Select a member to see their usage over time.">
      {loading ? (
        <div className="space-y-2 py-3">
          {[0, 1, 2].map((row) => (
            <SkeletonBlock key={row} className="h-10 w-full" style={shimmerDelay(row)} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-ui-sm text-muted-foreground">No usage recorded in this range.</div>
      ) : (
        rows.map((row) => (
          <button
            key={row.userId}
            type="button"
            onClick={() => onSelectUser(row.userId)}
            className="flex w-full items-center justify-between gap-4 border-t border-border py-3 text-left first:border-t-0 hover:bg-accent/40"
          >
            <div className="min-w-0">
              <div className="truncate text-ui font-medium text-foreground">{row.name}</div>
              <div className="truncate text-ui-sm text-muted-foreground">{row.email}</div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <UsageMiniStat label="Compute" value={row.computePcus} percent={row.computePercent} />
              <UsageMiniStat label="LLM" value={row.llmCost} percent={row.llmPercent} />
            </div>
          </button>
        ))
      )}
    </SettingsSection>
  );
}

function UsageMiniStat({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number | null;
}) {
  return (
    <div className="w-28 text-right">
      <div className="text-ui-sm text-muted-foreground">{label}</div>
      <div className="text-ui font-medium text-foreground">{value}</div>
      {percent !== null ? (
        <ProgressBar
          value={percent}
          className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10"
          indicatorClassName="h-full rounded-full bg-primary/70"
          aria-label={`${label} of cap`}
        />
      ) : null}
    </div>
  );
}

function UserDrillDown({
  row,
  points,
  loading,
  kind,
  onBack,
}: {
  row: OrgUsageRowView;
  points: UsageChartPoint[];
  loading: boolean;
  kind: UsageChartKind;
  onBack: () => void;
}) {
  return (
    <SettingsSection>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={onBack}
        className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-md px-0 text-ui text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to usage by member
      </Button>
      <div className="mb-3">
        <div className="text-ui font-medium text-foreground">{row.name}</div>
        <div className="text-ui-sm text-muted-foreground">{row.email}</div>
      </div>
      <UsageBarChart points={points} kind={kind} loading={loading} />
    </SettingsSection>
  );
}

function LimitsEditor({
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
