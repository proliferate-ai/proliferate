export type IsoDateInput = Date | string | null | undefined;

export function toIsoString(value: IsoDateInput): string | null {
	if (value == null) return null;
	return typeof value === "string" ? value : value.toISOString();
}

export function toIsoStringRequired(value: Date | string): string {
	return typeof value === "string" ? value : value.toISOString();
}
