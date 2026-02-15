"use client";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { useIntegrations, useUpdateIntegration } from "@/hooks/use-integrations";
import {
	NANGO_INTEGRATION_IDS,
	type NangoManagedProvider,
	type NangoProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { IntegrationWithCreator } from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Laptop, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Provider, ProviderIcon, getProviderDisplayName } from "./provider-icon";

type Integration = IntegrationWithCreator;

export interface ConnectionSelectorProps {
	/** Which provider to show connections for */
	provider: "github" | "linear" | "sentry" | "gmail";
	/** Currently selected integration ID */
	selectedId: string | null;
	/** Called when user selects a connection */
	onSelect: (integrationId: string) => void;
	/** Called after a new connection is successfully added */
	onConnectSuccess?: () => void;
	/** Auto-select when there's only one connection */
	autoSelectSingle?: boolean;
	/** Show "Use local git credentials" option (for CLI flow) */
	showLocalGitOption?: boolean;
	/** Called when user selects local git credentials */
	onSelectLocalGit?: () => void;
	/** URL to redirect back to after OAuth */
	returnUrl?: string;
	/** Optional label override */
	label?: string;
}

/**
 * Reusable connection selector component for GitHub, Linear, and Sentry integrations.
 * Extracted from TriggerConfigForm to be reusable across different contexts.
 */
