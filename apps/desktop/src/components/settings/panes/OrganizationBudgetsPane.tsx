import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { OrganizationMemberLlmBudgets } from "@/components/settings/panes/organization/OrganizationMemberLlmBudgets";
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  AVAILABLE_COMPUTE_PCUS,
  AVAILABLE_LLM_CREDITS,
  COMPUTE_BUDGET_PCUS,
  LLM_BUDGET_CREDITS,
  TOTAL_COMPUTE_PCUS,
  TOTAL_LLM_CREDITS,
  USED_COMPUTE_PCUS,
  USED_LLM_CREDITS,
  USAGE_BY_SOURCE,
  USAGE_POINTS,
  buildBudgetPeople,
  type BudgetPerson,
  type UsagePoint,
} from "@/lib/domain/settings/organization-budgets-presentation";

export function OrganizationBudgetsPane() {
  const { activeOrganization, activeOrganizationId, organizationsQuery } = useActiveOrganization();
  const membersQuery = useOrganizationMembers(activeOrganizationId);
  const people = buildBudgetPeople(membersQuery.data?.members ?? []);
  const computePercentAvailable = Math.round((AVAILABLE_COMPUTE_PCUS / TOTAL_COMPUTE_PCUS) * 100);
  const llmPercentAvailable = Math.round((AVAILABLE_LLM_CREDITS / TOTAL_LLM_CREDITS) * 100);

  return (
    <section className="max-w-[980px] space-y-6">
      <SettingsPageHeader
        title="Budgets"
        description="Track compute units and LLM credits as separate organization budgets."
      />

      {!activeOrganization && organizationsQuery.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading organization...</div>
      ) : null}

      <div className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SettingsEyebrow as="h2">Balances remaining</SettingsEyebrow>
              <Badge tone="neutral">Mocked UI</Badge>
            </div>
            <p className="max-w-2xl text-xs leading-[1.45] text-muted-foreground">
              Compute units and LLM credits have separate balances, budgets, and top-up rules.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <BudgetBalanceCard
            label="Compute units"
            available={`${AVAILABLE_COMPUTE_PCUS} PCUs`}
            total={`${TOTAL_COMPUTE_PCUS} purchased`}
            used={`${USED_COMPUTE_PCUS} PCUs used`}
            percentAvailable={computePercentAvailable}
          />
          <BudgetBalanceCard
            label="LLM credits"
            available={`${AVAILABLE_LLM_CREDITS.toLocaleString()} LLM credits`}
            total={`${TOTAL_LLM_CREDITS.toLocaleString()} purchased`}
            used={`${USED_LLM_CREDITS.toLocaleString()} LLM credits used`}
            percentAvailable={llmPercentAvailable}
          />
        </div>
      </div>

      <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <SettingsEyebrow as="h2">Total usage</SettingsEyebrow>
              <p className="max-w-2xl text-xs leading-[1.45] text-muted-foreground">
                {USED_COMPUTE_PCUS} PCUs and {USED_LLM_CREDITS.toLocaleString()} LLM credits used in the last 7 days.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="w-full sm:w-44">
                <Select aria-label="Usage range" defaultValue="7d">
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                </Select>
              </div>
              <Button type="button" variant="secondary" disabled>
                Forecast
              </Button>
            </div>
          </div>
          <UsageAreaChart points={USAGE_POINTS} />
      </div>

      <SettingsSection
        title="Usage by source"
        description="Mocked split of credit consumption until usage rollups are wired."
      >
        {USAGE_BY_SOURCE.map((source) => (
          <SettingsRow
            key={source.label}
            label={source.label}
            description={source.description}
          >
            <div className="flex min-w-[12rem] items-center gap-3">
              <ProgressBar
                value={source.percent}
                className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10"
                indicatorClassName="h-full rounded-full bg-foreground/50"
              />
              <span className="w-16 text-right text-sm font-medium text-foreground">
                {source.value}
              </span>
            </div>
          </SettingsRow>
        ))}
      </SettingsSection>

      <OrganizationBudgetPeople people={people} />

      <OrganizationMemberLlmBudgets people={people} />

      <SettingsSection>
        <SettingsRow
          label="Monthly compute budget"
          description="Alert owners before runtime and agent-session consumption crosses this amount."
        >
          <div className="text-sm font-medium text-foreground">{COMPUTE_BUDGET_PCUS} PCUs</div>
        </SettingsRow>
        <SettingsRow
          label="LLM and model budget"
          description="Track gateway, model, and inference-backed tool usage separately from runtime."
        >
          <div className="text-sm font-medium text-foreground">{LLM_BUDGET_CREDITS.toLocaleString()} LLM credits</div>
        </SettingsRow>
        <SettingsRow
          label="Compute auto top-up"
          description="Purchase more compute units when runtime capacity drops below the configured threshold."
        >
          <Switch checked={false} onChange={() => {}} disabled aria-label="Compute auto top-up" />
        </SettingsRow>
        <SettingsRow
          label="LLM credit auto top-up"
          description="Purchase more LLM credits when model usage balance drops below the configured threshold."
        >
          <Switch checked={false} onChange={() => {}} disabled aria-label="LLM credit auto top-up" />
        </SettingsRow>
      </SettingsSection>
    </section>
  );
}

