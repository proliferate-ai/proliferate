const cookieName = "proliferate_utm";
const cookieMaxAge = 30 * 24 * 60 * 60; // 30 days in seconds

const utmParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

type UtmKey = (typeof utmParams)[number];
export type UtmData = Partial<Record<UtmKey, string>>;

export function getCookieDomain(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const host = window.location.hostname;
	// Only set cross-subdomain cookie on proliferate.com domains
	if (host === "proliferate.com" || host.endsWith(".proliferate.com")) {
		return ".proliferate.com";
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
	if (document.cookie.split("; ").some((c) => c.startsWith(`${cookieName}=`))) return;

	const params = new URLSearchParams(window.location.search);
	const utms: UtmData = {};
	let hasUtms = false;

	for (const key of utmParams) {
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
	document.cookie = `${cookieName}=${encoded}; path=/; max-age=${cookieMaxAge}; SameSite=Lax${domainPart}`;
}

/**
 * Reads the UTM cookie and returns parsed data, or null if not set.
 */
export function getUtms(): UtmData | null {
	if (typeof window === "undefined") return null;

	const match = document.cookie.split("; ").find((c) => c.startsWith(`${cookieName}=`));
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
