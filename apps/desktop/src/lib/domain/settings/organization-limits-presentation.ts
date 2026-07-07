import type {
  BillingPlanInfo,
  BudgetLimit,
  BudgetLimitInput,
  LlmBalance,
  OrgUserUsageRow,
  UsageTimeseriesBucket,
} from "@proliferate/cloud-sdk";
import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";

export type UsageRangeDays = 7 | 30 | 90;
export type UsageGranularity = "day" | "week" | "month";
export type UsageChartKind = "all" | "compute" | "llm";
export type BudgetLimitKind = "compute" | "llm";
export type BudgetLimitWindow = "day" | "month";

export const USAGE_RANGE_OPTIONS: { value: UsageRangeDays; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

export const USAGE_GRANULARITY_OPTIONS: { value: UsageGranularity; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

export const USAGE_KIND_ITEMS = [
  { id: "all", label: "All" },
  { id: "llm", label: "LLM" },
  { id: "compute", label: "Compute" },
] as const satisfies readonly { id: UsageChartKind; label: string }[];

export function secondsToPcus(seconds: number | null | undefined): number {
  return Math.max(seconds ?? 0, 0) / 3600;
}

export function formatPcus(value: number | null | undefined): string {
  const rounded = Math.round(Math.max(value ?? 0, 0) * 10) / 10;
  const formatted = rounded.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  });
  return `${formatted} ${rounded === 1 ? "PCU" : "PCUs"}`;
}

