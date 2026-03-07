"use client";

import {
	IntegrationsIllustration,
	PageEmptyState,
	QuestionBadge,
} from "@/components/dashboard/page-empty-state";
import { PageShell } from "@/components/dashboard/page-shell";
import { CardMenu } from "@/components/integrations/card-menu";
import { ConnectorForm } from "@/components/integrations/connector-form";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { findPresetKey } from "@/components/integrations/connector-icon";
import { ConnectorMenu } from "@/components/integrations/connector-menu";
import { IntegrationActionsSummary } from "@/components/integrations/integration-actions-summary";
import { IntegrationDetailDialog } from "@/components/integrations/integration-detail-dialog";
import { IntegrationPickerDialog } from "@/components/integrations/integration-picker-dialog";
import { ProviderIcon } from "@/components/integrations/provider-icon";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getIntegrationScopeMeta } from "@/config/integration-scopes";
import { CORE_ENTRIES, CORE_PLATFORM_NOTES } from "@/config/integrations";
import { useIntegrationsPage } from "@/hooks/integrations/use-integrations-page";
import { CheckCircle2, Plus, Search } from "lucide-react";

export default function IntegrationsPage() {
	const {
		isAdmin,
		searchQuery,
		setSearchQuery,
		integrationsLoading,
		connectorsLoading,
		slackStatus,
		slackConnectIsPending,
		handleConnect,
		getConnectionStatus,
		getLoadingStatus,
		getConnectedMeta,
		connectedEntries,
		// connectors — available via filteredConnectors
		filteredConnectors,
		editingId,
		setEditingId,
		updateMutationIsPending,
		handleToggle,
		handleSave,
		isSourceEnabled,
		handleToggleSource,
		handleToggleConnectorSource,
		isConnectorEnabled,
		togglePreferenceIsPending,
		pickerOpen,
		setPickerOpen,
		selectedEntry,
		selectedConnectorId,
		selectedDetailTab,
		openedFromPicker,
		handleSelectFromPicker,
		handleSelectFromRow,
		handleSelectConnectorRow,
		handleDetailBack,
		handleDetailOpenChange,
		pickerCatalog,
		disconnectTarget,
		setDisconnectTarget,
		handleConfirmDisconnect,
		getDisconnectDescription,
		handleSetDisconnectTargetForEntry,
		deleteConnectorTarget,
		setDeleteConnectorTarget,
		handleConfirmDeleteConnector,
		slackConfig,
		readyConfigurations,
		handleUpdateSlackConfig,
		showSlackConnectForm,
		setShowSlackConnectForm,
		slackConnectChannelName,
		setSlackConnectChannelName,
		handleCreateSlackConnect,
		handleCancelSlackConnectForm,
		hasConnectedIntegrations,
		handleOpenEntry,
	} = useIntegrationsPage();

	// ---- Loading state ----
	if (integrationsLoading && connectorsLoading) {
		return (
			<PageShell title="Integrations" maxWidth="5xl">
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
			</PageShell>
		);
	}

	return (
		<PageShell
			title="Integrations"
			subtitle={
				<>
					Connect services and tools to extend your agents&apos; capabilities.{" "}
					<a
						href="https://docs.proliferate.com/integrations"
						target="_blank"
						rel="noopener noreferrer"
						className="underline hover:text-foreground transition-colors"
					>
						Learn more
					</a>
				</>
			}
			maxWidth="5xl"
			actions={
				isAdmin ? (
					<Button size="sm" onClick={() => setPickerOpen(true)}>
						<Plus className="h-4 w-4 mr-1.5" />
						Add integration
					</Button>
				) : undefined
			}
		>
			{/* Core integration cards — show unconnected ones only */}
			{isAdmin && CORE_ENTRIES.filter((e) => !getConnectionStatus(e)).length > 0 && (
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
					{CORE_ENTRIES.filter((e) => !getConnectionStatus(e)).map((entry) => (
						<Button
							key={entry.key}
							variant="ghost"
							className="flex flex-col items-start p-4 pb-3 h-auto rounded-2xl border border-border bg-card hover:border-foreground/20 transition-colors text-left"
							onClick={() => handleOpenEntry(entry)}
						>
							<div className="w-7 h-7 rounded-lg border border-border bg-background flex items-center justify-center p-1 shrink-0">
								{entry.provider ? <ProviderIcon provider={entry.provider} size="md" /> : null}
							</div>
							<div className="flex flex-col mt-2 w-full">
								<p className="text-sm font-semibold text-foreground">{entry.name}</p>
								<p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
									{CORE_PLATFORM_NOTES[entry.key] ?? entry.description}
								</p>
								<p className="text-[11px] text-muted-foreground/80 mt-1">
									{
										getIntegrationScopeMeta({
											key: entry.key,
											type: entry.type,
											category: entry.category,
										}).label
									}
								</p>
							</div>
						</Button>
					))}
				</div>
			)}

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
			{(connectedEntries.length > 0 || filteredConnectors.length > 0) && (
				<div>
					{/* Column headers */}
					<div className="flex items-center gap-3 px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
						<div className="flex-1">Name</div>
						{isAdmin && <div className="w-32 hidden sm:block">Status</div>}
						{!isAdmin && (
							<div className="w-16 text-right" title="Controls which tools appear in your sessions">
								My tools
							</div>
						)}
						<div className="w-8" />
					</div>

					{/* Rows */}
					<div className="divide-y divide-border">
						{connectedEntries.map((entry) => {
							const connectedMeta = getConnectedMeta(entry);
							const isLoading = getLoadingStatus(entry);
							const enabled = isSourceEnabled(entry);
							const scopeMeta = getIntegrationScopeMeta({
								key: entry.key,
								type: entry.type,
								category: entry.category,
							});

							return (
								<div
									key={entry.key}
									className="flex items-center gap-3 px-3 py-3 hover:bg-muted/30 transition-colors cursor-pointer rounded-lg"
									onClick={() => isAdmin && handleSelectFromRow(entry)}
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
										<p className="text-[11px] text-muted-foreground/80">{scopeMeta.label}</p>
										<IntegrationActionsSummary
											isOAuth={entry.type === "oauth" || entry.type === "slack"}
											provider={entry.provider ?? null}
											context={isAdmin ? "admin" : "user"}
											onOpenSettings={() => handleSelectFromRow(entry, "settings")}
										/>
									</div>

									{/* Admin: Status */}
									{isAdmin && (
										<div className="w-32 hidden sm:block shrink-0">
											<p className="text-xs text-muted-foreground truncate">
												Connected{connectedMeta ? ` \u00b7 ${connectedMeta}` : ""}
											</p>
										</div>
									)}

									{/* User: My tools toggle */}
									{!isAdmin && (
										<div
											className="w-16 flex justify-end shrink-0"
											onClick={(e) => e.stopPropagation()}
										>
											<Switch
												checked={enabled}
												onCheckedChange={() => handleToggleSource(entry)}
												disabled={togglePreferenceIsPending}
											/>
										</div>
									)}

									{/* Admin: Actions menu */}
									{isAdmin && (
										<div className="shrink-0" onClick={(e) => e.stopPropagation()}>
											<CardMenu
												entry={entry}
												isLoading={isLoading}
												onReconnect={() => handleConnect(entry)}
												onDisconnect={() => handleSetDisconnectTargetForEntry(entry)}
											/>
										</div>
									)}
								</div>
							);
						})}

						{/* MCP connector rows */}
						{filteredConnectors.map((c) => {
							if (isAdmin && editingId === c.id) {
								return (
									<ConnectorForm
										key={c.id}
										initial={c}
										isNew={false}
										onSave={handleSave}
										onCancel={() => setEditingId(null)}
									/>
								);
							}

							const presetKey = findPresetKey(c);

							return (
								<div
									key={c.id}
									className={`flex items-center gap-3 px-3 py-3 hover:bg-muted/30 transition-colors rounded-lg ${!c.enabled && isAdmin ? "opacity-60" : ""} ${isAdmin ? "cursor-pointer" : ""}`}
									onClick={() => isAdmin && handleSelectConnectorRow(c)}
								>
									{/* Icon */}
									<div className="w-10 h-10 rounded-lg border border-border bg-background flex items-center justify-center p-2 shrink-0">
										<ConnectorIcon presetKey={presetKey} size="md" />
									</div>

									{/* Name + URL */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<p className="text-sm font-medium">{c.name}</p>
											{!c.enabled && isAdmin && (
												<span className="text-[11px] text-muted-foreground">Paused</span>
											)}
										</div>
										<p className="text-xs text-muted-foreground truncate">{c.url}</p>
										<IntegrationActionsSummary
											isOAuth={false}
											provider={null}
											connectorId={c.id}
											context={isAdmin ? "admin" : "user"}
											onOpenSettings={() => handleSelectConnectorRow(c, "settings")}
										/>
									</div>

									{/* Admin: Status — inline toggle */}
									{isAdmin && (
										<div className="w-32 hidden sm:flex items-center shrink-0">
											<Switch
												checked={c.enabled}
												onCheckedChange={() => handleToggle(c)}
												disabled={updateMutationIsPending}
											/>
										</div>
									)}

									{/* User: My tools toggle */}
									{!isAdmin && (
										<div className="w-16 flex justify-end shrink-0">
											<Switch
												checked={isConnectorEnabled(c.id)}
												onCheckedChange={() => handleToggleConnectorSource(c.id)}
												disabled={togglePreferenceIsPending || !c.enabled}
												title={!c.enabled ? "Disabled by admin" : undefined}
											/>
										</div>
									)}

									{/* Admin: Actions menu */}
									{isAdmin && (
										<div className="shrink-0">
											<ConnectorMenu
												connector={c}
												onEdit={() => setEditingId(c.id)}
												onToggle={() => handleToggle(c)}
												onDelete={() => setDeleteConnectorTarget(c.id)}
											/>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Slack support channel section (admin only) */}
			{isAdmin && slackStatus?.connected && (
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
									disabled={slackConnectIsPending}
									className="h-8 rounded-l-none text-sm"
								/>
							</div>
							<div className="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={handleCancelSlackConnectForm}
									disabled={slackConnectIsPending}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={handleCreateSlackConnect}
									disabled={slackConnectIsPending || !slackConnectChannelName.trim()}
								>
									{slackConnectIsPending ? "Creating..." : "Create Channel"}
								</Button>
							</div>
						</div>
					) : (
						<Button
							variant="ghost"
							className="flex items-center gap-1.5 h-auto p-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
							onClick={() => setShowSlackConnectForm(true)}
						>
							<Plus className="h-3 w-3" />
							Add Support Channel
						</Button>
					)}
				</div>
			)}

			{/* Empty state (no connected integrations or connectors yet) */}
			{!hasConnectedIntegrations && (
				<PageEmptyState
					illustration={<IntegrationsIllustration />}
					badge={<QuestionBadge />}
					title={isAdmin ? "No integrations configured" : "No integrations available"}
					description={
						isAdmin
							? "Get started by connecting an integration above or browsing the full catalog."
							: "Ask your admin to connect integrations for your organization."
					}
				/>
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

			{/* Connector delete confirmation dialog */}
			<AlertDialog
				open={!!deleteConnectorTarget}
				onOpenChange={(open) => !open && setDeleteConnectorTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete connector?</AlertDialogTitle>
						<AlertDialogDescription>
							This connector will be removed and its tools will no longer be available in sessions.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDeleteConnector}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
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
				connectorId={selectedConnectorId ?? undefined}
				initialTab={selectedDetailTab ?? undefined}
				open={!!selectedEntry}
				onOpenChange={handleDetailOpenChange}
				showBack={openedFromPicker}
				onBack={handleDetailBack}
				isConnected={
					selectedEntry ? (selectedConnectorId ? true : getConnectionStatus(selectedEntry)) : false
				}
				isLoading={selectedEntry ? getLoadingStatus(selectedEntry) : false}
				connectedMeta={selectedEntry ? getConnectedMeta(selectedEntry) : null}
				onConnect={() => selectedEntry && handleConnect(selectedEntry)}
				onDisconnect={() => selectedEntry && handleSetDisconnectTargetForEntry(selectedEntry)}
				onSaveConnector={handleSave}
				slackConfig={slackConfig}
				readyConfigurations={readyConfigurations}
				onUpdateSlackConfig={handleUpdateSlackConfig}
			/>
		</PageShell>
	);
}