function OrganizationBudgetPeople({ people }: { people: BudgetPerson[] }) {
  return (
    <SettingsSection
      title="Usage by person"
      description="Mocked compute and LLM usage mapped onto current members."
    >
      {people.map((person) => (
        <SettingsRow
          key={person.email}
          label={person.name}
          description={person.email}
        >
          <div className="flex min-w-[15rem] items-center justify-end gap-3">
            <ProgressBar
              value={person.computePercent}
              className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10"
              indicatorClassName="h-full rounded-full bg-foreground/50"
            />
            <span className="w-32 text-right text-sm font-medium text-foreground">
              {person.usedPcus} PCUs · {person.usedLlmCredits.toLocaleString()} LLM
            </span>
          </div>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

function BudgetBalanceCard({
  label,
  available,
  total,
  used,
  percentAvailable,
}: {
  label: string;
  available: string;
  total: string;
  used: string;
  percentAvailable: number;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border-light bg-foreground/[0.02] p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-2xl font-semibold tracking-tight text-foreground">{available}</div>
        <div className="text-sm text-muted-foreground">available of {total}</div>
      </div>
      <ProgressBar
        value={percentAvailable}
        className="h-4 overflow-hidden rounded-full border border-border-light bg-foreground/5 p-0.5"
        indicatorClassName="h-full rounded-full bg-primary/70"
        aria-label={`${label} available`}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{used}</span>
        <span>{percentAvailable}% remaining</span>
      </div>
    </div>
  );
}

function UsageAreaChart({ points }: { points: UsagePoint[] }) {
  const width = 720;
  const height = 220;
  const paddingX = 24;
  const paddingTop = 16;
  const paddingBottom = 34;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxCompute = Math.max(...points.map((point) => point.compute), 1);
  const maxLlm = Math.max(...points.map((point) => point.llm), 1);
  const bottomY = height - paddingBottom;
  const plottedPoints = points.map((point, index) => {
    const x = points.length === 1
      ? width / 2
      : paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
    const computeY = bottomY - (point.compute / maxCompute) * chartHeight;
    const llmY = bottomY - (point.llm / maxLlm) * chartHeight;
    return { ...point, x, computeY, llmY };
  });
  const computeLinePoints = plottedPoints.map((point) => `${point.x},${point.computeY}`).join(" ");
  const llmLinePoints = plottedPoints.map((point) => `${point.x},${point.llmY}`).join(" ");
  const computeAreaPoints = [
    `${plottedPoints[0]?.x ?? paddingX},${bottomY}`,
    computeLinePoints,
    `${plottedPoints[plottedPoints.length - 1]?.x ?? width - paddingX},${bottomY}`,
  ].join(" ");

  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-foreground/[0.02] px-2 py-3">
      <div className="flex flex-wrap items-center gap-4 px-3 pb-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" />
          Compute units
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-foreground/60" />
          LLM credits
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Compute and LLM usage over time"
        className="h-56 w-full text-primary"
      >
        {[0, 1, 2, 3].map((line) => {
          const y = paddingTop + (line / 3) * chartHeight;
          return (
            <line
              key={line}
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
              className="stroke-border-light"
              strokeWidth="1"
            />
          );
        })}
        <polygon points={computeAreaPoints} fill="currentColor" className="text-primary/10" />
        <polyline
          points={computeLinePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={llmLinePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-foreground/60"
        />
        {plottedPoints.map((point) => (
          <circle
            key={`${point.label}-compute`}
            cx={point.x}
            cy={point.computeY}
            r="4"
            fill="currentColor"
          >
            <title>{`${point.label}: ${point.compute} PCUs`}</title>
          </circle>
        ))}
        {plottedPoints.map((point) => (
          <circle
            key={`${point.label}-llm`}
            cx={point.x}
            cy={point.llmY}
            r="4"
            className="fill-foreground/60"
          >
            <title>{`${point.label}: ${point.llm.toLocaleString()} LLM credits`}</title>
          </circle>
        ))}
        {plottedPoints.map((point) => (
          <text
            key={`${point.label}-label`}
            x={point.x}
            y={height - 10}
            textAnchor="middle"
            fill="currentColor"
            className="text-[10px] text-muted-foreground"
          >
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
