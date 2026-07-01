import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Select } from "@proliferate/ui/primitives/Select";
import type { BudgetPerson } from "@/lib/domain/settings/organization-budgets-presentation";

export function OrganizationMemberLlmBudgets({ people }: { people: BudgetPerson[] }) {
  return (
    <div>
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Monthly LLM budgets</div>
          <Badge tone="info">Enterprise</Badge>
          <Badge tone="neutral">Mocked UI</Badge>
        </div>
        <div className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Set the maximum model and gateway credits each member can use per month.
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_minmax(8rem,0.6fr)] gap-4 border-b border-border px-5 py-3 text-xs font-medium uppercase text-muted-foreground md:grid">
        <div>Member</div>
        <div>Current month</div>
        <div>Monthly max</div>
        <div>Alert at</div>
      </div>

      {people.map((person) => {
        const budgetInputId = `llm-budget-${toBudgetFieldId(person.email)}-monthly-max`;
        const thresholdInputId = `llm-budget-${toBudgetFieldId(person.email)}-alert-at`;

        return (
          <div
            key={person.email}
            className="grid gap-3 border-b border-border px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.9fr)_minmax(9rem,0.7fr)_minmax(8rem,0.6fr)] md:items-center md:gap-4"
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
              <Label
                htmlFor={budgetInputId}
                className="mb-1 block text-xs font-medium uppercase text-muted-foreground md:hidden"
              >
                Monthly max
              </Label>
              <Input
                id={budgetInputId}
                type="number"
                min={0}
                step={100}
                defaultValue={person.monthlyLlmBudgetCredits}
                aria-label={`${person.name} monthly LLM credit budget`}
              />
            </div>

            <div className="min-w-0">
              <Label
                htmlFor={thresholdInputId}
                className="mb-1 block text-xs font-medium uppercase text-muted-foreground md:hidden"
              >
                Alert at
              </Label>
              <Select
                id={thresholdInputId}
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
        );
      })}

      <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Enforcement will pause new LLM-backed work for a member once their monthly max is reached.
        </div>
        <Button type="button" variant="secondary" disabled className="w-full sm:w-auto">
          Save budgets
        </Button>
      </div>
    </div>
  );
}

function toBudgetFieldId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
