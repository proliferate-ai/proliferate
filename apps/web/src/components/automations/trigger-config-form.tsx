"use client";

import { ConnectionSelector } from "@/components/integrations/connection-selector";
import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterButtonGroup } from "@/components/ui/filter-button-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useLinearMetadata, useSentryMetadata } from "@/hooks/use-integrations";
import { useTriggerProviders } from "@/hooks/use-trigger-providers";
import type {
	GitHubTriggerConfig,
	LinearTriggerConfig,
	PostHogTriggerConfig,
	SentryTriggerConfig,
	TriggerConfig,
} from "@proliferate/shared";
import cronstrue from "cronstrue";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useState } from "react";
import { Cron } from "react-js-cron";
import "react-js-cron/dist/styles.css";

// --- Types ---

interface LinearMetadata {
	teams: Array<{ id: string; name: string; key: string }>;
	states: Array<{ id: string; name: string; type: string; color: string }>;
	labels: Array<{ id: string; name: string; color: string }>;
}

interface SentryMetadata {
	projects: Array<{ id: string; slug: string; name: string }>;
	environments: Array<{ name: string }>;
	levels: string[];
}

export interface TriggerFormData {
	provider: Provider;
	integrationId?: string;
	config: TriggerConfig;
	cronExpression?: string;
}

interface TriggerConfigFormProps {
	automationId?: string;
	initialProvider?: Provider | null;
	initialIntegrationId?: string | null;
	initialConfig?: TriggerConfig;
	initialCronExpression?: string | null;
	webhookSecret?: string | null;
	onSubmit: (data: TriggerFormData) => void;
	onCancel: () => void;
	submitLabel?: string;
	isSubmitting?: boolean;
}

// --- Constants ---

const LINEAR_PRIORITIES = [
	{ value: 1, label: "Urgent" },
	{ value: 2, label: "High" },
	{ value: 3, label: "Medium" },
	{ value: 4, label: "Low" },
];

const GITHUB_EVENT_TYPES = [
	{ value: "issues" as const, label: "Issues" },
	{ value: "pull_request" as const, label: "Pull Requests" },
	{ value: "push" as const, label: "Push" },
	{ value: "check_run" as const, label: "Check Run" },
	{ value: "check_suite" as const, label: "Check Suite" },
	{ value: "workflow_run" as const, label: "Workflow Run" },
];

const GITHUB_ISSUE_ACTIONS = [
	{ value: "opened", label: "Opened" },
	{ value: "closed", label: "Closed" },
	{ value: "labeled", label: "Labeled" },
	{ value: "assigned", label: "Assigned" },
];

const GITHUB_PR_ACTIONS = [
	{ value: "opened", label: "Opened" },
	{ value: "closed", label: "Closed" },
	{ value: "merged", label: "Merged" },
	{ value: "ready_for_review", label: "Ready for Review" },
];

const GITHUB_CONCLUSIONS = [
	{ value: "failure" as const, label: "Failure" },
	{ value: "success" as const, label: "Success" },
	{ value: "cancelled" as const, label: "Cancelled" },
	{ value: "timed_out" as const, label: "Timed Out" },
];

const INTEGRATION_PROVIDERS: Provider[] = ["linear", "github", "sentry"];
const SUPPORTED_INTEGRATION_PROVIDERS: Provider[] = ["linear", "github", "sentry"];
const STANDALONE_PROVIDERS: Provider[] = ["webhook", "scheduled", "posthog"];

// --- Sub-components ---

interface ProviderSelectorProps {
	provider: Provider | null;
	onSelect: (provider: Provider) => void;
	integrationProviders: Provider[];
	standaloneProviders: Provider[];
	disabledProviders?: Provider[];
}

