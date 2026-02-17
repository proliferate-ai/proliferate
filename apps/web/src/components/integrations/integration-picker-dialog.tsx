"use client";

import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";

// ====================================================================
// Shared types & constants (used by page + detail dialog)
// ====================================================================

export type IntegrationCategory =
	| "source-control"
	| "monitoring"
	| "project-management"
	| "communication"
	| "developer-tools";

export interface CatalogEntry {
	key: string;
	name: string;
	description: string;
	category: IntegrationCategory;
	type: "oauth" | "slack" | "adapter" | "mcp-preset";
	provider?: Provider;
	presetKey?: string;
	adapterKey?: "linear" | "sentry";
}

export const CATEGORY_ORDER: IntegrationCategory[] = [
	"source-control",
	"monitoring",
	"project-management",
	"communication",
	"developer-tools",
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
	"source-control": "Source Control",
	monitoring: "Monitoring",
	"project-management": "Project Management",
	communication: "Communication",
	"developer-tools": "Developer Tools",
};

// ====================================================================
// Picker dialog
// ====================================================================

interface IntegrationPickerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	catalog: CatalogEntry[];
	onSelectEntry: (entry: CatalogEntry) => void;
	getConnectionStatus: (entry: CatalogEntry) => boolean;
}

export function IntegrationPickerDialog({
	open,
	onOpenChange,
	catalog,
	onSelectEntry,
	getConnectionStatus,
}: IntegrationPickerDialogProps) {
	const [selectedCategory, setSelectedCategory] = useState<IntegrationCategory | "all">("all");
	const [searchQuery, setSearchQuery] = useState("");

	const availableCategories = useMemo(() => {
		const cats = new Set(catalog.map((e) => e.category));
		return CATEGORY_ORDER.filter((c) => cats.has(c));
	}, [catalog]);

	const filteredEntries = useMemo(() => {
		let entries = catalog;
		if (selectedCategory !== "all") {
			entries = entries.filter((e) => e.category === selectedCategory);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			entries = entries.filter(
				(e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
			);
		}
		return entries;
	}, [catalog, selectedCategory, searchQuery]);

	const categoryLabel =
		selectedCategory === "all" ? "All integrations" : CATEGORY_LABELS[selectedCategory];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[1100px] max-h-[75vh] p-0 gap-0 rounded-xl overflow-hidden">
				{/* Header */}
				<div className="px-6 py-4 border-b border-border shrink-0">
					<h2 className="text-base font-semibold">Add integration</h2>
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
									All integrations
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
									placeholder="Search integrations..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="h-9 pl-9 text-sm rounded-xl"
								/>
							</div>
						</div>

						<div className="flex-1 overflow-y-auto px-4 pb-5">
							{filteredEntries.length === 0 ? (
								<EmptySearchState searchQuery={searchQuery} />
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
									{filteredEntries.map((entry) => {
										const isConnected = getConnectionStatus(entry);
										return (
											<button
												key={entry.key}
												type="button"
												className="flex flex-col items-start p-4 pb-3 rounded-xl border border-border bg-card hover:border-foreground/20 transition-colors text-left"
												onClick={() => onSelectEntry(entry)}
											>
												<div className="relative">
													<div className="w-8 h-8 rounded-lg border border-border bg-background flex items-center justify-center p-1 shrink-0">
														{entry.type === "mcp-preset" && entry.presetKey ? (
															<ConnectorIcon presetKey={entry.presetKey} size="md" />
														) : entry.provider ? (
															<ProviderIcon provider={entry.provider} size="md" />
														) : null}
													</div>
													{isConnected && (
														<div className="absolute -right-1 -top-1 rounded-full bg-card">
															<CheckCircle2 className="h-4 w-4 text-foreground" />
														</div>
													)}
												</div>
												<div className="flex flex-col gap-1 mt-2 w-full">
													<p className="text-sm font-semibold text-foreground">{entry.name}</p>
													<p className="text-xs text-muted-foreground line-clamp-2">
														{entry.description}
													</p>
												</div>
											</button>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ====================================================================
// Empty search state with request form
// ====================================================================

function EmptySearchState({ searchQuery }: { searchQuery: string }) {
	const [requestValue, setRequestValue] = useState(searchQuery);
	const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

	const handleSubmit = async () => {
		if (!requestValue.trim() || status === "sending") return;
		setStatus("sending");
		try {
			await orpc.integrations.requestIntegration.call({
				integrationName: requestValue.trim(),
			});
			setStatus("sent");
		} catch {
			setStatus("idle");
		}
	};

	return (
		<div className="flex flex-col items-center justify-center py-12 gap-4">
			<p className="text-sm text-muted-foreground">No integrations found</p>

			{status === "sent" ? (
				<div className="flex flex-col items-center gap-1.5 mt-2">
					<div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
						<CheckCircle2 className="h-4 w-4" />
						Request sent
					</div>
					<p className="text-xs text-muted-foreground">
						We'll review your request and get back to you.
					</p>
				</div>
			) : (
				<div className="flex flex-col items-center gap-2 mt-2 w-full max-w-xs">
					<p className="text-xs text-muted-foreground text-center">
						Can't find what you need? Request an integration.
					</p>
					<div className="flex items-center gap-2 w-full">
						<Input
							placeholder="Integration name..."
							value={requestValue}
							onChange={(e) => setRequestValue(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
							className="h-9 text-sm rounded-xl flex-1"
							disabled={status === "sending"}
						/>
						<Button
							size="sm"
							className="rounded-xl shrink-0"
							onClick={handleSubmit}
							disabled={!requestValue.trim() || status === "sending"}
						>
							{status === "sending" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<>
									<Send className="h-3.5 w-3.5 mr-1.5" />
									Request
								</>
							)}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
