import {
	ApifyIcon,
	AsanaIcon,
	Context7Icon,
	DeepWikiIcon,
	FirecrawlIcon,
	GmailIcon,
	GoogleCalendarIcon,
	GoogleDriveIcon,
	HubSpotIcon,
	McpIcon,
	NeonIcon,
	NewRelicIcon,
	NotionIcon,
	PlaywrightIcon,
	PostHogIcon,
	SalesforceIcon,
	SemgrepIcon,
	StripeIcon,
	SupabaseIcon,
	ZapierIcon,
} from "@/components/ui/icons";
import { ICON_SIZE_CLASSES } from "@/config/icons";
import { cn } from "@/lib/display/utils";
import type { ConnectorConfig } from "@proliferate/shared";
import { CONNECTOR_PRESETS } from "@proliferate/shared";

/** Best-effort preset key lookup for a connected tool (matches by composioToolkit or URL). */
export function findPresetKey(connector: ConnectorConfig): string {
	if (connector.composioToolkit) {
		const match = CONNECTOR_PRESETS.find((p) => p.composioToolkit === connector.composioToolkit);
		if (match) return match.key;
	}
	const match = CONNECTOR_PRESETS.find((p) => p.defaults.url && connector.url === p.defaults.url);
	return match?.key ?? "custom";
}

interface ConnectorIconProps {
	presetKey: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

export function ConnectorIcon({ presetKey, className, size = "md" }: ConnectorIconProps) {
	const iconClass = cn(ICON_SIZE_CLASSES[size], className);

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
		case "newrelic":
			return <NewRelicIcon className={iconClass} />;
		case "apify":
			return <ApifyIcon className={iconClass} />;
		case "gmail":
			return <GmailIcon className={iconClass} />;
		case "notion":
			return <NotionIcon className={iconClass} />;
		case "salesforce":
			return <SalesforceIcon className={iconClass} />;
		case "google-calendar":
			return <GoogleCalendarIcon className={iconClass} />;
		case "google-drive":
			return <GoogleDriveIcon className={iconClass} />;
		case "hubspot":
			return <HubSpotIcon className={iconClass} />;
		default:
			return <McpIcon className={iconClass} />;
	}
}
