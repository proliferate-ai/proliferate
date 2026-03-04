export type DetailTab = "activity" | "sessions" | "settings";

export const DETAIL_TABS: { value: DetailTab; label: string }[] = [
	{ value: "activity", label: "Activity" },
	{ value: "sessions", label: "Sessions" },
	{ value: "settings", label: "Settings" },
];
