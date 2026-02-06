"use client";

import { signIn } from "./auth-client";

const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 700;

/**
 * Open GitHub OAuth in a popup window instead of full redirect
 */
export async function signInWithPopup(
	provider: "github",
	onSuccess?: () => void,
	onError?: (error: string) => void,
): Promise<void> {
	// Calculate popup position (centered)
	const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
	const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;

	// Open popup first (must be synchronous with user action)
	const popup = window.open(
		"about:blank",
		"oauth_popup",
		`width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},toolbar=no,menubar=no`,
	);

	if (!popup) {
		onError?.("Popup blocked. Please allow popups for this site.");
		return;
	}

	try {
		// Get the OAuth URL from better-auth
		const result = await signIn.social({
			provider,
			callbackURL: "/auth/callback",
			disableRedirect: true,
		});

		if (result.error) {
			popup.close();
			onError?.(result.error.message || "Failed to start OAuth");
			return;
		}

		// Navigate popup to OAuth URL
		if (result.data?.url) {
			popup.location.href = result.data.url;
		} else {
			popup.close();
			onError?.("No OAuth URL returned");
			return;
		}

		// Listen for callback message
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;

			if (event.data?.type === "oauth_callback") {
				window.removeEventListener("message", handleMessage);
				popup.close();

				if (event.data.success) {
					onSuccess?.();
				} else {
					onError?.(event.data.error || "Authentication failed");
				}
			}
		};

		window.addEventListener("message", handleMessage);

		// Also poll for popup close (user might close it manually)
		const pollTimer = setInterval(() => {
			if (popup.closed) {
				clearInterval(pollTimer);
				window.removeEventListener("message", handleMessage);
			}
		}, 500);
	} catch (err) {
		popup.close();
		onError?.(err instanceof Error ? err.message : "Failed to start OAuth");
	}
}
