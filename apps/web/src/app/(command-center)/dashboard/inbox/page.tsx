"use client";

import { InboxEmpty } from "@/components/inbox/inbox-empty";
import { InboxItem } from "@/components/inbox/inbox-item";
import type { AttentionItem, BlockedGroup } from "@/hooks/use-attention-inbox";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { getRunStatusDisplay } from "@/lib/run-status";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import type { PendingRunSummary } from "@proliferate/shared";
import { AlertOctagon, Search, Shield } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

// ============================================
// Types & Helpers
// ============================================

type TypeFilter = "all" | "runs" | "approvals" | "blocked";

function getItemId(item: AttentionItem): string {
	if (item.type === "approval") return item.data.approval.invocationId;
	if (item.type === "blocked") return `blocked-${item.data.reason}`;
	return item.data.id;
}

function getSearchableText(item: AttentionItem): string {
	if (item.type === "approval") {
		const { approval, sessionTitle } = item.data;
		return [approval.action, approval.integration, sessionTitle]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
	}
	if (item.type === "blocked") {
		return [item.data.reason, "blocked", "sessions"].join(" ").toLowerCase();
	}
	const { automation_name, error_message, status } = item.data;
	return [automation_name, error_message, status].filter(Boolean).join(" ").toLowerCase();
}

/** Group items by status type for the queue list. */
interface StatusGroup {
	key: string;
	label: string;
	items: AttentionItem[];
}

function groupByStatus(items: AttentionItem[]): StatusGroup[] {
	const groups: StatusGroup[] = [];

	// Blocked sessions first (org-level urgency)
	const blocked = items.filter((i) => i.type === "blocked");
	if (blocked.length > 0) {
		groups.push({ key: "blocked", label: "Blocked Sessions", items: blocked });
	}

	const needsHelp = items.filter(
		(i) =>
			i.type === "run" &&
			(i.data.status === "failed" ||
				i.data.status === "needs_human" ||
				i.data.status === "timed_out"),
	);
	if (needsHelp.length > 0) {
		groups.push({ key: "needs_help", label: "Needs Help", items: needsHelp });
	}

	const approvals = items.filter((i) => i.type === "approval");
	if (approvals.length > 0) {
		groups.push({ key: "needs_approval", label: "Waiting for Approval", items: approvals });
	}

	return groups;
}

// ============================================
// Filters
// ============================================

function deriveIntegrations(items: AttentionItem[]): string[] {
	const set = new Set<string>();
	for (const item of items) {
		if (item.type === "approval") {
			set.add(item.data.approval.integration);
		}
	}
	return [...set].sort();
}

function deriveRiskLevels(items: AttentionItem[]): string[] {
	const set = new Set<string>();
	for (const item of items) {
		if (item.type === "approval" && item.data.approval.riskLevel) {
			set.add(item.data.approval.riskLevel);
		}
	}
	return [...set].sort();
}

function deriveAutomations(items: AttentionItem[]): string[] {
	const set = new Set<string>();
	for (const item of items) {
		if (item.type === "run") {
			set.add(item.data.automation_name);
		}
	}
	return [...set].sort();
}

// ============================================
// Queue Row (left column item)
// ============================================

