import { TOP_UP_PACKS } from "@proliferate/shared/billing";

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
	packId: (typeof TOP_UP_PACKS)[number]["productId"];
	name: string;
	credits: number;
	price: string;
	priceCents: number;
}

const PRICE_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
});

export const TOP_UP_PACK_OPTIONS: TopUpPackOption[] = TOP_UP_PACKS.map((p) => ({
	packId: p.productId,
	name: p.name,
	credits: p.credits,
	priceCents: p.priceCents,
	price: PRICE_FORMAT.format(p.priceCents / 100),
}));
