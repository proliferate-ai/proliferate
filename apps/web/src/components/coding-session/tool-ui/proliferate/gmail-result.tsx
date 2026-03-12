"use client";

import type {
	GmailEmailRow,
	GmailMessageDetail,
	GmailMessageHandlesSummary,
	GmailMutationSummary as GmailMutationSummaryModel,
} from "@/lib/sessions/proliferate/gmail";
import { Mail } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(raw: string | null): string | null {
	if (!raw) return null;
	// Many Gmail dates look like "Thu, 12 Mar 2026 00:11:18 +0000"
	try {
		return new Date(raw).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	} catch {
		return raw;
	}
}

function truncateSender(from: string | null): string | null {
	if (!from) return null;
	// "Display Name <email@example.com>" -> "Display Name"
	const match = from.match(/^([^<]+?)\s*</);
	if (match) return match[1].trim();
	return from;
}

// ---------------------------------------------------------------------------
// messageList: compact list of email rows
// ---------------------------------------------------------------------------

interface GmailMessageListProps {
	rows: GmailEmailRow[];
}

export function GmailMessageList({ rows }: GmailMessageListProps) {
	if (rows.length === 0) return null;

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			{rows.map((row, i) => (
				<div
					key={row.id}
					className={`px-3 py-2 text-xs flex items-start gap-2 ${i > 0 ? "border-t border-border/60" : ""}`}
				>
					<Mail className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/50" />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 justify-between">
							<span className="font-medium text-foreground truncate">
								{truncateSender(row.from) ?? "Unknown sender"}
							</span>
							{row.date && (
								<span className="text-muted-foreground shrink-0">{formatDate(row.date)}</span>
							)}
						</div>
						{row.subject && (
							<div className="text-muted-foreground truncate mt-0.5">{row.subject}</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

interface GmailMessageHandlesSummaryViewProps {
	summary: GmailMessageHandlesSummary;
	label: string;
}

export function GmailMessageHandlesSummaryView({
	summary,
	label,
}: GmailMessageHandlesSummaryViewProps) {
	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			<div className="px-3 py-2.5 text-xs text-muted-foreground">
				<div className="font-medium text-foreground">
					{summary.count} {label}
					{summary.count === 1 ? "" : "s"} returned
				</div>
				<div className="mt-1.5 space-y-1">
					{summary.ids.map((id) => (
						<div key={id} className="font-mono text-[11px] text-muted-foreground/80 truncate">
							{id}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// messageDetail: single message view
// ---------------------------------------------------------------------------

interface GmailMessageDetailViewProps {
	detail: GmailMessageDetail;
}

export function GmailMessageDetailView({ detail }: GmailMessageDetailViewProps) {
	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			<div className="px-3 py-2.5 space-y-1 text-xs">
				{detail.subject && <div className="font-medium text-foreground">{detail.subject}</div>}
				<div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
					{detail.from && (
						<span>
							<span className="text-muted-foreground/60">From </span>
							{truncateSender(detail.from)}
						</span>
					)}
					{detail.to && (
						<span>
							<span className="text-muted-foreground/60">To </span>
							{detail.to}
						</span>
					)}
					{detail.date && (
						<span className="text-muted-foreground/60">{formatDate(detail.date)}</span>
					)}
				</div>
				{detail.snippet && (
					<div className="text-muted-foreground/70 pt-0.5 leading-relaxed">{detail.snippet}</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// mutationSummary: lightweight confirmation for write actions
// ---------------------------------------------------------------------------

interface GmailMutationSummaryProps {
	summary: GmailMutationSummaryModel;
}

export function GmailMutationSummaryView({ summary }: GmailMutationSummaryProps) {
	return (
		<div className="rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-xs text-muted-foreground">
			ID: <span className="font-mono text-foreground/70">{summary.id}</span>
		</div>
	);
}
