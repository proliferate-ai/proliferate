/** Build an auth page link preserving redirect + email params. */
export function buildAuthLink(base: string, redirect: string, email: string): string {
	const params = new URLSearchParams();
	if (redirect && redirect !== "/dashboard") params.set("redirect", redirect);
	if (email) params.set("email", email);
	const queryString = params.toString();
	return queryString ? `${base}?${queryString}` : base;
}

/** Sanitize a redirect URL from query params to prevent open redirects. */
export function sanitizeRedirect(raw: string | null): string {
	const fallback = "/dashboard";
	if (!raw) return fallback;
	// Only allow relative paths (no protocol-relative or absolute URLs)
	if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
	return raw;
}
