"use client";

import { Button } from "@/components/ui/button";
import { type NangoAuthFlow, useNangoConnect } from "@/hooks/use-nango-connect";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

interface IntegrationConnectButtonProps {
	provider: "sentry" | "linear";
	integrationId: string;
	onSuccess?: () => void;
	hasConnection?: boolean;
	/** Render as icon-only reconnect button */
	iconOnly?: boolean;
	/** Custom icon for iconOnly mode */
	icon?: ReactNode;
	/**
	 * Which auth flow to use:
	 * - "connectUI": Opens Nango's managed Connect UI modal (recommended for settings)
	 * - "auth": Opens a headless popup directly to the provider (better for inline/wizard flows)
	 */
	flow?: NangoAuthFlow;
}

export function IntegrationConnectButton({
	provider,
	integrationId,
	onSuccess,
	hasConnection = false,
	iconOnly = false,
	icon,
	flow = "auth", // Default to auth for backwards compatibility in wizards/inline
}: IntegrationConnectButtonProps) {
	const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

	const { connect, isLoading } = useNangoConnect({
		flow,
		onSuccess: () => onSuccess?.(),
	});

	const handleConnect = () => connect(provider);

	if (iconOnly) {
		return (
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 text-muted-foreground hover:text-foreground"
				onClick={handleConnect}
				disabled={isLoading}
			>
				{isLoading ? (
					<RefreshCw className="h-4 w-4 animate-spin" />
				) : (
					icon || <RefreshCw className="h-4 w-4" />
				)}
			</Button>
		);
	}

	return (
		<div>
			<Button onClick={handleConnect} disabled={isLoading} variant="outline" size="sm">
				{isLoading ? "Connecting..." : hasConnection ? `Reconnect ${providerLabel}` : "Connect"}
			</Button>
		</div>
	);
}
