import type { OrganizationMemberRecord } from "@/lib/domain/organizations/organization-records";

export const COMPUTE_BUDGET_PCUS = 500;
export const TOTAL_COMPUTE_PCUS = 360;
export const AVAILABLE_COMPUTE_PCUS = 118;
export const USED_COMPUTE_PCUS = TOTAL_COMPUTE_PCUS - AVAILABLE_COMPUTE_PCUS;
export const LLM_BUDGET_CREDITS = 12000;
export const TOTAL_LLM_CREDITS = 12000;
export const AVAILABLE_LLM_CREDITS = 4600;
export const USED_LLM_CREDITS = TOTAL_LLM_CREDITS - AVAILABLE_LLM_CREDITS;

export interface BudgetPerson {
  name: string;
  email: string;
  usedPcus: number;
  usedLlmCredits: number;
  monthlyLlmBudgetCredits: number;
  alertThresholdPercent: number;
  computePercent: number;
  llmBudgetPercent: number;
}

export interface UsagePoint {
  label: string;
  compute: number;
  llm: number;
}

export const USAGE_POINTS: UsagePoint[] = [
  { label: "Jun 18", compute: 12, llm: 390 },
  { label: "Jun 19", compute: 28, llm: 840 },
  { label: "Jun 20", compute: 23, llm: 760 },
  { label: "Jun 21", compute: 41, llm: 1260 },
  { label: "Jun 22", compute: 58, llm: 1710 },
  { label: "Jun 23", compute: 47, llm: 1480 },
  { label: "Jun 24", compute: 33, llm: 960 },
];

export const USAGE_BY_SOURCE = [
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

export function buildBudgetPeople(members: OrganizationMemberRecord[]): BudgetPerson[] {
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
