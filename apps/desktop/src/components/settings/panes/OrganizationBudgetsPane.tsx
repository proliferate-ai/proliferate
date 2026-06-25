import { Input } from "@proliferate/ui/primitives/Input";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { useOrganizationMembers } from "@/hooks/access/cloud/organizations/use-organization-members";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";

const COMPUTE_BUDGET_PCUS = 500;
const TOTAL_COMPUTE_PCUS = 360;
const AVAILABLE_COMPUTE_PCUS = 118;
const USED_COMPUTE_PCUS = TOTAL_COMPUTE_PCUS - AVAILABLE_COMPUTE_PCUS;
const LLM_BUDGET_CREDITS = 12000;
const TOTAL_LLM_CREDITS = 12000;
const AVAILABLE_LLM_CREDITS = 4600;
const USED_LLM_CREDITS = TOTAL_LLM_CREDITS - AVAILABLE_LLM_CREDITS;
const USAGE_POINTS: UsagePoint[] = [
  { label: "Jun 18", compute: 12, llm: 390 },
  { label: "Jun 19", compute: 28, llm: 840 },
  { label: "Jun 20", compute: 23, llm: 760 },
  { label: "Jun 21", compute: 41, llm: 1260 },
  { label: "Jun 22", compute: 58, llm: 1710 },
  { label: "Jun 23", compute: 47, llm: 1480 },
  { label: "Jun 24", compute: 33, llm: 960 },
];
const USAGE_BY_SOURCE = [
  {
    label: "LLM and model usage",
    description: "Model calls, gateway usage, and inference-backed tools.",
    value: "7,400 LLM credits",
    percent: Math.round((USED_LLM_CREDITS / LLM_BUDGET_CREDITS) * 100),
  },
  {
    label: "Compute runtime",
    description: "Hosted environments, local runtime bridges, and execution time.",
    value: "188 PCUs",
    percent: Math.round((188 / COMPUTE_BUDGET_PCUS) * 100),
  },
  {
    label: "Agent sessions",
    description: "Workspace orchestration and background session services.",
    value: "54 PCUs",
    percent: Math.round((54 / COMPUTE_BUDGET_PCUS) * 100),
  },
];
const FALLBACK_PEOPLE = [
  { name: "Pablo", email: "pablo@pablohansen.com" },
  { name: "Alex", email: "alex@example.com" },
  { name: "Maya", email: "maya@example.com" },
  { name: "Jordan", email: "jordan@example.com" },
];

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
        <div className="text-sm text-muted-foreground">Loading organization...</div>
      ) : null}

      <SettingsCard>
        <div className="space-y-5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Balances remaining</h2>
                <Badge tone="neutral">Mocked UI</Badge>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
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
      </SettingsCard>

      <SettingsCard>
        <div className="space-y-5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground">Total usage</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
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
      </SettingsCard>

      <SettingsCard>
        <div className="border-b border-border-light px-5 py-4">
          <div className="text-lg font-semibold text-foreground">Usage by source</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Mocked split of credit consumption until usage rollups are wired.
          </div>
        </div>
        {USAGE_BY_SOURCE.map((source) => (
          <SettingsCardRow
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
          </SettingsCardRow>
        ))}
      </SettingsCard>

      <OrganizationBudgetPeople people={people} />

      <OrganizationMemberLlmBudgets people={people} />

      <SettingsCard>
        <SettingsCardRow
          label="Monthly compute budget"
          description="Alert owners before runtime and agent-session consumption crosses this amount."
        >
          <div className="text-sm font-medium text-foreground">{COMPUTE_BUDGET_PCUS} PCUs</div>
        </SettingsCardRow>
        <SettingsCardRow
          label="LLM and model budget"
          description="Track gateway, model, and inference-backed tool usage separately from runtime."
        >
          <div className="text-sm font-medium text-foreground">{LLM_BUDGET_CREDITS.toLocaleString()} LLM credits</div>
        </SettingsCardRow>
        <SettingsCardRow
          label="Compute auto top-up"
          description="Purchase more compute units when runtime capacity drops below the configured threshold."
        >
          <Switch checked={false} onChange={() => {}} disabled aria-label="Compute auto top-up" />
        </SettingsCardRow>
        <SettingsCardRow
          label="LLM credit auto top-up"
          description="Purchase more LLM credits when model usage balance drops below the configured threshold."
        >
          <Switch checked={false} onChange={() => {}} disabled aria-label="LLM credit auto top-up" />
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}

