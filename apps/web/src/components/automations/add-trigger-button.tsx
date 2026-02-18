"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { TriggerProvider } from "@proliferate/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CirclePlus, Plus } from "lucide-react";
import { useState } from "react";
import { TriggerConfigForm, type TriggerFormData } from "./trigger-config-form";

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
}

export function AddTriggerButton({
	automationId,
	onAdded,
	variant = "chip",
	isFirst,
	isLast,
	defaultProvider,
	label = "Add trigger",
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

	const popoverContent = (
		<PopoverContent className="w-auto p-3" align="start">
			<TriggerConfigForm
				automationId={automationId}
				initialProvider={defaultProvider}
				lockProvider={!!defaultProvider}
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
				submitLabel={defaultProvider ? "Add Schedule" : "Add Trigger"}
				isSubmitting={createMutation.isPending}
			/>
		</PopoverContent>
	);

	if (variant === "stacked") {
		return (
			<Popover open={open} onOpenChange={setOpen}>
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
		<Popover open={open} onOpenChange={setOpen}>
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