function QueueRow({
	item,
	selected,
	onClick,
}: {
	item: AttentionItem;
	selected: boolean;
	onClick: () => void;
}) {
	if (item.type === "approval") {
		const { approval, sessionTitle } = item.data;
		const timeAgo = approval.expiresAt ? formatRelativeTime(approval.expiresAt) : null;

		return (
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"flex items-center gap-2.5 w-full px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm text-left last:border-0",
					selected && "bg-muted/50",
				)}
			>
				<Shield className="h-4 w-4 shrink-0 text-amber-500" />
				<div className="min-w-0 flex-1">
					<span className="text-sm font-medium text-foreground truncate block">
						{approval.action}
					</span>
					<span className="text-xs text-muted-foreground truncate block">
						{[approval.integration, sessionTitle, timeAgo].filter(Boolean).join(" · ")}
					</span>
				</div>
			</button>
		);
	}

	if (item.type === "blocked") {
		const group = item.data as BlockedGroup;
		return (
			<button
				type="button"
				onClick={onClick}
				className={cn(
					"flex items-center gap-2.5 w-full px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm text-left last:border-0",
					selected && "bg-muted/50",
				)}
			>
				<AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />
				<div className="min-w-0 flex-1">
					<span className="text-sm font-medium text-foreground truncate block">
						{group.count} session{group.count !== 1 ? "s" : ""} blocked
					</span>
					<span className="text-xs text-muted-foreground truncate block">{group.reason}</span>
				</div>
			</button>
		);
	}

	const run = item.data as PendingRunSummary;
	const statusInfo = getRunStatusDisplay(run.status);
	const StatusIcon = statusInfo.icon;
	const timeAgo = run.completed_at
		? formatRelativeTime(run.completed_at)
		: formatRelativeTime(run.queued_at);

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-2.5 w-full px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm text-left last:border-0",
				selected && "bg-muted/50",
			)}
		>
			<StatusIcon className={cn("h-4 w-4 shrink-0", statusInfo.className)} />
			<div className="min-w-0 flex-1">
				<span className="text-sm font-medium text-foreground truncate block">
					{run.automation_name}
				</span>
				<span className="text-xs text-muted-foreground truncate block">
					{[statusInfo.label, timeAgo].filter(Boolean).join(" · ")}
				</span>
			</div>
		</button>
	);
}

// ============================================
// Triage Card (right column detail)
// ============================================

function TriageCard({ item }: { item: AttentionItem }) {
	return (
		<div className="p-6 max-w-2xl">
			<InboxItem item={item} />
		</div>
	);
}

// ============================================
// Filter Pill
// ============================================

function FilterPill({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"px-2.5 h-7 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
				active
					? "bg-secondary text-foreground"
					: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
			)}
		>
			{label}
		</button>
	);
}

// ============================================
// Main Inbox Content (needs Suspense wrapper for useSearchParams)
// ============================================

