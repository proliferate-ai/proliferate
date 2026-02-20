import {
	ApifyIcon,
	AsanaIcon,
	Context7Icon,
	DeepWikiIcon,
	FirecrawlIcon,
	McpIcon,
	NeonIcon,
	PlaywrightIcon,
	PostHogIcon,
	SemgrepIcon,
	StripeIcon,
	SupabaseIcon,
	ZapierIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { ConnectorConfig } from "@proliferate/shared";
import { CONNECTOR_PRESETS } from "@proliferate/shared";

/** Best-effort preset key lookup for a connected tool (matches by URL). */
export function findPresetKey(connector: ConnectorConfig): string {
	const match = CONNECTOR_PRESETS.find((p) => p.defaults.url && connector.url === p.defaults.url);
	return match?.key ?? "custom";
}

interface ConnectorIconProps {
	presetKey: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

const sizeClasses = {
	sm: "h-4 w-4",
	md: "h-5 w-5",
	lg: "h-6 w-6",
};

export function ConnectorIcon({ presetKey, className, size = "md" }: ConnectorIconProps) {
	const iconClass = cn(sizeClasses[size], className);

	switch (presetKey) {
		case "context7":
			return <Context7Icon className={iconClass} />;
		case "posthog":
			return <PostHogIcon className={iconClass} />;
		case "firecrawl":
			return <FirecrawlIcon className={iconClass} />;
		case "neon":
			return <NeonIcon className={iconClass} />;
		case "stripe":
			return <StripeIcon className={iconClass} />;
		case "playwright":
			return <PlaywrightIcon className={iconClass} />;
		case "zapier":
			return <ZapierIcon className={iconClass} />;
		case "supabase":
			return <SupabaseIcon className={iconClass} />;
		case "asana":
			return <AsanaIcon className={iconClass} />;
		case "semgrep":
			return <SemgrepIcon className={iconClass} />;
		case "deepwiki":
			return <DeepWikiIcon className={iconClass} />;
		case "apify":
			return <ApifyIcon className={iconClass} />;
		default:
			return <McpIcon className={iconClass} />;
	}
}
