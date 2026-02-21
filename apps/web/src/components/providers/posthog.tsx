"use client";

import { useSession } from "@/lib/auth-client";
import { captureUtms, getUtms } from "@/lib/utm";
import { env } from "@proliferate/environment/public";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { useEffect } from "react";

const POSTHOG_KEY = env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = env.NEXT_PUBLIC_POSTHOG_HOST;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		if (!POSTHOG_KEY) return;

		captureUtms();

		const config = {
			person_profiles: "identified_only",
			capture_pageview: false, // We capture manually for better control
			capture_pageleave: true,
			cookie_domain: ".proliferate.ai",
			session_recording: {
				maskAllInputs: false,
				maskInputOptions: {
					password: true,
				},
			},
		} as const;

		posthog.init(POSTHOG_KEY, {
			...config,
			...(POSTHOG_HOST ? { api_host: POSTHOG_HOST } : {}),
		});
	}, []);

	if (!POSTHOG_KEY) {
		return <>{children}</>;
	}

	return <PHProvider client={posthog}>{children}</PHProvider>;
}

export function PostHogPageView() {
	const posthogClient = usePostHog();

	useEffect(() => {
		if (!posthogClient) return;

		// Capture pageview on route change
		posthogClient.capture("$pageview", {
			$current_url: window.location.href,
		});
	}, [posthogClient]);

	return null;
}

export function PostHogUserIdentity() {
	const { data: session } = useSession();
	const posthogClient = usePostHog();

	useEffect(() => {
		if (!posthogClient || !session?.user) return;

		const utms = getUtms();
		const setOnce = utms
			? {
					initial_utm_source: utms.utm_source,
					initial_utm_medium: utms.utm_medium,
					initial_utm_campaign: utms.utm_campaign,
					initial_utm_term: utms.utm_term,
					initial_utm_content: utms.utm_content,
				}
			: undefined;

		posthogClient.identify(
			session.user.id,
			{
				email: session.user.email,
				name: session.user.name,
			},
			setOnce,
		);
	}, [posthogClient, session?.user]);

	return null;
}
