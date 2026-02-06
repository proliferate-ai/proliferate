import { BarChart3, GithubIcon, LinearIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type Provider =
	| "sentry"
	| "linear"
	| "github"
	| "posthog"
	| "gmail"
	| "slack"
	| "webhook"
	| "scheduled";

interface ProviderIconProps {
	provider: Provider;
	className?: string;
	size?: "sm" | "md" | "lg";
}

const sizeClasses = {
	sm: "h-4 w-4",
	md: "h-5 w-5",
	lg: "h-6 w-6",
};

export function ProviderIcon({ provider, className, size = "md" }: ProviderIconProps) {
	const iconClass = cn(sizeClasses[size], className);

	switch (provider) {
		case "github":
			return <GithubIcon className={iconClass} />;

		case "sentry":
			return <SentryIcon className={iconClass} />;

		case "linear":
			return <LinearIcon className={iconClass} />;

		case "posthog":
			return <BarChart3 className={iconClass} />;

		case "slack":
			return <SlackIcon className={iconClass} />;

		case "gmail":
			return (
				<svg
					className={iconClass}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="3" y="5" width="18" height="14" rx="2" />
					<path d="M3 7l9 6 9-6" />
				</svg>
			);

		case "webhook":
			// Webhook icon (link/chain)
			return (
				<svg
					className={iconClass}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
					<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
				</svg>
			);

		case "scheduled":
			// Clock icon for scheduled triggers
			return (
				<svg
					className={iconClass}
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<polyline points="12 6 12 12 16 14" />
				</svg>
			);

		default:
			return null;
	}
}

export function getProviderDisplayName(provider: Provider): string {
	switch (provider) {
		case "github":
			return "GitHub";
		case "sentry":
			return "Sentry";
		case "linear":
			return "Linear";
		case "slack":
			return "Slack";
		case "gmail":
			return "Gmail";
		case "webhook":
			return "Webhook";
		case "scheduled":
			return "Scheduled";
		case "posthog":
			return "PostHog";
		default:
			return provider;
	}
}

export function getProviderManageUrl(provider: Provider): string | null {
	switch (provider) {
		case "github":
			return "https://github.com/settings/installations";
		case "sentry":
			return "https://sentry.io/settings/integrations/";
		case "linear":
			return "https://linear.app/settings/integrations";
		case "slack":
			return "https://slack.com/apps/manage";
		case "gmail":
			return null;
		case "posthog":
			return "https://app.posthog.com";
		case "webhook":
		case "scheduled":
			return null;
		default:
			return null;
	}
}