function InboxContent() {
	const items = useAttentionInbox({ wsApprovals: [] });
	const searchParams = useSearchParams();
	const router = useRouter();

	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [integrationFilter, setIntegrationFilter] = useState<string | null>(null);
	const [riskFilter, setRiskFilter] = useState<string | null>(null);
	const [automationFilter, setAutomationFilter] = useState<string | null>(null);

	const selectedId = searchParams.get("id");

	// Derived filter options
	const integrations = useMemo(() => deriveIntegrations(items), [items]);
	const riskLevels = useMemo(() => deriveRiskLevels(items), [items]);
	const automations = useMemo(() => deriveAutomations(items), [items]);

	// Apply all filters
	const filtered = useMemo(() => {
		// Runs are already filtered to unassigned at the DB level
		let result = [...items];

		// Type filter
		if (typeFilter === "runs") {
			result = result.filter((i) => i.type === "run");
		} else if (typeFilter === "approvals") {
			result = result.filter((i) => i.type === "approval");
		} else if (typeFilter === "blocked") {
			result = result.filter((i) => i.type === "blocked");
		}

		// Integration filter
		if (integrationFilter) {
			result = result.filter(
				(i) => i.type === "approval" && i.data.approval.integration === integrationFilter,
			);
		}

		// Risk filter
		if (riskFilter) {
			result = result.filter(
				(i) => i.type === "approval" && i.data.approval.riskLevel === riskFilter,
			);
		}

		// Automation filter
		if (automationFilter) {
			result = result.filter(
				(i) => i.type === "run" && i.data.automation_name === automationFilter,
			);
		}

		// Text search
		if (search.trim()) {
			const query = search.toLowerCase();
			result = result.filter((item) => getSearchableText(item).includes(query));
		}

		return result;
	}, [items, typeFilter, integrationFilter, riskFilter, automationFilter, search]);

	const groups = groupByStatus(filtered);

	// Find selected item — default to first if none specified
	const selectedItem = useMemo(() => {
		if (filtered.length === 0) return null;
		if (selectedId) {
			const found = filtered.find((item) => getItemId(item) === selectedId);
			if (found) return found;
		}
		return filtered[0];
	}, [filtered, selectedId]);

	const handleSelectItem = (item: AttentionItem) => {
		const id = getItemId(item);
		const params = new URLSearchParams(searchParams.toString());
		params.set("id", id);
		router.replace(`/dashboard/inbox?${params.toString()}`, { scroll: false });
	};

	// Show active filters
	const hasFilters = typeFilter !== "all" || integrationFilter || riskFilter || automationFilter;

	return (
		<div className="flex-1 flex overflow-hidden">
			{/* Left panel — queue list */}
			<div className="w-80 border-r border-border flex flex-col overflow-hidden shrink-0">
				{/* Search */}
				<div className="p-3 border-b border-border/50 space-y-2">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
						<input
							type="text"
							placeholder="Search inbox..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
						/>
					</div>

					{/* Type filter */}
					<div className="flex gap-1 flex-wrap">
						<FilterPill
							label="All"
							active={typeFilter === "all"}
							onClick={() => {
								setTypeFilter("all");
								setIntegrationFilter(null);
								setRiskFilter(null);
								setAutomationFilter(null);
							}}
						/>
						<FilterPill
							label="Approvals"
							active={typeFilter === "approvals"}
							onClick={() => {
								setTypeFilter("approvals");
								setAutomationFilter(null);
							}}
						/>
						<FilterPill
							label="Runs"
							active={typeFilter === "runs"}
							onClick={() => {
								setTypeFilter("runs");
								setIntegrationFilter(null);
								setRiskFilter(null);
							}}
						/>
						<FilterPill
							label="Blocked"
							active={typeFilter === "blocked"}
							onClick={() => {
								setTypeFilter("blocked");
								setIntegrationFilter(null);
								setRiskFilter(null);
								setAutomationFilter(null);
							}}
						/>
					</div>

					{/* Contextual filters */}
					{(typeFilter === "all" || typeFilter === "approvals") && integrations.length > 0 && (
						<div className="flex gap-1 flex-wrap">
							{integrations.map((name) => (
								<FilterPill
									key={name}
									label={name}
									active={integrationFilter === name}
									onClick={() => setIntegrationFilter(integrationFilter === name ? null : name)}
								/>
							))}
						</div>
					)}

					{(typeFilter === "all" || typeFilter === "approvals") && riskLevels.length > 0 && (
						<div className="flex gap-1 flex-wrap">
							{riskLevels.map((level) => (
								<FilterPill
									key={level}
									label={level}
									active={riskFilter === level}
									onClick={() => setRiskFilter(riskFilter === level ? null : level)}
								/>
							))}
						</div>
					)}

					{(typeFilter === "all" || typeFilter === "runs") && automations.length > 0 && (
						<div className="flex gap-1 flex-wrap">
							{automations.map((name) => (
								<FilterPill
									key={name}
									label={name}
									active={automationFilter === name}
									onClick={() => setAutomationFilter(automationFilter === name ? null : name)}
								/>
							))}
						</div>
					)}

					{hasFilters && (
						<button
							type="button"
							onClick={() => {
								setTypeFilter("all");
								setIntegrationFilter(null);
								setRiskFilter(null);
								setAutomationFilter(null);
							}}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Clear filters
						</button>
					)}
				</div>

				{/* Scrollable queue */}
				<div className="flex-1 overflow-y-auto">
					{items.length === 0 ? (
						<InboxEmpty />
					) : filtered.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-16 text-center px-4">
							<p className="text-sm text-muted-foreground">No matching items</p>
						</div>
					) : (
						groups.map((group) => (
							<div key={group.key}>
								<div className="px-4 py-2 bg-muted/30 border-b border-border/50">
									<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
										{group.label} ({group.items.length})
									</span>
								</div>
								{group.items.map((item) => (
									<QueueRow
										key={getItemId(item)}
										item={item}
										selected={selectedItem ? getItemId(item) === getItemId(selectedItem) : false}
										onClick={() => handleSelectItem(item)}
									/>
								))}
							</div>
						))
					)}
				</div>
			</div>

			{/* Right panel — triage detail */}
			<div className="flex-1 overflow-y-auto">
				{selectedItem ? (
					<TriageCard item={selectedItem} />
				) : items.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<InboxEmpty />
					</div>
				) : (
					<div className="flex items-center justify-center h-full text-sm text-muted-foreground">
						Select an item to view details
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================
// Page (with Suspense for useSearchParams)
// ============================================

export default function InboxPage() {
	return (
		<Suspense>
			<InboxContent />
		</Suspense>
	);
}
