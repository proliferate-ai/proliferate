import crypto from "crypto";

const MAX_SERVICE_ACCOUNT_LENGTH = 30;
const MIN_SERVICE_ACCOUNT_LENGTH = 6;

function normalizeServiceAccountId(value: string): string {
	let cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	cleaned = cleaned.replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
	if (!cleaned || !/^[a-z]/.test(cleaned)) {
		cleaned = `a${cleaned}`;
	}
	return cleaned;
}

function ensureMinLength(value: string): string {
	if (value.length >= MIN_SERVICE_ACCOUNT_LENGTH) return value;
	return `${value}${"a".repeat(MIN_SERVICE_ACCOUNT_LENGTH - value.length)}`;
}

function ensureMaxLength(value: string): string {
	if (value.length <= MAX_SERVICE_ACCOUNT_LENGTH) return value;
	const hash = crypto.createHash("sha1").update(value).digest("hex").slice(0, 6);
	const maxBaseLength = MAX_SERVICE_ACCOUNT_LENGTH - hash.length - 1;
	let base = value.slice(0, Math.max(1, maxBaseLength));
	base = base.replace(/-+$/, "");
	if (!base || !/^[a-z]/.test(base)) {
		base = `a${base}`.replace(/-+$/, "");
	}
	if (base.length < 1) {
		base = "a";
	}
	const combined = `${base}-${hash}`;
	return combined.length <= MAX_SERVICE_ACCOUNT_LENGTH
		? combined
		: combined.slice(0, MAX_SERVICE_ACCOUNT_LENGTH);
}

export function makeServiceAccountId(prefix: string, suffix: string): string {
	const normalized = normalizeServiceAccountId(`${prefix}-${suffix}`);
	const withMin = ensureMinLength(normalized);
	return ensureMaxLength(withMin);
}
