import { GithubIcon, LinearIcon, PostHogIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { env } from "@proliferate/environment/public";
import type { ComponentType, SVGProps } from "react";

export const REQUIRE_EMAIL_VERIFICATION = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

export const AUTH_INTEGRATIONS: { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] =
	[
		{ icon: GithubIcon, label: "GitHub" },
		{ icon: SlackIcon, label: "Slack" },
		{ icon: LinearIcon, label: "Linear" },
		{ icon: SentryIcon, label: "Sentry" },
		{ icon: PostHogIcon, label: "PostHog" },
	];
