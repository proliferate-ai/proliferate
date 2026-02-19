"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
	TemplateIconCiFixer,
	TemplateIconGithubSolver,
	TemplateIconLinearPr,
	TemplateIconSentryFixer,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Bug, CircuitBoard, Loader2, Plus, Search, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ====================================================================
// Types
// ====================================================================

type TemplateCategory = "bug-fixing" | "code-quality" | "project-management" | "devops";

interface TemplateTrigger {
	provider: string;
	triggerType: string;
	config: Record<string, unknown>;
	cronExpression?: string;
}

interface IntegrationRequirement {
	provider: string;
	reason: string;
	required: boolean;
}

export interface TemplateEntry {
	id: string;
	name: string;
	description: string;
	longDescription?: string;
	icon: string;
	category: string;
	agentInstructions: string;
	modelId?: string;
	triggers: TemplateTrigger[];
	enabledTools: Record<string, unknown>;
	actionModes?: Record<string, string>;
	requiredIntegrations: IntegrationRequirement[];
	requiresRepo: boolean;
}

// ====================================================================
// Constants
// ====================================================================

const CATEGORY_ORDER: TemplateCategory[] = [
	"bug-fixing",
	"code-quality",
	"project-management",
	"devops",
];

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
	"bug-fixing": "Bug Fixing",
	"code-quality": "Code Quality",
	"project-management": "Project Management",
	devops: "DevOps",
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
	bug: TemplateIconSentryFixer,
	"git-pull-request": TemplateIconLinearPr,
	"circle-dot": TemplateIconGithubSolver,
	"alert-triangle": TemplateIconCiFixer,
	// Fallbacks for future templates
	"circuit-board": CircuitBoard,
	shield: Shield,
};

// ====================================================================
// Template Picker Dialog
// ====================================================================

interface TemplatePickerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	templates: TemplateEntry[];
	connectedProviders: Set<string>;
	onSelectTemplate: (template: TemplateEntry) => void;
	onSelectBlank: () => void;
	isPending?: boolean;
	error?: string | null;
}

