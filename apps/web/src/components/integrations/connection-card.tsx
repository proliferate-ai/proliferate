"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertTriangle, ExternalLink, Eye, EyeOff, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
	getProviderManageUrl,
} from "./provider-icon";

type ConnectionCardVariant = "settings" | "trigger-card" | "inline";
type Visibility = "org" | "private";

interface ConnectionCardProps {
	provider: Provider;
	variant?: ConnectionCardVariant;
	// Connection state
	isConnected: boolean;
	connectedByName?: string | null;
	connectedByEmail?: string | null;
	visibility?: Visibility;
	integrationId?: string;
	// Callbacks
	onConnect?: () => void;
	onReconnect?: () => void;
	onDisconnect?: () => void;
	onChangeVisibility?: (visibility: Visibility) => void;
	// State
	isLoading?: boolean;
	disabled?: boolean;
	// For broken trigger state
	isBroken?: boolean;
}

export function ConnectionCard({
	provider,
	variant = "settings",
	isConnected,
	connectedByName,
	connectedByEmail,
	visibility = "org",
	integrationId,
	onConnect,
	onReconnect,
	onDisconnect,
	onChangeVisibility,
	isLoading = false,
	disabled = false,
	isBroken = false,
}: ConnectionCardProps) {
	const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
	const providerName = getProviderDisplayName(provider);
	const manageUrl = getProviderManageUrl(provider);

	const connectedByText = connectedByName || connectedByEmail || "Unknown";

	// Settings variant - full card with all actions
	if (variant === "settings") {
		return (
			<>
				<div className="flex items-center justify-between p-4 border border-border rounded-lg">
					<div className="flex items-center gap-3">
						<div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
							<ProviderIcon provider={provider} size="md" />
						</div>
						<div>
							<div className="flex items-center gap-2">
								<p className="font-medium">{providerName}</p>
								{isConnected && visibility === "private" && (
									<Badge variant="outline" className="text-xs">
										Private
									</Badge>
								)}
							</div>
							<p
								className={cn("text-sm", isConnected ? "text-green-500" : "text-muted-foreground")}
							>
								{isConnected ? `Connected by ${connectedByText}` : "Not connected"}
							</p>
						</div>
					</div>

					{isConnected ? (
						<TooltipProvider delayDuration={0}>
							<div className="flex items-center gap-1">
								{/* Visibility toggle */}
								{onChangeVisibility && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-foreground"
												onClick={() => onChangeVisibility(visibility === "org" ? "private" : "org")}
											>
												{visibility === "org" ? (
													<Eye className="h-4 w-4" />
												) : (
													<EyeOff className="h-4 w-4" />
												)}
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<p>{visibility === "org" ? "Shared with org" : "Private to you"}</p>
										</TooltipContent>
									</Tooltip>
								)}

								{/* Manage on provider - only show if there's a manage URL */}
								{manageUrl && (
									<Tooltip>
										<TooltipTrigger asChild>
											<a
												href={manageUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
											>
												<ExternalLink className="h-4 w-4" />
											</a>
										</TooltipTrigger>
										<TooltipContent>
											<p>Manage on {providerName}</p>
										</TooltipContent>
									</Tooltip>
								)}

								{/* Reconnect */}
								{onReconnect && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-foreground"
												onClick={onReconnect}
												disabled={isLoading}
											>
												<RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<p>Reconnect</p>
										</TooltipContent>
									</Tooltip>
								)}

								{/* Disconnect */}
								{onDisconnect && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-destructive"
												onClick={() => setShowDisconnectDialog(true)}
												disabled={isLoading}
											>
												<X className="h-4 w-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<p>Disconnect</p>
										</TooltipContent>
									</Tooltip>
								)}
							</div>
						</TooltipProvider>
					) : (
						<Button
							variant="outline"
							size="sm"
							onClick={onConnect}
							disabled={disabled || isLoading}
						>
							{isLoading ? "Connecting..." : `Connect ${providerName}`}
						</Button>
					)}
				</div>

				{/* Disconnect confirmation dialog */}
				<AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Disconnect {providerName}?</AlertDialogTitle>
							<AlertDialogDescription>
								{provider === "github"
									? "Repos using this connection will be marked as orphaned until reconnected."
									: `Triggers using this ${providerName} connection will stop working.`}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									onDisconnect?.();
									setShowDisconnectDialog(false);
								}}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							>
								Disconnect
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		);
	}

	// Trigger-card variant - compact display for trigger cards
	if (variant === "trigger-card") {
		if (isBroken) {
			return (
				<div className="space-y-2">
					<div className="flex items-center gap-2 text-sm text-destructive">
						<AlertTriangle className="h-4 w-4" />
						<span>{providerName} connection missing</span>
					</div>
					{onReconnect && (
						<Button
							variant="outline"
							size="sm"
							onClick={onReconnect}
							disabled={isLoading}
							className="w-full"
						>
							{isLoading ? "Connecting..." : `Reconnect ${providerName}`}
						</Button>
					)}
				</div>
			);
		}

		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<ProviderIcon provider={provider} size="sm" />
				<span>
					{providerName}
					{isConnected && connectedByText && (
						<span className="ml-1">· Connected by {connectedByText}</span>
					)}
				</span>
			</div>
		);
	}

	// Inline variant - for wizard blocking state
	if (variant === "inline") {
		if (!isConnected) {
			return (
				<div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
					<AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium">{providerName} not connected</p>
						<p className="text-xs text-muted-foreground">
							Connect {providerName} to use this trigger type
						</p>
					</div>
					<Button variant="default" size="sm" onClick={onConnect} disabled={disabled || isLoading}>
						{isLoading ? "Connecting..." : "Connect"}
					</Button>
				</div>
			);
		}

		return (
			<div className="flex items-center gap-2 text-sm text-green-500">
				<ProviderIcon provider={provider} size="sm" />
				<span>Connected by {connectedByText}</span>
			</div>
		);
	}

	return null;
}
