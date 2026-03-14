/**
 * Public configuration.
 *
 * Single source of truth for all NEXT_PUBLIC_* env reads in the web app.
 * Import resolved values from here — never read process.env in leaf files.
 */

function resolveBackendBaseUrl(): string {
	const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
	if (explicit) return explicit;

	if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
		return window.location.origin;
	}

	if (typeof window !== "undefined") {
		throw new Error("NEXT_PUBLIC_BACKEND_URL must be set in production.");
	}

	// Server-side (SSR/build): this module is consumed by a client entrypoint,
	// so defer the production validation until the browser evaluates it.
	return "";
}

function resolveAppUrl(): string {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export const publicConfig = {
	/** Base URL for the web app (no trailing slash). */
	appUrl: resolveAppUrl(),
	/** Base URL for the oRPC backend (no trailing slash). */
	backendBaseUrl: resolveBackendBaseUrl(),
};