export function TemplatePickerDialog({
	open,
	onOpenChange,
	templates,
	connectedProviders,
	onSelectTemplate,
	onSelectBlank,
	isPending,
	error,
}: TemplatePickerDialogProps) {
	const router = useRouter();
	const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | "all">("all");
	const [searchQuery, setSearchQuery] = useState("");

	const availableCategories = useMemo(() => {
		const cats = new Set(templates.map((t) => t.category));
		return CATEGORY_ORDER.filter((c) => cats.has(c));
	}, [templates]);

	const filteredTemplates = useMemo(() => {
		let entries = templates;
		if (selectedCategory !== "all") {
			entries = entries.filter((t) => t.category === selectedCategory);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			entries = entries.filter(
				(t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
			);
		}
		return entries;
	}, [templates, selectedCategory, searchQuery]);

	const categoryLabel =
		selectedCategory === "all"
			? "All templates"
			: CATEGORY_LABELS[selectedCategory as TemplateCategory];

	const getMissingIntegrations = (template: TemplateEntry) => {
		return template.requiredIntegrations.filter(
			(req) => req.required && !connectedProviders.has(req.provider),
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[1100px] max-h-[75vh] p-0 gap-0 rounded-xl overflow-hidden">
				{/* Header */}
				<div className="px-6 py-4 border-b border-border shrink-0">
					<h2 className="text-base font-semibold">New automation</h2>
					{error && <p className="text-xs text-destructive mt-1">{error}</p>}
				</div>

				{/* Body */}
				<div className="flex flex-1 overflow-hidden" style={{ height: "calc(75vh - 65px)" }}>
					{/* Left sidebar */}
					<nav className="w-[240px] py-4 px-3 overflow-y-auto border-r border-border/50 shrink-0">
						<ul className="space-y-1">
							<li>
								<button
									type="button"
									className={cn(
										"w-full text-left px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
										selectedCategory === "all"
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:bg-muted/50",
									)}
									onClick={() => setSelectedCategory("all")}
								>
									All templates
								</button>
							</li>
							{availableCategories.map((cat) => (
								<li key={cat}>
									<button
										type="button"
										className={cn(
											"w-full text-left px-2 py-1.5 rounded-lg text-sm font-medium transition-colors",
											selectedCategory === cat
												? "bg-muted text-foreground"
												: "text-muted-foreground hover:bg-muted/50",
										)}
										onClick={() => setSelectedCategory(cat)}
									>
										{CATEGORY_LABELS[cat]}
									</button>
								</li>
							))}
						</ul>
					</nav>

					{/* Right content */}
					<div className="flex-1 flex flex-col overflow-hidden">
						<div className="px-4 py-4 flex items-center justify-between shrink-0">
							<h3 className="text-sm font-semibold">{categoryLabel}</h3>
							<div className="relative w-1/3">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
								<Input
									placeholder="Search templates..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="h-9 pl-9 text-sm rounded-xl"
								/>
							</div>
						</div>

						<div className="flex-1 overflow-y-auto px-4 pb-5">
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
								{/* Blank automation card — always first */}
								<button
									type="button"
									disabled={isPending}
									className="flex flex-col items-start p-4 pb-3 rounded-xl border border-dashed border-border bg-card hover:border-foreground/20 transition-colors text-left disabled:opacity-50"
									onClick={onSelectBlank}
								>
									<div className="w-8 h-8 rounded-lg border border-border bg-background flex items-center justify-center shrink-0">
										<Plus className="h-4 w-4 text-muted-foreground" />
									</div>
									<div className="flex flex-col gap-1 mt-2 w-full">
										<p className="text-sm font-semibold text-foreground">Blank automation</p>
										<p className="text-xs text-muted-foreground line-clamp-2">
											Start from scratch with an empty configuration.
										</p>
									</div>
								</button>

								{/* Template cards */}
								{filteredTemplates.map((template) => {
									const missing = getMissingIntegrations(template);
									const Icon = ICON_MAP[template.icon] ?? Bug;

									return (
										<button
											key={template.id}
											type="button"
											disabled={isPending}
											className="flex flex-col items-start p-4 pb-3 rounded-xl border border-border bg-card hover:border-foreground/20 transition-colors text-left disabled:opacity-50"
											onClick={() => onSelectTemplate(template)}
										>
											<div className="w-8 h-8 rounded-lg border border-border bg-background flex items-center justify-center p-1 shrink-0">
												<Icon className="h-5 w-5 text-muted-foreground" />
											</div>
											<div className="flex flex-col gap-1 mt-2 w-full">
												<p className="text-sm font-semibold text-foreground">{template.name}</p>
												<p className="text-xs text-muted-foreground line-clamp-2">
													{template.description}
												</p>
											</div>

											{/* Provider badges */}
											<div className="flex flex-col gap-1.5 mt-2 w-full">
												<div className="flex items-center gap-1.5">
													{template.requiredIntegrations.map((req) => {
														const isConnected = connectedProviders.has(req.provider);
														return (
															<div
																key={req.provider}
																className={cn(
																	"flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px]",
																	isConnected
																		? "bg-muted/50 text-muted-foreground"
																		: "border border-dashed border-border text-muted-foreground/50",
																)}
															>
																<ProviderIcon
																	provider={req.provider as Provider}
																	size="sm"
																	className={cn("h-3 w-3", !isConnected && "opacity-50")}
																/>
																{!isConnected && (
																	<span className="text-[10px]">
																		{getProviderDisplayName(req.provider as Provider)}
																	</span>
																)}
															</div>
														);
													})}
												</div>
												{missing.length > 0 && (
													<p className="text-[11px] text-muted-foreground/70">
														Requires{" "}
														{missing
															.map((m) => getProviderDisplayName(m.provider as Provider))
															.join(", ")}
														{" \u00b7 "}
														<span
															role="link"
															tabIndex={0}
															className="underline hover:text-foreground transition-colors cursor-pointer"
															onClick={(e) => {
																e.stopPropagation();
																router.push("/dashboard/integrations");
															}}
															onKeyDown={(e) => {
																if (e.key === "Enter") {
																	e.stopPropagation();
																	router.push("/dashboard/integrations");
																}
															}}
														>
															Connect
														</span>
													</p>
												)}
											</div>
										</button>
									);
								})}
							</div>

							{filteredTemplates.length === 0 && searchQuery.trim() && (
								<div className="flex flex-col items-center justify-center py-12">
									<p className="text-sm text-muted-foreground">No templates match your search.</p>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Loading overlay */}
				{isPending && (
					<div className="absolute inset-0 flex items-center justify-center bg-background/50">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
