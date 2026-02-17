"use client";

import { AutomationListRow } from "@/components/automations/automation-list-row";
import {
	type TemplateEntry,
	TemplatePickerDialog,
} from "@/components/automations/template-picker-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { useCreateFromTemplate, useTemplateCatalog } from "@/hooks/use-templates";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Tab = "all" | "active" | "paused";

const TABS: { value: Tab; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "active", label: "Active" },
	{ value: "paused", label: "Paused" },
];

export default function AutomationsPage() {
	const router = useRouter();
	const { data: automations = [], isLoading } = useAutomations();
	const createAutomation = useCreateAutomation();
	const createFromTemplate = useCreateFromTemplate();
	const { data: templateCatalog = [] } = useTemplateCatalog();

	// Fetch org integrations for connection status badges
	const { data: integrationsData } = useQuery({
		...orpc.integrations.list.queryOptions({ input: undefined }),
	});

	const connectedProviders = useMemo(() => {
		const providers = new Set<string>();
		if (!integrationsData) return providers;
		if (integrationsData.github.connected) providers.add("github");
		if (integrationsData.sentry.connected) providers.add("sentry");
		if (integrationsData.linear.connected) providers.add("linear");
		// Check for active Slack installations via the integrations list
		const hasSlack = integrationsData.integrations.some(
			(i) => i.provider === "slack" && i.status === "active",
		);
		if (hasSlack) providers.add("slack");
		return providers;
	}, [integrationsData]);

	const [activeTab, setActiveTab] = useState<Tab>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [pickerOpen, setPickerOpen] = useState(false);

	const counts = useMemo(
		() => ({
			all: automations.length,
			active: automations.filter((a) => a.enabled).length,
			paused: automations.filter((a) => !a.enabled).length,
		}),
		[automations],
	);

	const filteredAutomations = useMemo(() => {
		let result = automations;

		if (activeTab === "active") {
			result = result.filter((a) => a.enabled);
		} else if (activeTab === "paused") {
			result = result.filter((a) => !a.enabled);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			result = result.filter((a) => a.name.toLowerCase().includes(q));
		}

		return result;
	}, [automations, activeTab, searchQuery]);

	const handleBlankCreate = async () => {
		try {
			const automation = await createAutomation.mutateAsync({});
			setPickerOpen(false);
			router.push(`/dashboard/automations/${automation.id}`);
		} catch {
			// mutation handles error state
		}
	};

	const handleTemplateSelect = async (template: TemplateEntry) => {
		// Build integration bindings from connected providers
		const integrationBindings: Record<string, string> = {};
		if (integrationsData) {
			for (const req of template.requiredIntegrations) {
				// Find the first active integration for this provider
				const integration = integrationsData.integrations.find(
					(i) => i.provider === req.provider && i.status === "active",
				);
				if (integration) {
					integrationBindings[req.provider] = integration.id;
				}
			}
		}

		try {
			const automation = await createFromTemplate.mutateAsync({
				templateId: template.id,
				integrationBindings,
			});
			setPickerOpen(false);
			router.push(`/dashboard/automations/${automation.id}`);
		} catch {
			// mutation handles error state
		}
	};

	const isPending = createAutomation.isPending || createFromTemplate.isPending;

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="max-w-4xl mx-auto px-6 py-6">
				<div className="flex items-center justify-end mb-4">
					<Button onClick={() => setPickerOpen(true)} disabled={isPending} size="sm">
						<Plus className="h-4 w-4 mr-1.5" />
						New
					</Button>
				</div>
				{isLoading ? (
					<div className="rounded-xl border border-border overflow-hidden">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-12 border-b border-border/50 last:border-0 animate-pulse bg-muted/30"
							/>
						))}
					</div>
				) : automations.length === 0 ? (
					<div className="flex flex-col items-center py-16">
						<h2 className="text-base font-semibold text-foreground mb-1">
							Get started with a template
						</h2>
						<p className="text-sm text-muted-foreground mb-8">
							Pick a template to create your first automation, or start from scratch.
						</p>
						<Button onClick={() => setPickerOpen(true)} disabled={isPending} size="sm">
							<Plus className="h-4 w-4 mr-1.5" />
							Browse templates
						</Button>
					</div>
				) : (
					<>
						{/* Tabs + Search */}
						<div className="flex items-center justify-between gap-4 mb-4">
							<div className="flex items-center gap-1">
								{TABS.map((tab) => (
									<button
										key={tab.value}
										type="button"
										onClick={() => setActiveTab(tab.value)}
										className={cn(
											"flex items-center gap-1.5 px-3 h-7 text-sm rounded-lg transition-colors",
											activeTab === tab.value
												? "bg-card text-foreground font-medium shadow-subtle border border-border/50"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{tab.label}
										<span
											className={cn(
												"text-xs tabular-nums px-1.5 rounded-full",
												activeTab === tab.value
													? "bg-muted text-muted-foreground"
													: "bg-muted/50 text-muted-foreground/70",
											)}
										>
											{counts[tab.value]}
										</span>
									</button>
								))}
							</div>
							<div className="relative">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
								<Input
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search"
									className="h-8 w-48 pl-8 text-sm bg-muted/50 border-0"
								/>
							</div>
						</div>

						{/* List */}
						{filteredAutomations.length === 0 ? (
							<div className="text-center py-12">
								<p className="text-sm text-muted-foreground">
									{searchQuery.trim()
										? "No automations match your search."
										: `No ${activeTab} automations.`}
								</p>
							</div>
						) : (
							<div className="rounded-xl border border-border overflow-hidden">
								{/* Column headers */}
								<div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
									<div className="flex-1 min-w-0">Name</div>
									<div className="hidden sm:block w-16 shrink-0">Scope</div>
									<div className="hidden md:block w-28 shrink-0">Triggers</div>
									<div className="hidden md:block w-24 shrink-0">Actions</div>
									<div className="hidden lg:block w-16 shrink-0 text-right">Created</div>
									<div className="w-16 shrink-0 text-right">Updated</div>
								</div>
								{filteredAutomations.map((automation) => (
									<AutomationListRow
										key={automation.id}
										id={automation.id}
										name={automation.name}
										enabled={automation.enabled}
										createdAt={automation.created_at}
										updatedAt={automation.updated_at}
										triggerCount={automation._count.triggers}
										scheduleCount={automation._count.schedules}
										activeProviders={automation.activeProviders}
										enabledTools={automation.enabled_tools}
									/>
								))}
							</div>
						)}
					</>
				)}
			</div>

			{/* Template picker modal */}
			<TemplatePickerDialog
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				templates={templateCatalog}
				connectedProviders={connectedProviders}
				onSelectTemplate={handleTemplateSelect}
				onSelectBlank={handleBlankCreate}
				isPending={isPending}
			/>
		</div>
	);
}
