"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTriggerProviders } from "@/hooks/use-trigger-providers";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { TriggerProvider } from "@proliferate/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CirclePlus, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { TriggerConfigForm, type TriggerFormData } from "./trigger-config-form";

const integrationProviders: Provider[] = ["github", "linear", "sentry"];
const standaloneProviders: Provider[] = ["posthog", "webhook", "scheduled"];
const allProvidersList: Provider[] = [...integrationProviders, ...standaloneProviders];

/** Default configs per provider for immediate trigger creation */
const defaultConfigs: Record<string, Record<string, unknown>> = {
	linear: { actionFilters: ["create"] },
	sentry: {},
	github: { eventTypes: ["issues"], actionFilters: ["opened"] },
	posthog: {},
	webhook: {},
};

interface Integration {
	id: string;
	integration_id: string | null;
	status: string | null;
}

interface AddTriggerButtonProps {
	automationId: string;
	onAdded?: () => void;
	variant?: "chip" | "stacked";
	isFirst?: boolean;
	isLast?: boolean;
	/** Pre-select and lock to a specific provider (e.g. "scheduled") */
	defaultProvider?: Provider;
	/** Button label (defaults to "Add trigger") */
	label?: string;
	/** Which integrations are connected for this org */
	connectedProviders?: Set<string>;
	/** All active integrations for auto-selection */
	integrations?: Integration[];
}

export function AddTriggerButton({
	automationId,
	onAdded,
	variant = "chip",
	isFirst,
	isLast,
	defaultProvider,
	label = "Add trigger",
	connectedProviders = new Set(),
	integrations = [],
}: AddTriggerButtonProps) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	const createMutation = useMutation({
		...orpc.automations.createTrigger.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.get.key({ input: { id: automationId } }),
			});
			setOpen(false);
			onAdded?.();
		},
	});

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (isOpen) {
			queryClient.prefetchQuery({
				...orpc.integrations.list.queryOptions({ input: undefined }),
				staleTime: 30_000,
			});
		}
	};

	/** For non-locked providers: select provider → create trigger immediately */
	const handleProviderSelect = (provider: Provider) => {
		// Find the integration ID if this provider needs one
		let integrationId: string | undefined;
		if (integrationProviders.includes(provider)) {
			const matching = integrations.filter(
				(i) => i.integration_id === provider && i.status === "active",
			);
			if (matching.length === 1) {
				integrationId = matching[0].id;
			}
			// If multiple connections, we still create with the first one — user can change in config
			if (matching.length > 1) {
				integrationId = matching[0].id;
			}
		}

		createMutation.mutate({
			id: automationId,
			provider: provider as TriggerProvider,
			integrationId,
			config: defaultConfigs[provider] ?? {},
		});
	};

	// Determine available providers
	const { data: triggerProvidersData } = useTriggerProviders();
	const allProviders = (() => {
		if (!triggerProvidersData?.providers) return allProvidersList;
		const available = new Set<Provider>();
		for (const entry of Object.values(triggerProvidersData.providers)) {
			available.add(entry.provider as Provider);
		}
		for (const p of standaloneProviders) available.add(p);
		return allProvidersList.filter((p) => available.has(p));
	})();

	// For locked providers (scheduled), keep the full form
	const isLocked = !!defaultProvider;

	const popoverContent = isLocked ? (
		<PopoverContent className="w-auto p-3" align="start">
			<TriggerConfigForm
				automationId={automationId}
				initialProvider={defaultProvider}
				lockProvider
				connectedProviders={connectedProviders}
				integrations={integrations}
				onSubmit={(data) =>
					createMutation.mutate({
						id: automationId,
						provider: data.provider as TriggerProvider,
						integrationId: data.integrationId,
						config: data.config as Record<string, unknown>,
						cronExpression: data.cronExpression,
					})
				}
				onCancel={() => setOpen(false)}
				submitLabel="Add Schedule"
				isSubmitting={createMutation.isPending}
			/>
		</PopoverContent>
	) : (
		<PopoverContent className="w-auto p-0" align="start">
			<ProviderPickerList
				providers={allProviders.filter((p) => p !== "scheduled")}
				connectedProviders={connectedProviders}
				onSelect={handleProviderSelect}
				isPending={createMutation.isPending}
			/>
		</PopoverContent>
	);

	if (variant === "stacked") {
		return (
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(
							"min-h-[2.75rem] text-left text-sm flex items-center px-3 relative transition-colors duration-75",
							"border border-border -mb-px last:mb-0",
							"text-muted-foreground font-medium",
							"hover:z-10 active:z-10 focus-visible:z-20",
							"hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							isFirst && "rounded-t-xl",
							isLast && "rounded-b-xl",
						)}
					>
						<CirclePlus className="w-[18px] h-[18px] shrink-0" />
						<div className="flex min-w-0 items-center grow gap-1.5 px-2 py-2">{label}</div>
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
					size="icon"
					className="w-8 h-8 rounded-full border border-dashed border-border bg-card hover:bg-muted hover:border-primary/50"
				>
					<Plus className="h-4 w-4 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			{popoverContent}
		</Popover>
	);
}

// ============================================
// Provider Picker List (type selection only)
// ============================================

function ProviderPickerList({
	providers,
	connectedProviders,
	onSelect,
	isPending,
}: {
	providers: Provider[];
	connectedProviders: Set<string>;
	onSelect: (provider: Provider) => void;
	isPending: boolean;
}) {
	return (
		<div className="flex flex-col py-1 min-w-[200px]">
			{providers.map((p) => {
				const needsConnection = integrationProviders.includes(p);
				const isDisabled = (needsConnection && !connectedProviders.has(p)) || isPending;
				return (
					<button
						key={p}
						type="button"
						disabled={isDisabled}
						onClick={() => onSelect(p)}
						className={cn(
							"flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
							isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50",
						)}
					>
						{isPending ? (
							<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
						) : (
							<ProviderIcon provider={p} className="h-3.5 w-3.5 shrink-0" />
						)}
						<span className="flex-1">{getProviderDisplayName(p)}</span>
						{needsConnection && !connectedProviders.has(p) && (
							<span className="text-xs text-muted-foreground">Not connected</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
