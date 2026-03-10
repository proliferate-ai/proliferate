export const AUTO_RECHARGE_CAP_OPTIONS = [
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
		price: "$50",
		creditsIncluded: 100,
		maxConcurrentSessions: 10,
		maxSnapshots: 5,
		snapshotRetentionDays: 30,
	},
	{
		id: "pro",
		name: "Professional",
		price: "$200",
		creditsIncluded: 400,
		maxConcurrentSessions: 100,
		maxSnapshots: 200,
		snapshotRetentionDays: 90,
	},
];

export interface TopUpPackOption {
	packId: "topup_10" | "topup_20" | "topup_50" | "topup_100" | "topup_1000";
	name: string;
	credits: number;
	price: string;
	priceCents: number;
}

export const TOP_UP_PACK_OPTIONS: TopUpPackOption[] = [
	{ packId: "topup_10", name: "Starter", credits: 10, price: "$10", priceCents: 1000 },
	{ packId: "topup_20", name: "Builder", credits: 20, price: "$20", priceCents: 2000 },
	{ packId: "topup_50", name: "Growth", credits: 50, price: "$50", priceCents: 5000 },
	{ packId: "topup_100", name: "Scale", credits: 100, price: "$100", priceCents: 10000 },
	{ packId: "topup_1000", name: "Enterprise", credits: 1000, price: "$1,000", priceCents: 100000 },
];