function OrganizationBudgetPeople({ people }: { people: BudgetPerson[] }) {
  return (
    <SettingsCard>
      <div className="border-b border-border-light px-5 py-4">
        <div className="text-lg font-semibold text-foreground">Usage by person</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Mocked compute and LLM usage mapped onto current members.
        </div>
      </div>
      {people.map((person) => (
        <SettingsCardRow
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
        </SettingsCardRow>
      ))}
    </SettingsCard>
  );
}

function OrganizationMemberLlmBudgets({ people }: { people: BudgetPerson[] }) {
  return (
    <SettingsCard>
      <div className="border-b border-border-light px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-lg font-semibold text-foreground">Monthly LLM budgets</div>
          <Badge tone="info">Enterprise</Badge>
          <Badge tone="neutral">Mocked UI</Badge>
        </div>
        <div className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Set the maximum model and gateway credits each member can use per month.
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_minmax(8rem,0.6fr)] gap-4 border-b border-border-light px-5 py-3 text-xs font-medium uppercase text-muted-foreground md:grid">
        <div>Member</div>
        <div>Current month</div>
        <div>Monthly max</div>
        <div>Alert at</div>
      </div>

      {people.map((person) => (
        <div
          key={person.email}
          className="grid gap-3 border-b border-border-light px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_minmax(8rem,0.6fr)] md:items-center md:gap-4"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{person.name}</div>
            <div className="truncate text-sm text-muted-foreground">{person.email}</div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground md:hidden">Current month</span>
              <span className="font-medium text-foreground">
                {person.usedLlmCredits.toLocaleString()} / {person.monthlyLlmBudgetCredits.toLocaleString()}
              </span>
            </div>
            <ProgressBar
              value={person.llmBudgetPercent}
              className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
              indicatorClassName="h-full rounded-full bg-primary/70"
              aria-label={`${person.name} LLM budget usage`}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground md:hidden">
              Monthly max
            </label>
            <Input
              type="number"
              min={0}
              step={100}
              defaultValue={person.monthlyLlmBudgetCredits}
              aria-label={`${person.name} monthly LLM credit budget`}
            />
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground md:hidden">
              Alert at
            </label>
            <Select
              defaultValue={String(person.alertThresholdPercent)}
              aria-label={`${person.name} LLM budget alert threshold`}
            >
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="80">80%</option>
              <option value="90">90%</option>
              <option value="100">100%</option>
            </Select>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3 border-t border-border-light px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Enforcement will pause new LLM-backed work for a member once their monthly max is reached.
        </div>
        <Button type="button" variant="secondary" disabled className="w-full sm:w-auto">
          Save budgets
        </Button>
      </div>
    </SettingsCard>
  );
}

interface BudgetPerson {
  name: string;
  email: string;
  usedPcus: number;
  usedLlmCredits: number;
  monthlyLlmBudgetCredits: number;
  alertThresholdPercent: number;
  computePercent: number;
  llmBudgetPercent: number;
}

interface UsagePoint {
  label: string;
  compute: number;
  llm: number;
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

function buildBudgetPeople(members: OrganizationMemberRecord[]): BudgetPerson[] {
  const source = members.length > 0
    ? members.map((member) => ({
        name: member.displayName || member.email,
        email: member.email,
      }))
    : FALLBACK_PEOPLE;

  return source.slice(0, 5).map((person, index) => {
    const usedPcus = [72, 45, 31, 22, 12][index] ?? 8;
    const usedLlmCredits = [2800, 1900, 1320, 880, 500][index] ?? 250;
    const monthlyLlmBudgetCredits = [5000, 3000, 2500, 1800, 1000][index] ?? 1000;
    return {
      ...person,
      usedPcus,
      usedLlmCredits,
      monthlyLlmBudgetCredits,
      alertThresholdPercent: [80, 80, 75, 75, 50][index] ?? 80,
      computePercent: Math.round((usedPcus / COMPUTE_BUDGET_PCUS) * 100),
      llmBudgetPercent: Math.min(
        100,
        Math.round((usedLlmCredits / monthlyLlmBudgetCredits) * 100),
      ),
    };
  });
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