export function ConnectionSelector({
	provider,
	selectedId,
	onSelect,
	onConnectSuccess,
	autoSelectSingle = true,
	showLocalGitOption = false,
	onSelectLocalGit,
	returnUrl,
	label = "Connection",
}: ConnectionSelectorProps) {
	const queryClient = useQueryClient();

	// Renaming state
	const [renamingConnectionId, setRenamingConnectionId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	// Nango connection hook for Linear/Sentry
	const { connect: nangoConnect, loadingProvider: nangoLoadingProvider } = useNangoConnect({
		flow: "connectUI",
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
			onConnectSuccess?.();
		},
	});

	// GitHub App connection hook
	const { connect: githubConnect, isLoading: githubLoading } = useGitHubAppConnect({
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
			onConnectSuccess?.();
		},
		returnUrl,
	});

	// Combined loading state
	const loadingProvider: Provider | null = githubLoading ? "github" : nangoLoadingProvider;

	// Fetch integrations
	const { data: integrationsData } = useIntegrations();

	// Get connections for selected provider
	const providerConnections = useMemo(() => {
		if (!integrationsData?.integrations) return [];

		// GitHub uses GitHub App, Linear/Sentry use Nango
		if (provider === "github") {
			return integrationsData.integrations.filter(
				(i) => i.integration_id === "github-app" && i.status === "active",
			);
		}

		const nangoIntegrationId = NANGO_INTEGRATION_IDS[provider as NangoManagedProvider];
		return integrationsData.integrations.filter(
			(i) => i.integration_id === nangoIntegrationId && i.status === "active",
		);
	}, [integrationsData?.integrations, provider]);

	// Auto-select first connection
	useEffect(() => {
		if (autoSelectSingle && providerConnections.length === 1 && !selectedId) {
			onSelect(providerConnections[0].id);
		}
	}, [providerConnections, selectedId, autoSelectSingle, onSelect]);

	// Rename connection mutation
	const updateIntegration = useUpdateIntegration();
	const renameMutation = {
		mutate: ({ connectionId, displayName }: { connectionId: string; displayName: string }) => {
			updateIntegration.mutate(
				{ id: connectionId, displayName },
				{
					onSuccess: () => {
						setRenamingConnectionId(null);
						setRenameValue("");
					},
				},
			);
		},
		isPending: updateIntegration.isPending,
	};

	// Format date helper
	const formatConnectionDate = (dateString: string | null | undefined) => {
		if (!dateString) return "";
		const date = new Date(dateString);
		return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
	};

	const handleConnect = () => {
		if (provider === "github") {
			githubConnect();
		} else {
			nangoConnect(provider as NangoProvider);
		}
	};

	const handleReconnect = (e: React.MouseEvent) => {
		e.stopPropagation();
		handleConnect();
	};

	const isConnected = providerConnections.length > 0;
	const selectedConnection = providerConnections.find((c) => c.id === selectedId);

	// If renaming a connection
	if (renamingConnectionId) {
		return (
			<div className="space-y-2">
				<Input
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					placeholder="Connection name"
					className="h-9"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter" && renameValue.trim()) {
							renameMutation.mutate({
								connectionId: renamingConnectionId,
								displayName: renameValue.trim(),
							});
						} else if (e.key === "Escape") {
							setRenamingConnectionId(null);
							setRenameValue("");
						}
					}}
				/>
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="ghost"
						className="flex-1"
						onClick={() => {
							setRenamingConnectionId(null);
							setRenameValue("");
						}}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						className="flex-1"
						disabled={!renameValue.trim() || renameMutation.isPending}
						onClick={() =>
							renameMutation.mutate({
								connectionId: renamingConnectionId,
								displayName: renameValue.trim(),
							})
						}
					>
						{renameMutation.isPending ? "Saving..." : "Save"}
					</Button>
				</div>
			</div>
		);
	}

	// If no connections exist
	if (!isConnected) {
		return (
			<div className="space-y-2">
				<div className="flex items-center gap-2 p-2 rounded border border-dashed border-border bg-muted/30">
					<span className="text-sm text-muted-foreground">No connections available</span>
				</div>
				<Button
					onClick={handleConnect}
					disabled={loadingProvider === provider}
					size="sm"
					variant="outline"
					className="w-full"
				>
					<Plus className="h-4 w-4 mr-2" />
					{loadingProvider === provider
						? "Connecting..."
						: `Add ${getProviderDisplayName(provider)} connection`}
				</Button>
				{showLocalGitOption && (
					<Button onClick={onSelectLocalGit} size="sm" variant="ghost" className="w-full">
						<Laptop className="h-4 w-4 mr-2" />
						Use local git credentials
					</Button>
				)}
			</div>
		);
	}

	// Connection selector dropdown
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="w-full h-auto py-2 justify-between font-normal">
					{(() => {
						const displayConn = selectedConnection || providerConnections[0];
						const connCreatorName =
							displayConn?.creator?.name || displayConn?.creator?.email?.split("@")[0] || "Unknown";
						const connDate = displayConn?.created_at
							? formatConnectionDate(displayConn.created_at)
							: "";
						return (
							<div className="flex items-center gap-2">
								<ProviderIcon provider={provider} className="h-4 w-4 shrink-0" />
								<div className="flex flex-col items-start min-w-0">
									<span className="truncate">
										{displayConn?.display_name || `Select ${label.toLowerCase()}`}
									</span>
									{displayConn && (
										<span className="text-xs text-muted-foreground truncate">
											{connCreatorName} · {connDate}
										</span>
									)}
								</div>
							</div>
						);
					})()}
					<ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]" align="start">
				{providerConnections.map((conn) => {
					const isSelected =
						conn.id === selectedId || (providerConnections.length === 1 && !selectedId);
					const creatorName = conn.creator?.name || conn.creator?.email?.split("@")[0] || "Unknown";
					const connDate = formatConnectionDate(conn.created_at);
					return (
						<DropdownMenuItem
							key={conn.id}
							onClick={() => onSelect(conn.id)}
							className="flex items-center justify-between gap-2"
						>
							<div className="flex items-center gap-2">
								{isSelected ? (
									<Check className="h-4 w-4 text-primary shrink-0" />
								) : (
									<ProviderIcon provider={provider} className="h-4 w-4 shrink-0" />
								)}
								<div className="flex flex-col min-w-0">
									<span className="truncate">{conn.display_name || conn.connection_id}</span>
									<span className="text-xs text-muted-foreground truncate">
										{creatorName} · {connDate}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-1 shrink-0">
								<IconAction
									icon={<Pencil className="h-3 w-3" />}
									onClick={(e) => {
										e.stopPropagation();
										setRenameValue(conn.display_name || conn.connection_id || "");
										setRenamingConnectionId(conn.id);
									}}
									tooltip="Rename"
									size="xs"
								/>
								<IconAction
									icon={
										<RefreshCw
											className={cn("h-3 w-3", loadingProvider === provider && "animate-spin")}
										/>
									}
									onClick={handleReconnect}
									tooltip="Reconnect"
									size="xs"
								/>
							</div>
						</DropdownMenuItem>
					);
				})}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={handleConnect}
					disabled={loadingProvider === provider}
					className="flex items-center gap-2"
				>
					<Plus className="h-4 w-4" />
					<span>Add new connection</span>
				</DropdownMenuItem>
				{showLocalGitOption && (
					<DropdownMenuItem onClick={onSelectLocalGit} className="flex items-center gap-2">
						<Laptop className="h-4 w-4" />
						<span>Use local git credentials</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
