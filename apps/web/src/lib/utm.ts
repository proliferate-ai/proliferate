const COOKIE_NAME = "proliferate_utm";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

type UtmKey = (typeof UTM_PARAMS)[number];
export type UtmData = Partial<Record<UtmKey, string>>;

function getCookieDomain(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const host = window.location.hostname;
	// Only set cross-subdomain cookie on proliferate.ai domains
	if (host === "proliferate.ai" || host.endsWith(".proliferate.ai")) {
		return ".proliferate.ai";
	}
	return undefined;
}

/**
 * Reads UTM params from the current URL and stores them in a first-touch cookie.
 * Only sets the cookie if UTM params are present AND no existing cookie exists (first touch wins).
 */
export function captureUtms(): void {
	if (typeof window === "undefined") return;

	// First-touch: don't overwrite existing UTM cookie
	if (document.cookie.includes(COOKIE_NAME)) return;

	const params = new URLSearchParams(window.location.search);
	const utms: UtmData = {};
	let hasUtms = false;

	for (const key of UTM_PARAMS) {
		const value = params.get(key);
		if (value) {
			utms[key] = value;
			hasUtms = true;
		}
	}

	if (!hasUtms) return;

	const encoded = encodeURIComponent(JSON.stringify(utms));
	const domain = getCookieDomain();
	const domainPart = domain ? `; domain=${domain}` : "";
	document.cookie = `${COOKIE_NAME}=${encoded}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${domainPart}`;
}

/**
 * Reads the UTM cookie and returns parsed data, or null if not set.
 */
export function getUtms(): UtmData | null {
	if (typeof window === "undefined") return null;

	const match = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_NAME}=`));
	if (!match) return null;

	try {
		return JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
	} catch {
		return null;
	}
}

/**
 * Builds a query string from stored UTMs (e.g. for landing→app links).
 * Returns empty string if no UTMs stored.
 */
export function buildUtmQueryString(): string {
	const utms = getUtms();
	if (!utms) return "";

	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(utms)) {
		if (value) params.set(key, value);
	}

	const str = params.toString();
	return str ? `?${str}` : "";
}
