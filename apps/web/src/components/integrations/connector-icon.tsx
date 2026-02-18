import {
	Context7Icon,
	FirecrawlIcon,
	NeonIcon,
	PlaywrightIcon,
	PostHogIcon,
	StripeIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { ConnectorConfig } from "@proliferate/shared";
import { CONNECTOR_PRESETS } from "@proliferate/shared";
import { Plug } from "lucide-react";

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
		default:
			return <Plug className={iconClass} />;
	}
}
