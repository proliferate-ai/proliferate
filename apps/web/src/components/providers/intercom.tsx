"use client";

import { useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { env } from "@proliferate/environment/public";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const INTERCOM_APP_ID = env.NEXT_PUBLIC_INTERCOM_APP_ID;

// Declare Intercom types
declare global {
	interface Window {
		Intercom?: (...args: unknown[]) => void;
		intercomSettings?: Record<string, unknown>;
	}
}

/**
 * Opens the Intercom messenger. Returns true if Intercom is available, false otherwise.
 */
export function openIntercomMessenger(): boolean {
	if (typeof window !== "undefined" && window.Intercom) {
		window.Intercom("showNewMessage", "");
		return true;
	}
	return false;
}

export function IntercomProvider() {
	const { data: session } = useSession();
	const scriptLoadedRef = useRef(false);

	// Fetch user hash for identity verification
	const { data: userHashData } = useQuery({
		...orpc.intercom.getUserHash.queryOptions({ input: {} }),
		enabled: !!session?.user,
	});
	const userHash = userHashData?.userHash ?? null;

	// Load Intercom script and boot
	useEffect(() => {
		if (!INTERCOM_APP_ID || scriptLoadedRef.current) {
			return;
		}

		// Set up intercom settings
		window.intercomSettings = {
			api_base: "https://api-iam.intercom.io",
			app_id: INTERCOM_APP_ID,
			hide_default_launcher: true,
		};

		// Load the Intercom script
		const script = document.createElement("script");
		script.async = true;
		script.src = `https://widget.intercom.io/widget/${INTERCOM_APP_ID}`;
		script.onload = () => {
			if (window.Intercom) {
				window.Intercom("boot", window.intercomSettings);
			}
		};
		document.body.appendChild(script);
		scriptLoadedRef.current = true;

		return () => {
			// Cleanup on unmount
			if (window.Intercom) {
				window.Intercom("shutdown");
			}
		};
	}, []);

	// Update with user data when available
	useEffect(() => {
		if (!window.Intercom || !session?.user || !userHash) {
			return;
		}

		window.Intercom("update", {
			user_id: session.user.id,
			user_hash: userHash,
			name: session.user.name,
			email: session.user.email,
			created_at: session.user.createdAt
				? Math.floor(new Date(session.user.createdAt).getTime() / 1000)
				: undefined,
		});
	}, [session, userHash]);

	return null;
}
