"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BlocksIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorker } from "@/hooks/automations/use-workers";
import { inferProviderFromCapabilityKey } from "@/lib/integrations/capability-utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface IntegrationSummary {
	id: string;
	displayName: string;
	detail: string;
	provider: Provider | null;
}

interface CapabilitiesBadgesProps {
	mode: "opencode" | "coworker";
	workerId?: string;
	integrationSummaries?: IntegrationSummary[];
}

function BadgeCircle({ provider }: { provider: Provider | null }) {
	return (
		<div className="flex -mr-3 h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-foreground">
			{provider ? (
				<ProviderIcon provider={provider} size="sm" />
			) : (
				<BlocksIcon className="h-3.5 w-3.5" />
			)}
		</div>
	);
}

const MODE_LABELS = {
	allow: "Allow",
	require_approval: "Approval",
	deny: "Deny",
} as const;

export function CapabilitiesBadges({
	mode,
	workerId,
	integrationSummaries,
}: CapabilitiesBadgesProps) {
	const [open, setOpen] = useState(false);
	const { data: worker } = useWorker(mode === "coworker" && workerId ? workerId : "");

	const badges = useMemo(() => {
		const seen = new Set<string>();
		const result: Array<{
			id: string;
			displayName: string;
			detail: string;
			provider: Provider | null;
		}> = [];

		for (const summary of integrationSummaries ?? []) {
			const key = summary.provider ?? summary.id;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(summary);
		}

		if (mode === "coworker" && worker?.capabilities) {
			for (const cap of worker.capabilities) {
				if (cap.mode === "deny") continue;
				const provider = inferProviderFromCapabilityKey(cap.capabilityKey);
				const key = provider ?? cap.capabilityKey;
				if (seen.has(key)) continue;
				seen.add(key);
				result.push({
					id: cap.capabilityKey,
					displayName: provider ? getProviderDisplayName(provider) : cap.capabilityKey,
					detail: MODE_LABELS[cap.mode as keyof typeof MODE_LABELS] ?? cap.mode,
					provider: provider ?? null,
				});
			}
		}

		return result;
	}, [mode, integrationSummaries, worker?.capabilities]);

	// Coworker capability overrides for the popover detail list
	const coworkerCapabilities = useMemo(() => {
		if (mode !== "coworker" || !worker?.capabilities) return [];
		return worker.capabilities.filter((c) => c.mode !== "deny");
	}, [mode, worker?.capabilities]);

	if (badges.length === 0) return null;

	const visible = badges.slice(0, 3);
	const overflow = badges.length - 3;
	const configHref =
		mode === "coworker" && workerId ? `/coworkers/${workerId}` : "/dashboard/integrations";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="flex items-center -space-x-1 cursor-pointer h-auto p-0"
				>
					{visible.map((entry) => (
						<BadgeCircle key={entry.id} provider={entry.provider} />
					))}
					{overflow > 0 && (
						<div className="ml-1 inline-flex h-6 items-center rounded-full border border-border bg-background px-2 text-[11px] text-muted-foreground">
							+{overflow}
						</div>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="end">
				<div className="px-3 py-2.5 border-b border-border">
					<p className="text-sm font-medium text-foreground">
						{mode === "coworker" ? "Coworker capabilities" : "Session integrations"}
					</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						{mode === "coworker"
							? "Tools and integrations available in this session"
							: "Connected integrations with enabled actions"}
					</p>
				</div>

				<div className="py-1">
					{/* Org integrations (both modes) */}
					{(integrationSummaries ?? []).map((entry) => (
						<div key={entry.id} className="flex items-center gap-2.5 px-3 py-1.5">
							<div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/30 text-foreground shrink-0">
								{entry.provider ? (
									<ProviderIcon provider={entry.provider} size="sm" />
								) : (
									<BlocksIcon className="h-3.5 w-3.5" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<span className="text-sm text-foreground block truncate">{entry.displayName}</span>
								<span className="text-[11px] text-muted-foreground">{entry.detail}</span>
							</div>
						</div>
					))}

					{/* Coworker-specific capability overrides */}
					{mode === "coworker" && coworkerCapabilities.length > 0 && (
						<>
							{(integrationSummaries ?? []).length > 0 && (
								<div className="border-t border-border my-1" />
							)}
							{coworkerCapabilities.map((cap) => {
								const provider = inferProviderFromCapabilityKey(cap.capabilityKey);
								return (
									<div key={cap.capabilityKey} className="flex items-center gap-2.5 px-3 py-1.5">
										<div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/30 text-foreground shrink-0">
											{provider ? (
												<ProviderIcon provider={provider} size="sm" />
											) : (
												<BlocksIcon className="h-3.5 w-3.5" />
											)}
										</div>
										<div className="min-w-0 flex-1">
											<span className="text-sm text-foreground block truncate">
												{cap.capabilityKey}
											</span>
										</div>
										<Badge
											variant="outline"
											className="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0"
										>
											{MODE_LABELS[cap.mode as keyof typeof MODE_LABELS] ?? cap.mode}
										</Badge>
									</div>
								);
							})}
						</>
					)}

					{badges.length === 0 && (
						<p className="px-3 py-3 text-xs text-muted-foreground text-center">
							No integrations configured
						</p>
					)}
				</div>

				<div className="border-t border-border px-3 py-2">
					<Link
						href={configHref}
						onClick={() => setOpen(false)}
						className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
					>
						{mode === "coworker" ? "Configure coworker" : "Integration settings"}
						<ArrowRight className="h-3 w-3" />
					</Link>
				</div>
			</PopoverContent>
		</Popover>
	);
}
