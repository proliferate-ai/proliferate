export const OVERAGE_CAP_OPTIONS = [
	{ value: "5000", label: "$50" },
	{ value: "10000", label: "$100" },
	{ value: "20000", label: "$200" },
	{ value: "50000", label: "$500" },
	{ value: "unlimited", label: "Unlimited" },
];

export type PlanId = "dev" | "pro";

export interface PlanOption {
	id: PlanId;
	name: string;
	price: string;
	creditsIncluded: number;
	maxConcurrentSessions: number;
	maxSnapshots: number;
	snapshotRetentionDays: number;
}

export const PLAN_OPTIONS: PlanOption[] = [
	{
		id: "dev",
		name: "Developer",
		price: "$20",
		creditsIncluded: 1000,
		maxConcurrentSessions: 10,
		maxSnapshots: 5,
		snapshotRetentionDays: 30,
	},
	{
		id: "pro",
		name: "Professional",
		price: "$500",
		creditsIncluded: 7500,
		maxConcurrentSessions: 100,
		maxSnapshots: 200,
		snapshotRetentionDays: 90,
	},
];
