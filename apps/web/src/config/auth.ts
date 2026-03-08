import { GithubIcon, LinearIcon, PostHogIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { env } from "@proliferate/environment/public";
import type { CSSProperties, ComponentType, SVGProps } from "react";

export const REQUIRE_EMAIL_VERIFICATION = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

export const AUTH_INTEGRATIONS: { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] =
	[
		{ icon: GithubIcon, label: "GitHub" },
		{ icon: SlackIcon, label: "Slack" },
		{ icon: LinearIcon, label: "Linear" },
		{ icon: SentryIcon, label: "Sentry" },
		{ icon: PostHogIcon, label: "PostHog" },
	];

/**
 * Force dark-mode CSS custom properties so all shadcn components
 * inside the auth page render in dark mode regardless of theme.
 */
export const darkModeVars: CSSProperties = {
	"--background": "0 0% 4%",
	"--foreground": "0 0% 98%",
	"--card": "0 0% 6%",
	"--card-foreground": "0 0% 98%",
	"--popover": "0 0% 6%",
	"--popover-foreground": "0 0% 98%",
	"--primary": "0 0% 98%",
	"--primary-foreground": "0 0% 0%",
	"--secondary": "0 0% 12%",
	"--secondary-foreground": "0 0% 98%",
	"--muted": "0 0% 12%",
	"--muted-foreground": "0 0% 55%",
	"--accent": "0 0% 15%",
	"--accent-foreground": "0 0% 98%",
	"--border": "0 0% 15%",
	"--input": "0 0% 15%",
	"--ring": "0 0% 100%",
	"--destructive": "0 63% 31%",
	"--destructive-foreground": "0 0% 98%",
} as CSSProperties;
