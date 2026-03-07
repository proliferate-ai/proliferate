"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import { ReasoningSelector } from "@/components/dashboard/reasoning-selector";
import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { BlocksIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { useActionModes } from "@/hooks/actions/use-action-modes";
import { useActionPreferenceIndex } from "@/hooks/actions/use-action-preferences";
import { useIntegrations, useSlackStatus } from "@/hooks/integrations/use-integrations";
import { getProviderFromIntegrationId } from "@/hooks/integrations/use-nango-connect";
import { useOrgConnectors } from "@/hooks/integrations/use-org-connectors";
import { cn } from "@/lib/display/utils";
import { ACTION_ADAPTERS, type AdapterProvider } from "@/lib/integrations/action-adapters";
import { resolveUserToggleState } from "@/lib/integrations/action-permissions";
import { useDashboardStore } from "@/stores/dashboard";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface PromptInputProps {
	onSubmit: (prompt: string) => void;
	disabled?: boolean;
	isLoading?: boolean;
}

function isAdapterProvider(provider: Provider): provider is AdapterProvider {
	return (
		provider === "linear" || provider === "sentry" || provider === "slack" || provider === "jira"
	);
}

export function PromptInput({ onSubmit, disabled, isLoading }: PromptInputProps) {
	const [prompt, setPrompt] = useState("");
	const { data: integrationsData } = useIntegrations();
	const { data: slackStatus } = useSlackStatus();
	const { data: connectors } = useOrgConnectors();
	const { data: actionModesData } = useActionModes();
	const actionModes = actionModesData?.modes ?? {};
	const preferenceIndex = useActionPreferenceIndex();

	const { selectedModel, setSelectedModel, reasoningEffort, setReasoningEffort } =
		useDashboardStore();

	const enabledIntegrationSummaries = useMemo(() => {
		const summaries: Array<{
			id: string;
			displayName: string;
			detail: string;
			provider: Provider | null;
		}> = [];
		const seenProviders = new Set<Provider>();
		const adaptersByProvider = new Map(
			ACTION_ADAPTERS.map((adapter) => [adapter.integration, adapter]),
		);

		for (const integration of integrationsData?.integrations ?? []) {
			if (integration.status !== "active" || !integration.integration_id) {
				continue;
			}

			const provider = getProviderFromIntegrationId(integration.integration_id);
			if (!provider || seenProviders.has(provider)) {
				continue;
			}
			if (!isAdapterProvider(provider)) {
				continue;
			}

			const adapter = adaptersByProvider.get(provider);
			if (!adapter || adapter.actions.length === 0) {
				continue;
			}

			const sourceId = provider;
			const enabledActionCount = adapter.actions.filter((action) => {
				const adminActionEnabled =
					(actionModes[`${sourceId}:${action.name}`] ?? "require_approval") !== "deny";
				const userActionEnabled = preferenceIndex.isActionEnabled(sourceId, action.name);
				return resolveUserToggleState({
					adminActionEnabled,
					userActionEnabled,
				}).checked;
			}).length;

			if (enabledActionCount === 0) {
				continue;
			}

			seenProviders.add(provider);
			summaries.push({
				id: `provider:${provider}`,
				displayName: adapter.displayName,
				detail: `${enabledActionCount} actions enabled`,
				provider,
			});
		}

		if (slackStatus?.connected && !seenProviders.has("slack")) {
			const slackAdapter = adaptersByProvider.get("slack");
			if (slackAdapter) {
				const sourceId = "slack";
				const enabledActionCount = slackAdapter.actions.filter((action) => {
					const adminActionEnabled =
						(actionModes[`${sourceId}:${action.name}`] ?? "require_approval") !== "deny";
					const userActionEnabled = preferenceIndex.isActionEnabled(sourceId, action.name);
					return resolveUserToggleState({
						adminActionEnabled,
						userActionEnabled,
					}).checked;
				}).length;
				if (enabledActionCount > 0) {
					summaries.push({
						id: "provider:slack",
						displayName: slackAdapter.displayName,
						detail: `${enabledActionCount} actions enabled`,
						provider: "slack",
					});
				}
			}
		}

		for (const connector of connectors ?? []) {
			if (!connector.enabled) {
				continue;
			}
			const sourceId = `connector:${connector.id}`;
			if (preferenceIndex.disabledSourceIds.has(sourceId)) {
				continue;
			}
			summaries.push({
				id: `connector:${connector.id}`,
				displayName: connector.name,
				detail: "Connector enabled",
				provider: null,
			});
		}

		return summaries;
	}, [
		integrationsData?.integrations,
		slackStatus?.connected,
		connectors,
		actionModes,
		preferenceIndex,
	]);

	const canSubmit = !disabled && !isLoading && prompt.trim();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (canSubmit) {
			onSubmit(prompt.trim());
			// Don't clear prompt - keep it visible during loading
			// It will be cleared when session becomes active
		}
	};

	return (
		<form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
			<div
				className={cn(
					"rounded-2xl border border-border bg-card dark:bg-chat-input shadow-sm transition-all overflow-hidden",
					"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:border-transparent",
				)}
			>
				{/* Text input area */}
				<Textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="How can I help you today?"
					className="w-full min-h-[60px] p-4 pb-2 bg-transparent resize-none focus:outline-none text-[15px] leading-relaxed border-0 focus-visible:ring-0"
					disabled={disabled || isLoading}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							handleSubmit(e);
						}
					}}
				/>

				{/* Bottom toolbar */}
				<div className="flex items-center justify-between px-3 py-2 overflow-hidden">
					{/* Left side - Context selectors */}
					<div className="flex items-center gap-1 min-w-0 overflow-hidden">
						<ModelSelector
							modelId={selectedModel}
							onChange={setSelectedModel}
							disabled={isLoading}
							variant="ghost"
						/>
						<ReasoningSelector
							modelId={selectedModel}
							effort={reasoningEffort}
							onChange={setReasoningEffort}
							disabled={isLoading}
						/>
					</div>

					{/* Right side - Actions & Submit */}
					<div className="flex items-center gap-1">
						<Button
							type="submit"
							size="icon"
							disabled={!canSubmit}
							className={cn(
								"h-8 w-8 rounded-full transition-all",
								canSubmit ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground",
							)}
						>
							<ArrowUp className="h-4 w-4" />
						</Button>
					</div>
				</div>
				{enabledIntegrationSummaries.length > 0 && (
					<div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
						<div className="flex items-center -space-x-1">
							{enabledIntegrationSummaries.slice(0, 3).map((entry) => (
								<div
									key={entry.id}
									className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-foreground"
									title={`${entry.displayName}: ${entry.detail}`}
								>
									{entry.provider ? (
										<ProviderIcon provider={entry.provider} size="sm" />
									) : (
										<BlocksIcon className="h-3.5 w-3.5" />
									)}
								</div>
							))}
							{enabledIntegrationSummaries.length > 3 && (
								<Link
									href="/dashboard/integrations"
									className="ml-1 inline-flex h-6 items-center rounded-full border border-border bg-background px-2 text-[11px] text-muted-foreground hover:text-foreground"
								>
									+{enabledIntegrationSummaries.length - 3}
								</Link>
							)}
						</div>
						<Link
							href="/dashboard/integrations"
							className="text-xs text-primary hover:text-primary/80"
						>
							Integration settings
						</Link>
					</div>
				)}
			</div>
		</form>
	);
}