function ProviderSelector({
	provider,
	onSelect,
	integrationProviders,
	standaloneProviders,
	disabledProviders = [],
}: ProviderSelectorProps) {
	return (
		<div className="space-y-2">
			<Label className="text-xs text-muted-foreground">Integration</Label>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="w-full h-9 justify-between font-normal">
						{provider ? (
							<div className="flex items-center gap-2">
								<ProviderIcon provider={provider} className="h-4 w-4" />
								<span className="capitalize">{provider}</span>
							</div>
						) : (
							<span className="text-muted-foreground">Select integration</span>
						)}
						<ChevronDown className="h-4 w-4 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]" align="start">
					{integrationProviders.map((p) => (
						<DropdownMenuItem
							key={p}
							disabled={disabledProviders.includes(p)}
							onClick={() => onSelect(p)}
							className="flex items-center gap-2"
						>
							{provider === p ? (
								<Check className="h-4 w-4 text-primary" />
							) : (
								<ProviderIcon provider={p} className="h-4 w-4" />
							)}
							<span>
								{getProviderDisplayName(p)}
								{disabledProviders.includes(p) ? " (coming soon)" : ""}
							</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					{standaloneProviders.map((p) => (
						<DropdownMenuItem
							key={p}
							onClick={() => onSelect(p)}
							className="flex items-center gap-2"
						>
							{provider === p ? (
								<Check className="h-4 w-4 text-primary" />
							) : (
								<ProviderIcon provider={p} className="h-4 w-4" />
							)}
							<span>{getProviderDisplayName(p)}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

interface LinearConfigSectionProps {
	config: LinearTriggerConfig;
	onChange: (config: LinearTriggerConfig) => void;
	metadata: LinearMetadata | undefined;
	isLoading: boolean;
}

function LinearConfigSection({ config, onChange, metadata, isLoading }: LinearConfigSectionProps) {
	if (isLoading) {
		return <div className="h-16 rounded bg-muted animate-pulse" />;
	}

	return (
		<div className="space-y-3">
			{metadata?.teams && metadata.teams.length > 0 && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Team</Label>
					<Select
						value={config.teamId || ""}
						onValueChange={(v) => onChange({ ...config, teamId: v || undefined })}
					>
						<SelectTrigger className="h-9">
							<SelectValue placeholder="All teams" />
						</SelectTrigger>
						<SelectContent>
							{metadata.teams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name} ({team.key})
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{metadata?.states && metadata.states.length > 0 && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">States</Label>
					<FilterButtonGroup
						items={metadata.states.slice(0, 8).map((state) => ({
							value: state.name,
							label: state.name,
						}))}
						selected={config.stateFilters || []}
						onChange={(selected) => onChange({ ...config, stateFilters: selected })}
						size="sm"
					/>
				</div>
			)}

			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Priority</Label>
				<FilterButtonGroup
					items={LINEAR_PRIORITIES}
					selected={config.priorityFilters || []}
					onChange={(selected) => onChange({ ...config, priorityFilters: selected })}
					size="sm"
				/>
			</div>

			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Trigger on</Label>
				<FilterButtonGroup
					items={[
						{ value: "create" as const, label: "Issue Created" },
						{ value: "update" as const, label: "Issue Updated" },
					]}
					selected={config.actionFilters || []}
					onChange={(selected) => onChange({ ...config, actionFilters: selected })}
					size="sm"
				/>
			</div>
		</div>
	);
}

interface SentryConfigSectionProps {
	config: SentryTriggerConfig;
	onChange: (config: SentryTriggerConfig) => void;
	metadata: SentryMetadata | undefined;
	isLoading: boolean;
}

function SentryConfigSection({ config, onChange, metadata, isLoading }: SentryConfigSectionProps) {
	if (isLoading) {
		return <div className="h-16 rounded bg-muted animate-pulse" />;
	}

	return (
		<div className="space-y-3">
			{metadata?.projects && metadata.projects.length > 0 && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Project</Label>
					<Select
						value={config.projectSlug || ""}
						onValueChange={(v) => onChange({ ...config, projectSlug: v || undefined })}
					>
						<SelectTrigger className="h-9">
							<SelectValue placeholder="All projects" />
						</SelectTrigger>
						<SelectContent>
							{metadata.projects.map((project) => (
								<SelectItem key={project.id} value={project.slug}>
									{project.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{metadata?.environments && metadata.environments.length > 0 && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Environments</Label>
					<FilterButtonGroup
						items={metadata.environments.map((env) => ({
							value: env.name,
							label: env.name,
						}))}
						selected={config.environments || []}
						onChange={(selected) => onChange({ ...config, environments: selected })}
						size="sm"
					/>
				</div>
			)}

			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Minimum Level</Label>
				<Select
					value={config.minLevel || ""}
					onValueChange={(v) =>
						onChange({
							...config,
							minLevel: (v || undefined) as SentryTriggerConfig["minLevel"],
						})
					}
				>
					<SelectTrigger className="h-9">
						<SelectValue placeholder="All levels" />
					</SelectTrigger>
					<SelectContent>
						{(metadata?.levels || ["debug", "info", "warning", "error", "fatal"]).map((level) => (
							<SelectItem key={level} value={level}>
								{level}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

interface GitHubConfigSectionProps {
	config: GitHubTriggerConfig;
	onChange: (config: GitHubTriggerConfig) => void;
}

function GitHubConfigSection({ config, onChange }: GitHubConfigSectionProps) {
	const showActionFilters =
		config.eventTypes?.includes("issues") || config.eventTypes?.includes("pull_request");
	const showConclusionFilters =
		config.eventTypes?.includes("check_run") ||
		config.eventTypes?.includes("check_suite") ||
		config.eventTypes?.includes("workflow_run");

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Event Types</Label>
				<FilterButtonGroup
					items={GITHUB_EVENT_TYPES}
					selected={config.eventTypes || []}
					onChange={(selected) =>
						onChange({ ...config, eventTypes: selected as GitHubTriggerConfig["eventTypes"] })
					}
					size="sm"
				/>
			</div>

			{showActionFilters && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Actions</Label>
					<FilterButtonGroup
						items={
							config.eventTypes?.includes("pull_request") ? GITHUB_PR_ACTIONS : GITHUB_ISSUE_ACTIONS
						}
						selected={config.actionFilters || []}
						onChange={(selected) => onChange({ ...config, actionFilters: selected })}
						size="sm"
					/>
				</div>
			)}

			{showConclusionFilters && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Conclusions</Label>
					<FilterButtonGroup
						items={GITHUB_CONCLUSIONS}
						selected={config.conclusionFilters || []}
						onChange={(selected) =>
							onChange({
								...config,
								conclusionFilters: selected as GitHubTriggerConfig["conclusionFilters"],
							})
						}
						size="sm"
					/>
				</div>
			)}
		</div>
	);
}

interface PostHogConfigSectionProps {
	config: PostHogTriggerConfig;
	onChange: (config: PostHogTriggerConfig) => void;
}

function parseCsvValues(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function parsePropertyFilters(value: string): Record<string, string> | undefined {
	const entries = parseCsvValues(value);
	if (entries.length === 0) return undefined;

	const filters: Record<string, string> = {};
	for (const entry of entries) {
		const [rawKey, ...rest] = entry.split("=");
		const key = rawKey?.trim();
		const filterValue = rest.join("=").trim();
		if (!key || !filterValue) continue;
		filters[key] = filterValue;
	}

	return Object.keys(filters).length > 0 ? filters : undefined;
}

function formatPropertyFilters(filters?: Record<string, string>): string {
	if (!filters) return "";
	return Object.entries(filters)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

function PostHogConfigSection({ config, onChange }: PostHogConfigSectionProps) {
	const eventNamesValue = (config.eventNames ?? []).join(", ");
	const propertyFiltersValue = formatPropertyFilters(config.propertyFilters);

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Event names (optional)</Label>
				<Input
					value={eventNamesValue}
					placeholder="pageview, signup"
					onChange={(event) => {
						const eventNames = parseCsvValues(event.target.value);
						onChange({ ...config, eventNames: eventNames.length ? eventNames : undefined });
					}}
				/>
			</div>
			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Property filters (optional)</Label>
				<Input
					value={propertyFiltersValue}
					placeholder="plan=pro, region=us-east-1"
					onChange={(event) => {
						const propertyFilters = parsePropertyFilters(event.target.value);
						onChange({ ...config, propertyFilters });
					}}
				/>
			</div>
		</div>
	);
}

interface WebhookConfigSectionProps {
	webhookUrl: string | null;
	webhookSecret?: string | null;
	requireSignature: boolean;
	onRequireSignatureChange: (value: boolean) => void;
	showSecret?: boolean;
}

function WebhookConfigSection({
	webhookUrl,
	webhookSecret,
	requireSignature,
	onRequireSignatureChange,
	showSecret = true,
}: WebhookConfigSectionProps) {
	return (
		<div className="space-y-3">
			{webhookUrl && (
				<WebhookUrlField
					webhookUrl={webhookUrl}
					webhookSecret={showSecret ? webhookSecret : null}
				/>
			)}
			<div className="flex items-center justify-between">
				<Label className="text-sm">Require signature verification</Label>
				<Switch checked={requireSignature} onCheckedChange={onRequireSignatureChange} />
			</div>
		</div>
	);
}

interface ScheduledConfigSectionProps {
	cronExpression: string;
	onChange: (value: string) => void;
}

function ScheduledConfigSection({ cronExpression, onChange }: ScheduledConfigSectionProps) {
	const humanReadable = (() => {
		try {
			return cronstrue.toString(cronExpression);
		} catch {
			return "Invalid cron expression";
		}
	})();

	return (
		<div className="space-y-2">
			<Label className="text-xs text-muted-foreground">Schedule</Label>
			<Cron
				value={cronExpression}
				setValue={onChange}
				clearButton={false}
				allowedPeriods={["day", "week", "month"]}
			/>
			<p className="text-sm text-muted-foreground">{humanReadable}</p>
		</div>
	);
}

interface FormFooterProps {
	onCancel: () => void;
	onSubmit: () => void;
	canSave: boolean;
	isSubmitting: boolean;
	submitLabel: string;
}

function FormFooter({ onCancel, onSubmit, canSave, isSubmitting, submitLabel }: FormFooterProps) {
	return (
		<div className="flex justify-end gap-2 pt-2 border-t border-border">
			<Button variant="ghost" size="sm" onClick={onCancel}>
				Cancel
			</Button>
			<Button size="sm" onClick={onSubmit} disabled={!canSave || isSubmitting}>
				{isSubmitting ? "Saving..." : submitLabel}
			</Button>
		</div>
	);
}

function WebhookUrlField({
	webhookUrl,
	webhookSecret,
}: { webhookUrl: string; webhookSecret?: string | null }) {
	const { copied: urlCopied, copy: copyUrl } = useCopyToClipboard();
	const { copied: secretCopied, copy: copySecret } = useCopyToClipboard();

	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<Label className="text-xs text-muted-foreground">Webhook URL</Label>
				<div className="flex gap-2">
					<Input value={webhookUrl} readOnly className="h-8 text-xs font-mono" />
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 px-2"
						onClick={() => copyUrl(webhookUrl)}
					>
						{urlCopied ? (
							<Check className="h-4 w-4 text-green-500" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</Button>
				</div>
			</div>
			{webhookSecret && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">Webhook Secret</Label>
					<div className="flex gap-2">
						<Input
							value={webhookSecret}
							readOnly
							type="password"
							className="h-8 text-xs font-mono"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 px-2"
							onClick={() => copySecret(webhookSecret)}
						>
							{secretCopied ? (
								<Check className="h-4 w-4 text-green-500" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

// --- Main Component ---

export function TriggerConfigForm({
	automationId,
	initialProvider,
	initialIntegrationId,
	initialConfig,
	initialCronExpression,
	webhookSecret,
	onSubmit,
	onCancel,
	submitLabel = "Add Trigger",
	isSubmitting = false,
}: TriggerConfigFormProps) {
	// State
	const [provider, setProvider] = useState<Provider | null>(initialProvider || null);
	const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(
		initialIntegrationId || null,
	);
	const [linearConfig, setLinearConfig] = useState<LinearTriggerConfig>(
		(initialConfig as LinearTriggerConfig) || { actionFilters: ["create"] },
	);
	const [sentryConfig, setSentryConfig] = useState<SentryTriggerConfig>(
		(initialConfig as SentryTriggerConfig) || {},
	);
	const [githubConfig, setGithubConfig] = useState<GitHubTriggerConfig>(
		(initialConfig as GitHubTriggerConfig) || { eventTypes: ["issues"], actionFilters: ["opened"] },
	);
	const [posthogConfig, setPosthogConfig] = useState<PostHogTriggerConfig>(
		(initialConfig as PostHogTriggerConfig) || {},
	);
	const [cronExpression, setCronExpression] = useState(initialCronExpression || "0 9 * * *");
	const [requireSignature, setRequireSignature] = useState(
		(initialConfig as { requireSignatureVerification?: boolean })?.requireSignatureVerification ??
			false,
	);
	const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
	const automationWebhookUrl = automationId
		? `${baseUrl}/api/webhooks/automation/${automationId}`
		: null;
	const posthogWebhookUrl = automationId ? `${baseUrl}/api/webhooks/posthog/${automationId}` : null;

	// Fetch metadata
	const { data: linearMetadata, isLoading: linearMetadataLoading } = useLinearMetadata(
		provider === "linear" && selectedIntegrationId ? selectedIntegrationId : "",
		linearConfig.teamId,
	);

	const { data: sentryMetadata, isLoading: sentryMetadataLoading } = useSentryMetadata(
		provider === "sentry" && selectedIntegrationId ? selectedIntegrationId : "",
		sentryConfig.projectSlug,
	);

	const { data: triggerProvidersData } = useTriggerProviders();
	const integrationProviders = (() => {
		if (!triggerProvidersData?.providers) return INTEGRATION_PROVIDERS;
		const available = new Set<Provider>();
		for (const entry of Object.values(triggerProvidersData.providers)) {
			const providerId = entry.provider as Provider;
			if (providerId === "webhook" || providerId === "scheduled" || providerId === "posthog")
				continue;
			available.add(providerId);
		}
		return available.size > 0 ? Array.from(available) : INTEGRATION_PROVIDERS;
	})();

	const disabledProviders: Provider[] = integrationProviders.filter(
		(providerId) => !SUPPORTED_INTEGRATION_PROVIDERS.includes(providerId),
	);

	const handleProviderSelect = (p: Provider) => {
		setProvider(p);
		setSelectedIntegrationId(null);
	};

	const handleSubmit = () => {
		if (!provider) return;

		if (provider === "webhook" || provider === "scheduled") {
			onSubmit({
				provider,
				config: provider === "webhook" ? { requireSignatureVerification: requireSignature } : {},
				cronExpression: provider === "scheduled" ? cronExpression : undefined,
			});
			return;
		}

		if (provider === "posthog") {
			onSubmit({
				provider,
				config: {
					...posthogConfig,
					requireSignatureVerification: requireSignature,
				},
			});
			return;
		}

		if (!selectedIntegrationId) return;

		const config =
			provider === "linear" ? linearConfig : provider === "sentry" ? sentryConfig : githubConfig;
		onSubmit({ provider, integrationId: selectedIntegrationId, config });
	};

	const canSave =
		provider &&
		(provider === "webhook" ||
			provider === "scheduled" ||
			provider === "posthog" ||
			selectedIntegrationId);
	const needsConnection =
		provider &&
		provider !== "webhook" &&
		provider !== "scheduled" &&
		provider !== "posthog" &&
		provider !== "slack";

	return (
		<div className="space-y-4 py-2 min-w-[280px]">
			<ProviderSelector
				provider={provider}
				onSelect={handleProviderSelect}
				integrationProviders={integrationProviders}
				standaloneProviders={STANDALONE_PROVIDERS}
				disabledProviders={disabledProviders}
			/>

			{needsConnection && (
				<div className="space-y-2">
					<Label className="text-xs text-muted-foreground">Connection</Label>
					<ConnectionSelector
						provider={provider}
						selectedId={selectedIntegrationId}
						onSelect={setSelectedIntegrationId}
					/>
				</div>
			)}

			{provider === "linear" && selectedIntegrationId && (
				<LinearConfigSection
					config={linearConfig}
					onChange={setLinearConfig}
					metadata={linearMetadata}
					isLoading={linearMetadataLoading}
				/>
			)}

			{provider === "sentry" && selectedIntegrationId && (
				<SentryConfigSection
					config={sentryConfig}
					onChange={setSentryConfig}
					metadata={sentryMetadata}
					isLoading={sentryMetadataLoading}
				/>
			)}

			{provider === "github" && selectedIntegrationId && (
				<GitHubConfigSection config={githubConfig} onChange={setGithubConfig} />
			)}

			{provider === "posthog" && (
				<PostHogConfigSection config={posthogConfig} onChange={setPosthogConfig} />
			)}

			{provider === "webhook" && (
				<WebhookConfigSection
					webhookUrl={automationWebhookUrl}
					webhookSecret={webhookSecret}
					requireSignature={requireSignature}
					onRequireSignatureChange={setRequireSignature}
					showSecret={requireSignature}
				/>
			)}

			{provider === "posthog" && (
				<WebhookConfigSection
					webhookUrl={posthogWebhookUrl}
					webhookSecret={webhookSecret}
					requireSignature={requireSignature}
					onRequireSignatureChange={setRequireSignature}
					showSecret={true}
				/>
			)}

			{provider === "scheduled" && (
				<ScheduledConfigSection cronExpression={cronExpression} onChange={setCronExpression} />
			)}

			<FormFooter
				onCancel={onCancel}
				onSubmit={handleSubmit}
				canSave={!!canSave}
				isSubmitting={isSubmitting}
				submitLabel={submitLabel}
			/>
		</div>
	);
}
