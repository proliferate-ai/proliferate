"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type {
	AutomationTrigger,
	GitHubTriggerConfig,
	LinearTriggerConfig,
	PostHogTriggerConfig,
	SentryTriggerConfig,
} from "@proliferate/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import cronstrue from "cronstrue";
import { ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { TriggerConfigForm, type TriggerFormData } from "./trigger-config-form";

// Extended trigger type that includes fields used by this component
type Trigger = AutomationTrigger & {
	polling_cron?: string | null;
};

interface Integration {
	id: string;
	integration_id: string | null;
	status: string | null;
}

interface TriggerChipProps {
	trigger: Trigger;
	automationId: string;
	onDeleted?: () => void;
	variant?: "chip" | "stacked";
	isFirst?: boolean;
	isLast?: boolean;
	/** Which integrations are connected for this org */
	connectedProviders?: Set<string>;
	/** All active integrations for auto-selection */
	integrations?: Integration[];
}

function getTriggerSummary(trigger: Trigger): string {
	const { provider, config, polling_cron } = trigger;

	if (provider === "webhook") {
		return "POST to trigger";
	}

	if (provider === "scheduled") {
		if (polling_cron) {
			try {
				return cronstrue.toString(polling_cron);
			} catch {
				return polling_cron;
			}
		}
		return "On schedule";
	}

	if (provider === "linear") {
		const c = config as LinearTriggerConfig;
		const parts: string[] = [];
		if (c.stateFilters?.length) parts.push(c.stateFilters.slice(0, 2).join(", "));
		if (c.priorityFilters?.length) {
			const labels = c.priorityFilters.map((p) =>
				p === 1 ? "Urgent" : p === 2 ? "High" : p === 3 ? "Medium" : "Low",
			);
			parts.push(labels.slice(0, 2).join(", "));
		}
		if (c.actionFilters?.includes("create") && c.actionFilters?.includes("update")) {
			parts.push("created/updated");
		} else if (c.actionFilters?.includes("create")) {
			parts.push("created");
		} else if (c.actionFilters?.includes("update")) {
			parts.push("updated");
		}
		return parts.length > 0 ? parts.join(" · ") : "All issues";
	}

	if (provider === "sentry") {
		const c = config as SentryTriggerConfig;
		const parts: string[] = [];
		if (c.projectSlug) parts.push(c.projectSlug);
		if (c.environments?.length) parts.push(c.environments.slice(0, 2).join(", "));
		if (c.minLevel) parts.push(`≥${c.minLevel}`);
		return parts.length > 0 ? parts.join(" · ") : "All errors";
	}

	if (provider === "github") {
		const c = config as GitHubTriggerConfig;
		const parts: string[] = [];
		// Event types
		if (c.eventTypes?.length) {
			const eventLabels: Record<string, string> = {
				issues: "Issues",
				pull_request: "PRs",
				push: "Push",
				check_run: "Checks",
				check_suite: "Check Suite",
				workflow_run: "Workflows",
			};
			const labels = c.eventTypes.slice(0, 2).map((e) => eventLabels[e] || e);
			parts.push(labels.join(", "));
		}
		// Actions
		if (c.actionFilters?.length) {
			parts.push(c.actionFilters.slice(0, 2).join(", "));
		}
		// Conclusions
		if (c.conclusionFilters?.length) {
			parts.push(c.conclusionFilters.slice(0, 2).join(", "));
		}
		return parts.length > 0 ? parts.join(" · ") : "All events";
	}

	if (provider === "posthog") {
		const c = config as PostHogTriggerConfig;
		const parts: string[] = [];
		if (c.eventNames?.length) parts.push(c.eventNames.slice(0, 2).join(", "));
		if (c.propertyFilters && Object.keys(c.propertyFilters).length > 0) {
			const filters = Object.entries(c.propertyFilters)
				.slice(0, 2)
				.map(([key, value]) => `${key}=${value}`);
			parts.push(filters.join(", "));
		}
		return parts.length > 0 ? parts.join(" · ") : "All events";
	}

	return "Configured";
}

const INTEGRATION_PROVIDERS = new Set(["github", "linear", "sentry"]);

export function TriggerChip({
	trigger,
	automationId,
	onDeleted,
	variant = "chip",
	isFirst,
	isLast,
	connectedProviders,
	integrations,
}: TriggerChipProps) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	// Check if this trigger's provider requires an integration that isn't connected
	const needsConnection =
		INTEGRATION_PROVIDERS.has(trigger.provider) &&
		connectedProviders &&
		!connectedProviders.has(trigger.provider);
	const isDisabled = !!needsConnection;

	const updateMutation = useMutation({
		...orpc.triggers.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.get.key({ input: { id: automationId } }),
			});
			setOpen(false);
		},
	});

	const deleteMutation = useMutation({
		...orpc.triggers.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.get.key({ input: { id: automationId } }),
			});
			onDeleted?.();
		},
	});

	const handleUpdate = (data: TriggerFormData) => {
		updateMutation.mutate({
			id: trigger.id,
			config: data.config as Record<string, unknown>,
			integrationId: data.integrationId ?? undefined,
			pollingCron: data.cronExpression,
		});
	};

	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation();
		deleteMutation.mutate({ id: trigger.id });
	};

	const summary = getTriggerSummary(trigger);
	const providerLabel =
		trigger.integration?.display_name || getProviderDisplayName(trigger.provider as Provider);

	const popoverContent = (
		<PopoverContent className="w-auto p-3" align="start">
			<TriggerConfigForm
				automationId={automationId}
				initialProvider={trigger.provider as Provider}
				lockProvider
				initialIntegrationId={trigger.integration_id}
				initialConfig={trigger.config}
				initialCronExpression={trigger.polling_cron}
				webhookSecret={trigger.webhook_secret}
				connectedProviders={connectedProviders}
				integrations={integrations}
				onSubmit={handleUpdate}
				onCancel={() => setOpen(false)}
				submitLabel="Update"
				isSubmitting={updateMutation.isPending}
			/>
		</PopoverContent>
	);

	const handleOpenChange = (isOpen: boolean) => {
		if (isDisabled) return;
		setOpen(isOpen);
	};

	if (variant === "stacked") {
		return (
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={isDisabled}
						className={cn(
							"min-h-[2.75rem] text-left text-sm font-medium flex items-center px-3 relative transition-colors duration-75",
							"border border-border -mb-px last:mb-0",
							"text-muted-foreground",
							isDisabled
								? "opacity-50 cursor-not-allowed"
								: "hover:z-10 active:z-10 focus-visible:z-20 hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							isFirst && "rounded-t-xl",
							isLast && "rounded-b-xl",
							!trigger.enabled && !isDisabled && "opacity-50",
						)}
					>
						<ProviderIcon provider={trigger.provider as Provider} className="h-4 w-4 shrink-0" />
						<div className="flex min-w-0 flex-col grow gap-0.5 px-2 py-2">
							<span className="text-foreground">{providerLabel}</span>
							<span className="text-xs text-muted-foreground truncate">
								{isDisabled ? "Not connected" : summary}
							</span>
						</div>
						{!isDisabled && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
					</button>
				</PopoverTrigger>
				{popoverContent}
			</Popover>
		);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					disabled={isDisabled}
					className={cn(
						"h-auto flex items-center gap-1.5 pl-2 pr-1 py-1.5 rounded-xl border",
						"bg-card border-border",
						isDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted",
						!trigger.enabled && !isDisabled && "opacity-50",
					)}
				>
					<ProviderIcon provider={trigger.provider as Provider} className="h-4 w-4 shrink-0" />
					<div className="flex flex-col items-start leading-tight">
						<span className="text-sm font-medium">{providerLabel}</span>
						<span className="text-xs text-muted-foreground">
							{isDisabled ? "Not connected" : summary}
						</span>
					</div>
					<span
						role="button"
						tabIndex={0}
						onClick={handleDelete}
						onKeyDown={(e) => e.key === "Enter" && handleDelete(e as unknown as React.MouseEvent)}
						className={cn(
							"ml-0.5 p-0.5 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors",
							deleteMutation.isPending && "pointer-events-none opacity-50",
						)}
					>
						<X className="h-3.5 w-3.5" />
					</span>
				</Button>
			</PopoverTrigger>
			{popoverContent}
		</Popover>
	);
}
