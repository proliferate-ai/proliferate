"use client";

import { ConnectorForm } from "@/components/integrations/connector-form";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import { CATEGORY_LABELS } from "@/components/integrations/integration-picker-dialog";
import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
	getProviderManageUrl,
} from "@/components/integrations/provider-icon";
import { QuickSetupForm } from "@/components/integrations/quick-setup-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectorConfig, ConnectorPreset } from "@proliferate/shared";
import { CONNECTOR_PRESETS } from "@proliferate/shared";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

// ====================================================================
// Detail dialog
// ====================================================================

interface IntegrationDetailDialogProps {
	entry: CatalogEntry | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showBack: boolean;
	onBack: () => void;
	// Connection state
	isConnected: boolean;
	isLoading: boolean;
	connectedMeta: string | null;
	// Actions
	onConnect: () => void;
	onDisconnect: () => void;
	// MCP connector save
	onSaveConnector: (connector: ConnectorConfig, isNew: boolean) => void;
}

export function IntegrationDetailDialog({
	entry,
	open,
	onOpenChange,
	showBack,
	onBack,
	isConnected,
	isLoading,
	connectedMeta,
	onConnect,
	onDisconnect,
	onSaveConnector,
}: IntegrationDetailDialogProps) {
	if (!entry) return null;

	const preset: ConnectorPreset | undefined = entry.presetKey
		? CONNECTOR_PRESETS.find((p) => p.key === entry.presetKey)
		: undefined;

	const manageUrl = entry.provider ? getProviderManageUrl(entry.provider) : null;

	const PROLIFERATE_DOCS: Record<string, string> = {
		github: "https://docs.proliferate.com/integrations/github",
		slack: "https://docs.proliferate.com/integrations/slack",
		linear: "https://docs.proliferate.com/integrations/linear",
		sentry: "https://docs.proliferate.com/integrations/sentry",
	};
	const proliferateDocsUrl =
		PROLIFERATE_DOCS[entry.key] ??
		(entry.type === "mcp-preset" || entry.type === "custom-mcp"
			? "https://docs.proliferate.com/integrations/mcp-connectors"
			: null);

	// Platform feature notes for product integrations
	const PLATFORM_NOTES: Record<string, string> = {
		github: "Also powers repo management, code access, and pull requests.",
		slack: "Also powers notifications and agent interaction from Slack.",
		linear: "Also powers issue tracking triggers and automations.",
		sentry: "Also powers error monitoring triggers and automations.",
	};
	const platformNote = PLATFORM_NOTES[entry.key];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-[512px] p-0 gap-0 rounded-xl overflow-hidden flex flex-col"
				style={{ height: "min(600px, 85vh)" }}
				hideCloseButton={false}
			>
				{/* Header */}
				<div className="px-5 pt-4 flex items-center gap-3 shrink-0">
					<div className="w-8 h-8 rounded-lg border border-border bg-background flex items-center justify-center p-1 shrink-0">
						{entry.type === "mcp-preset" && entry.presetKey ? (
							<ConnectorIcon presetKey={entry.presetKey} size="md" />
						) : entry.provider ? (
							<ProviderIcon provider={entry.provider} size="md" />
						) : (
							<ConnectorIcon presetKey="custom" size="md" />
						)}
					</div>
					<h2 className="text-lg font-medium tracking-tight">{entry.name}</h2>
				</div>

				{/* Tabs body */}
				<div className="flex-1 overflow-hidden flex flex-col">
					<Tabs defaultValue="connect" className="flex-1 flex flex-col overflow-hidden">
						<TabsList className="inline-flex gap-3.5 border-b border-border w-full h-11 px-5 pt-3 pb-0 shrink-0 bg-transparent rounded-none justify-start">
							<TabsTrigger
								value="connect"
								className="-mb-[1px] border-b-[1.5px] border-transparent px-0 py-1 text-sm font-medium text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none rounded-none bg-transparent data-[state=active]:bg-transparent"
							>
								Connect
							</TabsTrigger>
							<TabsTrigger
								value="about"
								className="-mb-[1px] border-b-[1.5px] border-transparent px-0 py-1 text-sm font-medium text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none rounded-none bg-transparent data-[state=active]:bg-transparent"
							>
								About
							</TabsTrigger>
						</TabsList>

						{/* Connect tab */}
						<TabsContent value="connect" className="flex-1 overflow-y-auto p-5 mt-0">
							<ConnectTabContent
								entry={entry}
								preset={preset}
								isConnected={isConnected}
								isLoading={isLoading}
								connectedMeta={connectedMeta}
								manageUrl={manageUrl}
								onConnect={onConnect}
								onDisconnect={onDisconnect}
								onSaveConnector={onSaveConnector}
								onClose={() => onOpenChange(false)}
							/>
						</TabsContent>

						{/* About tab */}
						<TabsContent value="about" className="flex-1 overflow-y-auto p-5 mt-0">
							<div className="space-y-4">
								<div>
									<h3 className="text-sm font-medium mb-1">Description</h3>
									<p className="text-sm text-muted-foreground">{entry.description}</p>
									{platformNote && (
										<p className="text-xs text-muted-foreground mt-1.5">{platformNote}</p>
									)}
								</div>
								<div>
									<h3 className="text-sm font-medium mb-1">Category</h3>
									<p className="text-sm text-muted-foreground">{CATEGORY_LABELS[entry.category]}</p>
								</div>
								<div className="flex flex-col gap-2">
									{proliferateDocsUrl && (
										<a
											href={proliferateDocsUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
										>
											Proliferate docs
											<ExternalLink className="h-3.5 w-3.5" />
										</a>
									)}
									{manageUrl && (
										<a
											href={manageUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
										>
											Manage on {getProviderDisplayName(entry.provider!)}
											<ExternalLink className="h-3.5 w-3.5" />
										</a>
									)}
									{preset?.docsUrl && (
										<a
											href={preset.docsUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
										>
											{entry.name} documentation
											<ExternalLink className="h-3.5 w-3.5" />
										</a>
									)}
								</div>
							</div>
						</TabsContent>
					</Tabs>
				</div>

				{/* Footer */}
				{showBack && (
					<div className="border-t border-border px-5 py-4 flex justify-start shrink-0">
						<Button variant="outline" size="sm" onClick={onBack}>
							Back
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ====================================================================
// Connect tab content (varies by integration type)
// ====================================================================

function ConnectTabContent({
	entry,
	preset,
	isConnected,
	isLoading,
	connectedMeta,
	manageUrl,
	onConnect,
	onDisconnect,
	onSaveConnector,
	onClose,
}: {
	entry: CatalogEntry;
	preset?: ConnectorPreset;
	isConnected: boolean;
	isLoading: boolean;
	connectedMeta: string | null;
	manageUrl: string | null;
	onConnect: () => void;
	onDisconnect: () => void;
	onSaveConnector: (connector: ConnectorConfig, isNew: boolean) => void;
	onClose: () => void;
}) {
	// Custom MCP — full connector form with URL, transport, auth
	if (entry.type === "custom-mcp") {
		return <ConnectorForm isNew onSave={onSaveConnector} onCancel={onClose} />;
	}

	// MCP preset — always use quick setup (API key only)
	if (entry.type === "mcp-preset" && preset) {
		return <QuickSetupForm preset={preset} onClose={onClose} />;
	}

	// OAuth / Slack
	if (isConnected) {
		return (
			<div className="space-y-4">
				<p className="text-sm text-muted-foreground">{entry.description}</p>

				<div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
					<CheckCircle2 className="h-4 w-4 text-foreground shrink-0" />
					<span className="text-sm">
						Connected{connectedMeta ? ` \u00b7 ${connectedMeta}` : ""}
					</span>
				</div>

				<div className="flex items-center gap-2 pt-2">
					<Button variant="outline" size="sm" onClick={onConnect}>
						Reconnect
					</Button>
					{manageUrl && (
						<Button variant="outline" size="sm" asChild>
							<a href={manageUrl} target="_blank" rel="noopener noreferrer">
								Manage
								<ExternalLink className="h-3.5 w-3.5 ml-1.5" />
							</a>
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						className="text-destructive hover:text-destructive"
						onClick={onDisconnect}
					>
						Disconnect
					</Button>
				</div>
			</div>
		);
	}

	// Not connected
	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">{entry.description}</p>

			<Button onClick={onConnect} disabled={isLoading} className="w-full">
				{isLoading ? (
					<>
						<Loader2 className="h-4 w-4 mr-2 animate-spin" />
						Connecting...
					</>
				) : (
					"Connect"
				)}
			</Button>
		</div>
	);
}
