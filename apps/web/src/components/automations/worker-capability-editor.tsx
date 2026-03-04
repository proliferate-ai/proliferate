"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SUGGESTED_CAPABILITIES } from "@/config/coworkers";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

export type WorkerCapabilityDraft = {
	capabilityKey: string;
	mode: "allow" | "require_approval" | "deny";
	origin?: string;
};

type CapabilityProvider = Extract<Provider, "github" | "linear" | "sentry" | "slack" | "jira">;

function inferProviderFromCapabilityKey(capabilityKey: string): CapabilityProvider | undefined {
	if (capabilityKey.startsWith("source.github.") || capabilityKey.startsWith("github.")) {
		return "github";
	}
	if (capabilityKey.startsWith("source.linear.") || capabilityKey.startsWith("linear.")) {
		return "linear";
	}
	if (capabilityKey.startsWith("source.sentry.") || capabilityKey.startsWith("sentry.")) {
		return "sentry";
	}
	if (capabilityKey.startsWith("slack.")) {
		return "slack";
	}
	if (capabilityKey.startsWith("jira.")) {
		return "jira";
	}
	return undefined;
}

interface WorkerCapabilityEditorProps {
	value: WorkerCapabilityDraft[];
	onChange: (value: WorkerCapabilityDraft[]) => void;
	disabled?: boolean;
	connectedProviders?: string[];
}

export function WorkerCapabilityEditor({
	value,
	onChange,
	disabled,
	connectedProviders,
}: WorkerCapabilityEditorProps) {
	const [customKey, setCustomKey] = useState("");
	const usedKeys = useMemo(() => new Set(value.map((entry) => entry.capabilityKey)), [value]);
	const availableProviders = useMemo(
		() => new Set((connectedProviders ?? []).map((provider) => provider.toLowerCase())),
		[connectedProviders],
	);
	const filteredSuggestions = useMemo(() => {
		if (!connectedProviders) {
			return SUGGESTED_CAPABILITIES;
		}

		return SUGGESTED_CAPABILITIES.filter((suggestion) => {
			if (!suggestion.provider) {
				return connectedProviders.length > 0;
			}

			return availableProviders.has(suggestion.provider);
		});
	}, [connectedProviders, availableProviders]);

	const addCapability = (capabilityKey: string) => {
		const key = capabilityKey.trim();
		if (!key || usedKeys.has(key)) return;
		onChange([
			...value,
			{ capabilityKey: key, mode: "require_approval", origin: "coworker-settings" },
		]);
	};

	const updateCapability = (
		capabilityKey: string,
		next: Partial<Pick<WorkerCapabilityDraft, "mode">>,
	) => {
		onChange(
			value.map((entry) =>
				entry.capabilityKey === capabilityKey
					? {
							...entry,
							...next,
						}
					: entry,
			),
		);
	};

	const removeCapability = (capabilityKey: string) => {
		onChange(value.filter((entry) => entry.capabilityKey !== capabilityKey));
	};

	return (
		<div className="rounded-lg border border-border bg-card p-3">
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-foreground">Capability overrides</p>
					<p className="text-xs text-muted-foreground">
						Add explicit policy for specific capability keys. Unlisted keys follow org defaults.
					</p>
					<p className="text-xs text-muted-foreground">
						For action permissions, use exact keys like <code>github.create_issue</code> or{" "}
						<code>connector:abc123.create_ticket</code>.
					</p>
				</div>
				{filteredSuggestions.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						No connected integrations yet. Connect providers to get suggested capability keys.
					</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{filteredSuggestions.map((suggestion) => (
							<Button
								key={suggestion.capabilityKey}
								type="button"
								size="sm"
								variant="outline"
								className="h-7 rounded-full px-2.5 text-xs"
								disabled={disabled || usedKeys.has(suggestion.capabilityKey)}
								onClick={() => addCapability(suggestion.capabilityKey)}
							>
								<span className="flex items-center gap-1.5">
									{suggestion.provider && (
										<ProviderIcon
											provider={suggestion.provider}
											size="sm"
											className="h-3.5 w-3.5"
										/>
									)}
									{suggestion.capabilityKey}
								</span>
							</Button>
						))}
					</div>
				)}
				<div className="flex items-center gap-2">
					<Input
						value={customKey}
						onChange={(event) => setCustomKey(event.target.value)}
						placeholder="Custom key (e.g. linear.create_issue)"
						className="h-9 text-sm"
						disabled={disabled}
					/>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={disabled || !customKey.trim()}
						onClick={() => {
							addCapability(customKey);
							setCustomKey("");
						}}
					>
						Add
					</Button>
				</div>

				{value.length === 0 ? (
					<div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
						<p className="text-xs text-muted-foreground">
							No explicit overrides yet. Add one to customize permissions for this coworker.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{value.map((entry) => (
							<div
								key={entry.capabilityKey}
								className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-2"
							>
								<div className="flex-1 min-w-0 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
									<Badge
										variant="outline"
										className="h-6 max-w-full overflow-hidden whitespace-nowrap text-ellipsis gap-1.5"
									>
										{(() => {
											const provider = inferProviderFromCapabilityKey(entry.capabilityKey);
											return provider ? (
												<ProviderIcon provider={provider} size="sm" className="h-3.5 w-3.5" />
											) : null;
										})()}
										{entry.capabilityKey}
									</Badge>
								</div>
								<Select
									disabled={disabled}
									value={entry.mode}
									onValueChange={(mode: WorkerCapabilityDraft["mode"]) =>
										updateCapability(entry.capabilityKey, { mode })
									}
								>
									<SelectTrigger className="h-8 w-[170px] text-sm">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="allow">allow</SelectItem>
										<SelectItem value="require_approval">require approval</SelectItem>
										<SelectItem value="deny">deny</SelectItem>
									</SelectContent>
								</Select>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									className="h-8 w-8"
									disabled={disabled}
									onClick={() => removeCapability(entry.capabilityKey)}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
