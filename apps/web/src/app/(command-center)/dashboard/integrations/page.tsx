"use client";

import { ConnectorForm } from "@/components/integrations/connector-form";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { ConnectorRow } from "@/components/integrations/connector-row";
import { IntegrationDetailDialog } from "@/components/integrations/integration-detail-dialog";
import {
	CATEGORY_LABELS,
	type CatalogEntry,
	IntegrationPickerDialog,
} from "@/components/integrations/integration-picker-dialog";
import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
	getProviderManageUrl,
} from "@/components/integrations/provider-icon";
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
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import {
	useIntegrations,
	useSlackConnect,
	useSlackDisconnect,
	useSlackStatus,
} from "@/hooks/use-integrations";
import {
	type NangoProvider,
	getProviderFromIntegrationId,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import {
	useCreateOrgConnector,
	useDeleteOrgConnector,
	useOrgConnectors,
	useUpdateOrgConnector,
} from "@/hooks/use-org-connectors";
import { ACTION_ADAPTERS } from "@/lib/action-adapters";
import { orpc } from "@/lib/orpc";
import { env } from "@proliferate/environment/public";
import { CONNECTOR_PRESETS, type ConnectorConfig } from "@proliferate/shared";
import type { IntegrationWithCreator } from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	ExternalLink,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ====================================================================
// Catalog data
// ====================================================================

const quickPresets = CONNECTOR_PRESETS.filter((p) => p.quickSetup);
const advancedPresets = CONNECTOR_PRESETS.filter((p) => !p.quickSetup);

const INTEGRATION_CATALOG: CatalogEntry[] = [
	// Source Control
	{
		key: "github",
		name: "GitHub",
		description: "Connect your repositories so agents can manage code and open pull requests",
		category: "source-control",
		type: "oauth",
		provider: "github",
	},

	// Monitoring
	{
		key: "sentry",
		name: "Sentry",
		description: "Monitor errors and track performance issues across your applications",
		category: "monitoring",
		type: "oauth",
		provider: "sentry",
	},
	{
		key: "sentry-actions",
		name: "Sentry Actions",
		description: "Query and manage Sentry issues directly from agent sessions",
		category: "monitoring",
		type: "adapter",
		provider: "sentry",
		adapterKey: "sentry",
	},

	// Project Management
	{
		key: "linear",
		name: "Linear",
		description: "Track issues and manage projects with your development team",
		category: "project-management",
		type: "oauth",
		provider: "linear",
	},
	{
		key: "linear-actions",
		name: "Linear Actions",
		description: "Create, update, and manage Linear issues from agent sessions",
		category: "project-management",
		type: "adapter",
		provider: "linear",
		adapterKey: "linear",
	},

	// Communication
	{
		key: "slack",
		name: "Slack",
		description: "Get notifications and interact with your agents from Slack",
		category: "communication",
		type: "slack",
		provider: "slack",
	},

	// Developer Tools (MCP presets)
	...quickPresets.map(
		(p): CatalogEntry => ({
			key: `mcp-${p.key}`,
			name: p.name,
			description: p.description,
			category: "developer-tools",
			type: "mcp-preset",
			presetKey: p.key,
		}),
	),
	...advancedPresets.map(
		(p): CatalogEntry => ({
			key: `mcp-${p.key}`,
			name: p.name,
			description: p.description,
			category: "developer-tools",
			type: "mcp-preset",
			presetKey: p.key,
		}),
	),
];

// Suggestion cards for empty state
const SUGGESTION_ENTRIES = INTEGRATION_CATALOG.filter((e) =>
	["github", "slack", "linear", "sentry"].includes(e.key),
);

// ====================================================================
// Page component
// ====================================================================

export default function IntegrationsPage() {
	const queryClient = useQueryClient();

	// ---- Modal state ----
	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
	const [openedFromPicker, setOpenedFromPicker] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	// ---- OAuth integration state ----
	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider: nangoLoadingProvider,
	} = useNangoConnect({
		flow: "connectUI",
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});

	const {
		connect: githubConnect,
		disconnect: githubDisconnect,
		isLoading: githubLoading,
	} = useGitHubAppConnect({
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		},
	});

	const connectOAuth = useCallback(
		async (provider: Provider) => {
			if (shouldUseNangoForProvider(provider)) {
				await nangoConnect(provider as NangoProvider);
			} else {
				await githubConnect();
			}
		},
		[nangoConnect, githubConnect],
	);

	const disconnectOAuth = async (provider: Provider, integrationId: string) => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoDisconnect(provider as NangoProvider, integrationId);
		} else {
			await githubDisconnect(integrationId);
		}
	};

	const loadingProvider: Provider | null = githubLoading ? "github" : nangoLoadingProvider;

	const { data: integrationsData, isLoading: integrationsLoading } = useIntegrations();
	const { data: slackStatus } = useSlackStatus();
	const slackDisconnect = useSlackDisconnect();
	const slackConnect = useSlackConnect();
	const integrations = integrationsData?.integrations ?? [];

	const OAUTH_PROVIDERS: Provider[] = ["github", "sentry", "linear"];
	const integrationsByProvider = OAUTH_PROVIDERS.reduce(
		(acc, provider) => {
			acc[provider] = integrations.filter((i) => {
				if (!i.integration_id) return false;
				const mappedProvider = getProviderFromIntegrationId(i.integration_id);
				return mappedProvider === provider && i.status === "active";
			});
			return acc;
		},
		{} as Record<Provider, IntegrationWithCreator[]>,
	);

	// ---- Slack handlers ----
	const [showSlackConnectForm, setShowSlackConnectForm] = useState(false);
	const [slackConnectChannelName, setSlackConnectChannelName] = useState("");

	const handleSlackConnect = useCallback(() => {
		window.location.href = `/api/integrations/slack/oauth?returnUrl=${encodeURIComponent("/dashboard/integrations")}`;
	}, []);

	const handleSlackDisconnect = async () => {
		try {
			await slackDisconnect.mutateAsync({});
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		} catch (err) {
			console.error("Failed to disconnect Slack:", err);
		}
	};

	const handleCreateSlackConnect = async () => {
		if (!slackConnectChannelName.trim()) return;
		try {
			await slackConnect.mutateAsync({
				channelName: `proliferate-${slackConnectChannelName.trim()}`,
			});
			setShowSlackConnectForm(false);
			setSlackConnectChannelName("");
		} catch (err) {
			console.error("Failed to create Slack Connect channel:", err);
		}
	};

	// ---- MCP connector state ----
	const [editingId, setEditingId] = useState<string | null>(null);

	const { data: connectors, isLoading: connectorsLoading } = useOrgConnectors();
	const createMutation = useCreateOrgConnector();
	const updateMutation = useUpdateOrgConnector();
	const deleteMutation = useDeleteOrgConnector();

	const integrationsEnabled = env.NEXT_PUBLIC_INTEGRATIONS_ENABLED;

	const handleRemove = useCallback(
		async (id: string) => {
			await deleteMutation.mutateAsync({ id });
		},
		[deleteMutation],
	);

	const handleToggle = useCallback(
		async (connector: ConnectorConfig) => {
			await updateMutation.mutateAsync({
				id: connector.id,
				enabled: !connector.enabled,
			});
		},
		[updateMutation],
	);

	const handleSave = useCallback(
		async (connector: ConnectorConfig, isNew: boolean) => {
			if (isNew) {
				await createMutation.mutateAsync({
					name: connector.name,
					transport: connector.transport,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			} else {
				await updateMutation.mutateAsync({
					id: connector.id,
					name: connector.name,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			}
			setEditingId(null);
		},
		[createMutation, updateMutation],
	);

	// ---- Disconnect confirmation dialog ----
	const [disconnectTarget, setDisconnectTarget] = useState<{
		entry: CatalogEntry;
		integrationId?: string;
	} | null>(null);

	const handleConfirmDisconnect = async () => {
		if (!disconnectTarget) return;
		const { entry, integrationId } = disconnectTarget;

		if (entry.type === "oauth" && entry.provider && integrationId) {
			await disconnectOAuth(entry.provider, integrationId);
		} else if (entry.type === "slack") {
			await handleSlackDisconnect();
		} else if (entry.type === "adapter" && entry.adapterKey) {
			const providerIntegrations = integrationsData?.byProvider[entry.adapterKey] ?? [];
			const active = providerIntegrations.find((i) => i.status === "active");
			if (active) {
				await nangoDisconnect(entry.adapterKey, active.id);
			}
		}
		setDisconnectTarget(null);
	};

	// ---- Connection status helpers ----
	const getConnectionStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return entry.provider ? (integrationsByProvider[entry.provider]?.length ?? 0) > 0 : false;
				case "slack":
					return slackStatus?.connected ?? false;
				case "adapter": {
					if (!entry.adapterKey) return false;
					const providerIntegrations = integrationsData?.byProvider[entry.adapterKey] ?? [];
					return providerIntegrations.some((i) => i.status === "active");
				}
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[integrationsByProvider, slackStatus, integrationsData],
	);

	const getLoadingStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return loadingProvider === entry.provider;
				case "slack":
					return slackDisconnect.isPending;
				case "adapter":
					return nangoLoadingProvider === entry.adapterKey;
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[loadingProvider, slackDisconnect.isPending, nangoLoadingProvider],
	);

	const getConnectedMeta = useCallback(
		(entry: CatalogEntry): string | null => {
			if (entry.type === "oauth" && entry.provider) {
				const providerIntegrations = integrationsByProvider[entry.provider];
				if (providerIntegrations?.length > 0) {
					const first = providerIntegrations[0];
					return first.creator?.name || first.creator?.email || null;
				}
			}
			if (entry.type === "slack" && slackStatus?.connected) {
				return slackStatus.teamName || null;
			}
			return null;
		},
		[integrationsByProvider, slackStatus],
	);

	// ---- Handle connect action ----
	const handleConnect = useCallback(
		(entry: CatalogEntry) => {
			switch (entry.type) {
				case "oauth":
					if (entry.provider) connectOAuth(entry.provider);
					break;
				case "slack":
					handleSlackConnect();
					break;
				case "adapter":
					if (entry.adapterKey) nangoConnect(entry.adapterKey);
					break;
				case "mcp-preset":
					// MCP presets connect through the detail modal form
					break;
			}
		},
		[connectOAuth, handleSlackConnect, nangoConnect],
	);

	// ---- Handle opening detail from picker ----
	const handleSelectFromPicker = useCallback((entry: CatalogEntry) => {
		setPickerOpen(false);
		setSelectedEntry(entry);
		setOpenedFromPicker(true);
	}, []);

	// ---- Handle opening detail from connected row ----
	const handleSelectFromRow = useCallback((entry: CatalogEntry) => {
		setSelectedEntry(entry);
		setOpenedFromPicker(false);
	}, []);

	// ---- Handle detail modal back / close ----
	const handleDetailBack = useCallback(() => {
		setSelectedEntry(null);
		setPickerOpen(true);
	}, []);

	const handleDetailOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				setSelectedEntry(null);
				if (openedFromPicker) {
					setPickerOpen(false);
				}
			}
		},
		[openedFromPicker],
	);

	// ---- Connected integrations list ----
	const connectedEntries = useMemo(() => {
		let entries = INTEGRATION_CATALOG.filter((entry) => {
			if (entry.type === "adapter" && !integrationsEnabled) return false;
			return getConnectionStatus(entry);
		});

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			entries = entries.filter(
				(e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
			);
		}

		return entries;
	}, [getConnectionStatus, integrationsEnabled, searchQuery]);

	// Catalog for the picker (filter adapters if disabled)
	const pickerCatalog = useMemo(() => {
		if (!integrationsEnabled) {
			return INTEGRATION_CATALOG.filter((e) => e.type !== "adapter");
		}
		return INTEGRATION_CATALOG;
	}, [integrationsEnabled]);

	// ---- Loading state ----
	if (integrationsLoading && connectorsLoading) {
		return (
			<div className="mx-auto px-6 py-8 max-w-5xl">
				<div className="flex items-center justify-between mb-6">
					<div className="h-7 w-36 rounded bg-muted animate-pulse" />
					<div className="h-9 w-36 rounded-xl bg-muted animate-pulse" />
				</div>
				<div className="h-9 w-full rounded-xl bg-muted/50 animate-pulse mb-6" />
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="flex items-center gap-3 p-3 rounded-lg border border-border animate-pulse"
						>
							<div className="w-8 h-8 rounded-lg bg-muted" />
							<div className="flex-1 space-y-1.5">
								<div className="h-4 w-28 rounded bg-muted" />
								<div className="h-3 w-48 rounded bg-muted/50" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	const connectorList = connectors ?? [];
	const hasConnectedIntegrations = connectedEntries.length > 0 || connectorList.length > 0;

	const getDisconnectDescription = (entry: CatalogEntry) => {
		if (entry.provider === "github") {
			return "Repos using this connection will be marked as orphaned until reconnected.";
		}
		const name = entry.name;
		return `Triggers and automations using this ${name} connection will stop working.`;
	};

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="mx-auto px-6 py-6 max-w-5xl">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-xl font-semibold tracking-tight text-foreground">Integrations</h1>
					<Button size="sm" className="rounded-xl" onClick={() => setPickerOpen(true)}>
						<Plus className="h-4 w-4 mr-1.5" />
						Add integration
					</Button>
				</div>

				{/* Search (only when there are connected integrations) */}
				{hasConnectedIntegrations && (
					<div className="relative mb-6">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search connected integrations..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="h-9 pl-9 text-sm rounded-xl"
						/>
					</div>
				)}

				{/* Connected integrations table */}
				{connectedEntries.length > 0 && (
					<div>
						{/* Column headers */}
						<div className="flex items-center gap-3 px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
							<div className="flex-1">Name</div>
							<div className="w-32 hidden sm:block">Connected by</div>
							<div className="w-8" />
						</div>

						{/* Rows */}
						<div className="divide-y divide-border">
							{connectedEntries.map((entry) => {
								const connectedMeta = getConnectedMeta(entry);
								const isLoading = getLoadingStatus(entry);

								return (
									<div
										key={entry.key}
										className="flex items-center gap-3 px-3 py-3 hover:bg-muted/30 transition-colors cursor-pointer rounded-lg"
										onClick={() => handleSelectFromRow(entry)}
									>
										{/* Icon */}
										<div className="w-10 h-10 rounded-lg border border-border bg-background flex items-center justify-center p-2 shrink-0">
											{entry.type === "mcp-preset" && entry.presetKey ? (
												<ConnectorIcon presetKey={entry.presetKey} size="md" />
											) : entry.provider ? (
												<ProviderIcon provider={entry.provider} size="md" />
											) : null}
										</div>

										{/* Name + description */}
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium">{entry.name}</p>
											<p className="text-xs text-muted-foreground truncate">{entry.description}</p>
										</div>

										{/* Connected by */}
										<div className="w-32 hidden sm:block shrink-0">
											<p className="text-sm text-muted-foreground truncate">
												{connectedMeta || "\u2014"}
											</p>
										</div>

										{/* Actions */}
										<div className="shrink-0" onClick={(e) => e.stopPropagation()}>
											<CardMenu
												entry={entry}
												isLoading={isLoading}
												onReconnect={() => handleConnect(entry)}
												onDisconnect={() =>
													setDisconnectTarget({
														entry,
														integrationId:
															entry.type === "oauth" && entry.provider
																? integrationsByProvider[entry.provider]?.[0]?.id
																: undefined,
													})
												}
											/>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* Slack support channel section */}
				{slackStatus?.connected && (
					<div className="mt-3 ml-1">
						{slackStatus.supportChannel ? (
							<div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
								<CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
								<span className="text-xs text-muted-foreground">
									Support channel: #{slackStatus.supportChannel.channelName}
								</span>
							</div>
						) : showSlackConnectForm ? (
							<div className="p-4 rounded-lg border border-border bg-card space-y-3">
								<p className="text-sm font-medium">Create Support Channel</p>
								<p className="text-xs text-muted-foreground">
									Get a dedicated Slack Connect channel for support from our team.
								</p>
								<div className="flex items-center gap-0">
									<span className="bg-muted px-3 h-8 flex items-center text-xs text-muted-foreground border border-r-0 border-input rounded-l-md">
										proliferate-
									</span>
									<Input
										placeholder="your-company"
										value={slackConnectChannelName}
										onChange={(e) =>
											setSlackConnectChannelName(
												e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
											)
										}
										disabled={slackConnect.isPending}
										className="h-8 rounded-l-none text-sm"
									/>
								</div>
								<div className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setShowSlackConnectForm(false);
											setSlackConnectChannelName("");
										}}
										disabled={slackConnect.isPending}
									>
										Cancel
									</Button>
									<Button
										size="sm"
										onClick={handleCreateSlackConnect}
										disabled={slackConnect.isPending || !slackConnectChannelName.trim()}
									>
										{slackConnect.isPending ? "Creating..." : "Create Channel"}
									</Button>
								</div>
							</div>
						) : (
							<button
								type="button"
								className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
								onClick={() => setShowSlackConnectForm(true)}
							>
								<Plus className="h-3 w-3" />
								Add Support Channel
							</button>
						)}
					</div>
				)}

				{/* Connected Tools (MCP connectors) */}
				{connectorList.length > 0 && (
					<section className="mt-6">
						<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
							Connected Tools
						</h2>
						<div className="rounded-lg border border-border bg-card">
							<div className="divide-y divide-border">
								{connectorList.map((c) =>
									editingId === c.id ? (
										<ConnectorForm
											key={c.id}
											initial={c}
											isNew={false}
											onSave={handleSave}
											onCancel={() => setEditingId(null)}
										/>
									) : (
										<ConnectorRow
											key={c.id}
											connector={c}
											onEdit={() => setEditingId(c.id)}
											onRemove={() => handleRemove(c.id)}
											onToggle={() => handleToggle(c)}
										/>
									),
								)}
							</div>
						</div>
					</section>
				)}

				{/* Empty state */}
				{!hasConnectedIntegrations && (
					<div className="flex flex-col items-center justify-center py-12 gap-12">
						{/* Illustration + heading */}
						<div className="flex flex-col items-center justify-center gap-2">
							<div className="relative flex flex-col items-center">
								{/* Globe illustration */}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="66"
									height="66"
									viewBox="0 0 66 66"
									fill="none"
									className="w-16 h-16"
								>
									<path
										fillRule="evenodd"
										clipRule="evenodd"
										d="M1 33C1 50.673 15.327 65 33 65C50.673 65 65 50.673 65 33C65 15.327 50.673 1 33 1C15.327 1 1 15.327 1 33ZM21.453 9.597C23.135 9.057 24.864 8.502 26.984 7.601C34.253 4.509 40.353 2.922 43.778 5.094C45.506 6.19 46.405 7.775 47.612 9.902C48.797 11.992 50.279 14.606 53.136 17.794C54.274 19.064 55.389 20.22 56.437 21.306C60.701 25.726 63.865 29.006 62.995 34.17C62.297 38.316 59.979 40.456 57.604 42.65C55.432 44.656 53.211 46.707 52.133 50.379C49.877 58.065 45.533 62.911 40.353 63.747C35.173 64.582 28.656 66.17 21.804 61.157C18.195 58.516 17.229 55.318 16.195 51.894C15.266 48.818 14.281 45.56 11.277 42.358C6.162 36.906 2.253 20.635 11.277 14.034C15.736 11.433 18.522 10.538 21.453 9.597Z"
										className="fill-muted stroke-border"
									/>
									<path
										d="M35.5 64.421C32.439 64.421 27.004 62.103 29.556 47.47C32.143 32.637 34.658 31.577 36.699 16.744C38.332 4.877 33.164 -0.12 25 1.999"
										className="stroke-border"
										fill="none"
									/>
									<path
										d="M13.936 59.199C13.355 57.512 13.038 51.923 20.137 44.345C29.011 34.872 32.5 34.958 43.491 22.748C51.569 13.775 51.172 8.052 50.099 6.463"
										className="stroke-border"
										fill="none"
									/>
									<path
										d="M1.268 33.161C2.4 34.534 7.695 37.385 17.766 35.393C30.355 32.902 44.434 31.307 49.694 32.029C62.352 33.765 63.414 42.304 63.414 42.304"
										className="stroke-border"
										fill="none"
									/>
									<path
										d="M14 7.492C10.815 12.85 11.645 17.059 19.994 23.083C30.431 30.612 42.299 39.83 45.502 44.103C50.668 50.991 51.5 58.928 51.5 58.928"
										className="stroke-border"
										fill="none"
									/>
									<rect
										x="1.261"
										y="1"
										width="63.713"
										height="63.713"
										rx="31.856"
										className="stroke-border"
										fill="none"
									/>
								</svg>
								<div className="bg-border w-4 h-4 mt-1 mx-auto rounded-full" />
								{/* Question mark badge */}
								<svg
									width="20"
									height="20"
									viewBox="0 0 20 20"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									className="absolute -right-1 -top-1 w-6 h-6"
								>
									<path
										d="M10 18.333C14.602 18.333 18.333 14.602 18.333 10C18.333 5.398 14.602 1.667 10 1.667C5.398 1.667 1.667 5.398 1.667 10C1.667 14.602 5.398 18.333 10 18.333Z"
										className="stroke-foreground"
										strokeLinecap="round"
										strokeLinejoin="round"
										fill="none"
									/>
									<path
										d="M7.575 7.5C7.771 6.943 8.158 6.473 8.667 6.174C9.176 5.875 9.774 5.766 10.356 5.866C10.938 5.965 11.466 6.268 11.846 6.72C12.226 7.171 12.434 7.743 12.434 8.333C12.434 10 9.934 10.833 9.934 10.833"
										className="stroke-foreground"
										strokeLinecap="round"
										strokeLinejoin="round"
										fill="none"
									/>
									<path
										d="M10 14.167H10.008"
										className="stroke-foreground"
										strokeLinecap="round"
										strokeLinejoin="round"
										fill="none"
									/>
								</svg>
							</div>
							<h2 className="text-lg font-semibold text-foreground">No integrations configured</h2>
							<p className="text-sm text-muted-foreground">
								Browse our library of integrations to extend your agents' capabilities.
							</p>
						</div>

						{/* Suggestion cards */}
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl">
							{SUGGESTION_ENTRIES.map((entry) => (
								<button
									key={entry.key}
									type="button"
									className="flex flex-col items-start p-4 pb-3 rounded-2xl border border-border bg-card hover:border-foreground/20 transition-colors text-left"
									onClick={() => {
										setSelectedEntry(entry);
										setOpenedFromPicker(false);
									}}
								>
									<div className="w-7 h-7 rounded-lg border border-border bg-background flex items-center justify-center p-1 shrink-0">
										{entry.provider ? <ProviderIcon provider={entry.provider} size="md" /> : null}
									</div>
									<div className="flex flex-col mt-2 w-full">
										<p className="text-sm font-semibold text-foreground">{entry.name}</p>
										<p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
											{entry.description}
										</p>
									</div>
								</button>
							))}
						</div>
					</div>
				)}

				{/* Disconnect confirmation dialog */}
				<AlertDialog
					open={!!disconnectTarget}
					onOpenChange={(open) => !open && setDisconnectTarget(null)}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Disconnect {disconnectTarget?.entry.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								{disconnectTarget ? getDisconnectDescription(disconnectTarget.entry) : ""}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleConfirmDisconnect}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							>
								Disconnect
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{/* Picker modal */}
				<IntegrationPickerDialog
					open={pickerOpen}
					onOpenChange={setPickerOpen}
					catalog={pickerCatalog}
					onSelectEntry={handleSelectFromPicker}
					getConnectionStatus={getConnectionStatus}
				/>

				{/* Detail modal */}
				<IntegrationDetailDialog
					entry={selectedEntry}
					open={!!selectedEntry}
					onOpenChange={handleDetailOpenChange}
					showBack={openedFromPicker}
					onBack={handleDetailBack}
					isConnected={selectedEntry ? getConnectionStatus(selectedEntry) : false}
					isLoading={selectedEntry ? getLoadingStatus(selectedEntry) : false}
					connectedMeta={selectedEntry ? getConnectedMeta(selectedEntry) : null}
					onConnect={() => selectedEntry && handleConnect(selectedEntry)}
					onDisconnect={() => {
						if (!selectedEntry) return;
						setDisconnectTarget({
							entry: selectedEntry,
							integrationId:
								selectedEntry.type === "oauth" && selectedEntry.provider
									? integrationsByProvider[selectedEntry.provider]?.[0]?.id
									: undefined,
						});
					}}
					onSaveConnector={handleSave}
				/>
			</div>
		</div>
	);
}

// ====================================================================
// Card dropdown menu
// ====================================================================

function CardMenu({
	entry,
	isLoading,
	onReconnect,
	onDisconnect,
}: {
	entry: CatalogEntry;
	isLoading: boolean;
	onReconnect: () => void;
	onDisconnect: () => void;
}) {
	const manageUrl = entry.provider ? getProviderManageUrl(entry.provider) : null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{/* Manage on provider */}
				{manageUrl && (
					<DropdownMenuItem asChild>
						<a
							href={manageUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Manage on {getProviderDisplayName(entry.provider!)}
						</a>
					</DropdownMenuItem>
				)}

				{/* Reconnect (OAuth / Slack) */}
				{(entry.type === "oauth" || entry.type === "slack") && (
					<DropdownMenuItem
						onClick={onReconnect}
						disabled={isLoading}
						className="flex items-center gap-2"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						Reconnect
					</DropdownMenuItem>
				)}

				<DropdownMenuSeparator />

				{/* Disconnect */}
				<DropdownMenuItem
					onClick={onDisconnect}
					className="flex items-center gap-2 text-destructive focus:text-destructive"
				>
					<X className="h-3.5 w-3.5" />
					Disconnect
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