export function formatUsd(value: number | null | undefined): string {
  return `$${Math.max(value ?? 0, 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface BudgetBalanceView {
  label: string;
  available: string;
  total: string;
  used: string;
  percentAvailable: number;
}

/** Org-wide compute balance, derived from the org billing subject's grant allocations. */
export function computeGrantBalance(plan: BillingPlanInfo | null | undefined): BudgetBalanceView {
  const grants = (plan?.grantAllocations ?? []).filter((grant) =>
    grant.active || grant.consumedSeconds > 0 || grant.remainingSeconds > 0
  );
  const purchased = grants.reduce((total, grant) => total + secondsToPcus(grant.totalSeconds), 0);
  const available = grants.reduce((total, grant) => total + secondsToPcus(grant.remainingSeconds), 0);
  const used = grants.reduce((total, grant) => total + secondsToPcus(grant.consumedSeconds), 0);
  return {
    label: "Compute units",
    available: formatPcus(available),
    total: `${formatPcus(purchased)} purchased`,
    used: `${formatPcus(used)} used`,
    percentAvailable: purchased > 0 ? Math.round((available / purchased) * 100) : 0,
  };
}

/** Org-wide LLM balance, from get_remaining_credit_usd at the org billing subject. */
export function llmGrantBalance(balance: LlmBalance | null | undefined): BudgetBalanceView {
  const granted = balance?.grantedUsd ?? 0;
  const remaining = balance?.remainingUsd ?? 0;
  const used = balance?.usedUsd ?? 0;
  return {
    label: "LLM credits",
    available: formatUsd(remaining),
    total: `${formatUsd(granted)} purchased`,
    used: `${formatUsd(used)} used`,
    percentAvailable: granted > 0 ? Math.round((remaining / granted) * 100) : 0,
  };
}

export interface UsageChartPoint {
  label: string;
  computeSeconds: number;
  llmCostUsd: number;
}

export function bucketLabel(bucketStart: string, granularity: UsageGranularity): string {
  const date = new Date(bucketStart);
  if (Number.isNaN(date.getTime())) {
    return bucketStart;
  }
  if (granularity === "month") {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function toChartPoints(
  buckets: readonly UsageTimeseriesBucket[] | null | undefined,
  granularity: UsageGranularity,
): UsageChartPoint[] {
  return (buckets ?? []).map((bucket) => ({
    label: bucketLabel(bucket.bucketStart, granularity),
    computeSeconds: bucket.computeSeconds,
    llmCostUsd: bucket.llmCostUsd,
  }));
}

export function chartMax(values: number[]): number {
  return Math.max(...values, 1);
}

export interface OrgUsageRowView {
  userId: string;
  name: string;
  email: string;
  computePcus: string;
  llmCost: string;
  computePercent: number | null;
  llmPercent: number | null;
}

export function buildOrgUsageRows(
  rows: readonly OrgUserUsageRow[] | null | undefined,
): OrgUsageRowView[] {
  return (rows ?? []).map((row) => ({
    userId: row.userId,
    name: row.displayName || row.email,
    email: row.email,
    computePcus: formatPcus(secondsToPcus(row.computeSeconds)),
    llmCost: formatUsd(row.llmCostUsd),
    computePercent: row.computeLimitCapSeconds
      ? Math.min(100, Math.round((row.computeSeconds / row.computeLimitCapSeconds) * 100))
      : null,
    llmPercent: row.llmLimitCapUsd
      ? Math.min(100, Math.round((row.llmCostUsd / row.llmLimitCapUsd) * 100))
      : null,
  }));
}

export interface BudgetLimitDraftRow {
  id: string;
  userId: string | null;
  kind: BudgetLimitKind;
  window: BudgetLimitWindow;
  capValue: number;
  enabled: boolean;
}

export function limitsToDraftRows(
  limits: readonly BudgetLimit[] | null | undefined,
): BudgetLimitDraftRow[] {
  return (limits ?? []).map((limit) => ({
    id: limit.id,
    userId: limit.userId,
    kind: limit.kind,
    window: limit.window,
    capValue: limit.capValue,
    enabled: limit.enabled,
  }));
}

export function newDraftRow(userId: string | null): BudgetLimitDraftRow {
  return {
    id: `draft-${Math.random().toString(36).slice(2)}`,
    userId,
    kind: "compute",
    window: "month",
    capValue: 0,
    enabled: true,
  };
}

export function draftRowsToInput(rows: readonly BudgetLimitDraftRow[]): BudgetLimitInput[] {
  return rows.map(({ id: _id, ...input }) => input);
}

export function memberLabel(
  userId: string | null,
  members: readonly OrganizationMemberRecord[],
): string {
  if (!userId) {
    return "Organization-wide";
  }
  const member = members.find((candidate) => candidate.userId === userId);
  return member ? member.displayName || member.email : "Unknown member";
}

/**
 * Usage next to a limit row's cap. Per-user rows read the matching by-user
 * row; org-wide rows sum every member's usage. `byUserRows` is fetched over
 * a fixed day range (the chart's range control), not the limit's own
 * day/month window, so this is an approximation for display, not enforcement.
 */
export function usageForRow(
  row: Pick<BudgetLimitDraftRow, "userId" | "kind">,
  byUserRows: readonly OrgUserUsageRow[] | null | undefined,
): number {
  const rows = byUserRows ?? [];
  if (row.userId) {
    const match = rows.find((candidate) => candidate.userId === row.userId);
    if (!match) {
      return 0;
    }
    return row.kind === "compute" ? match.computeSeconds : match.llmCostUsd;
  }
  return rows.reduce(
    (total, candidate) =>
      total + (row.kind === "compute" ? candidate.computeSeconds : candidate.llmCostUsd),
    0,
  );
}

export function usageSummaryLabel(kind: BudgetLimitKind, used: number): string {
  return kind === "compute" ? `${formatPcus(secondsToPcus(used))} used` : `${formatUsd(used)} used`;
}

/** Compute caps are stored in seconds; the input field reads/writes PCUs. */
export function capInputValue(kind: BudgetLimitKind, capValueSeconds: number): number {
  return kind === "compute" ? Math.round((capValueSeconds / 3600) * 100) / 100 : capValueSeconds;
}

export function capValueFromInput(kind: BudgetLimitKind, inputValue: number): number {
  const safeValue = Number.isFinite(inputValue) ? Math.max(inputValue, 0) : 0;
  return kind === "compute" ? Math.round(safeValue * 3600) : safeValue;
}
