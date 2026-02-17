"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { InboxEmpty } from "@/components/inbox/inbox-empty";
import { InboxItem } from "@/components/inbox/inbox-item";
import type { AttentionItem } from "@/hooks/use-attention-inbox";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

type FilterTab = "all" | "needs_help" | "needs_approval";

function getSearchableText(item: AttentionItem): string {
	if (item.type === "approval") {
		const { approval, sessionTitle } = item.data;
		return [approval.action, approval.integration, sessionTitle]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
	}
	const { automation_name, error_message, status } = item.data;
	return [automation_name, error_message, status].filter(Boolean).join(" ").toLowerCase();
}

/** Status-based grouping — each group gets its own section with a header. */
interface StatusGroup {
	key: string;
	label: string;
	items: AttentionItem[];
}

function groupByStatus(items: AttentionItem[]): StatusGroup[] {
	const groups: StatusGroup[] = [];

	// Needs Help — failed, needs_human, timed_out runs
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

	// Waiting for Approval — pending action approvals
	const approvals = items.filter((i) => i.type === "approval");
	if (approvals.length > 0) {
		groups.push({ key: "needs_approval", label: "Waiting for Approval", items: approvals });
	}

	return groups;
}

export default function RunsPage() {
	const items = useAttentionInbox({ wsApprovals: [] });
	const [activeTab, setActiveTab] = useState<FilterTab>("all");
	const [search, setSearch] = useState("");

	// Counts for tabs
	const needsHelpCount = items.filter(
		(i) =>
			i.type === "run" &&
			(i.data.status === "failed" ||
				i.data.status === "needs_human" ||
				i.data.status === "timed_out"),
	).length;
	const approvalCount = items.filter((i) => i.type === "approval").length;

	// Filter + search
	const filtered = useMemo(() => {
		let result = items;

		// Tab filter
		if (activeTab === "needs_help") {
			result = result.filter((i) => i.type === "run");
		} else if (activeTab === "needs_approval") {
			result = result.filter((i) => i.type === "approval");
		}

		// Search filter
		if (search.trim()) {
			const query = search.toLowerCase();
			result = result.filter((item) => getSearchableText(item).includes(query));
		}

		return result;
	}, [items, activeTab, search]);

	const groups = groupByStatus(filtered);

	const tabs: { key: FilterTab; label: string; count: number }[] = [
		{ key: "all", label: "All", count: items.length },
		{ key: "needs_help", label: "Needs Help", count: needsHelpCount },
		{ key: "needs_approval", label: "Approvals", count: approvalCount },
	];

	return (
		<PageShell title="Agent Runs" subtitle="Monitor and triage your automation runs">
			{/* Filter tabs + search */}
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-1">
					{tabs.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							className={cn(
								"flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-sm font-medium transition-colors",
								activeTab === tab.key
									? "bg-secondary text-foreground"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
							)}
						>
							{tab.label}
							<span
								className={cn(
									"inline-flex items-center justify-center px-1.5 min-w-[1.25rem] h-4 rounded-full text-[11px]",
									activeTab === tab.key
										? "bg-foreground/10 text-foreground"
										: "bg-muted text-muted-foreground",
								)}
							>
								{tab.count}
							</span>
						</button>
					))}
				</div>

				{/* Search */}
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<input
						type="text"
						placeholder="Search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 w-44 rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
					/>
				</div>
			</div>

			{/* Content */}
			{items.length === 0 ? (
				<InboxEmpty />
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<p className="text-sm text-muted-foreground">No matching items</p>
				</div>
			) : (
				<div className="flex flex-col gap-5">
					{groups.map((group) => (
						<section key={group.key}>
							{groups.length > 1 && (
								<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2.5">
									{group.label}
								</h2>
							)}
							<div className="flex flex-col gap-2">
								{group.items.map((item) => (
									<InboxItem
										key={item.type === "approval" ? item.data.approval.invocationId : item.data.id}
										item={item}
									/>
								))}
							</div>
						</section>
					))}

					{/* End indicator */}
					<div className="flex items-center justify-center py-4">
						<p className="text-xs text-muted-foreground">
							You've reached the end · {filtered.length} {filtered.length === 1 ? "item" : "items"}{" "}
							total
						</p>
					</div>
				</div>
			)}
		</PageShell>
	);
}
