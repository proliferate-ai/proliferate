/**
 * Public configuration.
 *
 * Single source of truth for all NEXT_PUBLIC_* env reads in the web app.
 * Import resolved values from here — never read process.env in leaf files.
 */

function resolveBackendBaseUrl(): string {
	const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
	if (explicit) return explicit;

	// In the browser, same-origin works when a reverse proxy (e.g. Caddy)
	// routes /api/rpc/* to the backend service.
	if (typeof window !== "undefined") return window.location.origin;

	// Server-side (SSR/build): same-origin is meaningless, but the value is
	// only used on the client. Return empty string so the module loads.
	return "";
}

export const publicConfig = {
	/** Base URL for the oRPC backend (no trailing slash). */
	backendBaseUrl: resolveBackendBaseUrl(),
};
