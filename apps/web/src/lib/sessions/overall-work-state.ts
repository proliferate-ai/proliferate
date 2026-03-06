import type { CreatorFilter, FilterTab, OriginFilter } from "@/config/sessions";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { type OverallWorkState, deriveOverallWorkState } from "@proliferate/shared/sessions";

export interface DerivedSessionState {
	overallWorkState: OverallWorkState;
	needsAttention: boolean;
	isLive: boolean;
}

export interface SessionListEntry {
	session: Session;
	origin: OriginFilter;
	derived: DerivedSessionState;
}

export interface SessionListResult {
	filtered: Session[];
	counts: Record<FilterTab, number>;
	totalCount: number;
	visibleHasLive: boolean;
}

export function getSessionOrigin(
	session: {
		automationId?: string | null;
		origin?: string | null;
		clientType?: string | null;
	},
	automationOriginValue: OriginFilter,
): OriginFilter {
	if (session.automationId) return automationOriginValue;
	if (session.origin === "slack" || session.clientType === "slack") return "slack";
	if (session.origin === "cli" || session.clientType === "cli") return "cli";
	return "manual";
}

export function hasUnreadUpdate(session: Session): boolean {
	return session.hasUnreadUpdate ?? session.unread ?? false;
}

export function deriveSessionState(
	session: Session,
	pendingRun?: PendingRunSummary,
): DerivedSessionState {
	const overallWorkState = deriveOverallWorkState(session.status, hasUnreadUpdate(session));
	const needsAttention =
		overallWorkState === "needs_input" || session.status.requiresHumanReview || Boolean(pendingRun);
	const isLive =
		session.status.terminalState === null &&
		(session.status.sandboxState === "running" || session.status.sandboxState === "provisioning");
	return { overallWorkState, needsAttention, isLive };
}

export function sortSessionEntries<T extends SessionListEntry>(items: T[]): T[] {
	const priority = (entry: SessionListEntry) => {
		if (entry.derived.needsAttention) return 0;
		switch (entry.derived.overallWorkState) {
			case "working":
				return 1;
			case "needs_input":
				return 2;
			case "dormant":
				return 3;
			case "done":
				return 4;
			default:
				return 5;
		}
	};

	return [...items].sort(
		(a, b) =>
			priority(a) - priority(b) ||
			new Date(b.session.lastActivityAt ?? 0).getTime() -
				new Date(a.session.lastActivityAt ?? 0).getTime(),
	);
}

function matchesTab(entry: SessionListEntry, tab: FilterTab): boolean {
	switch (tab) {
		case "in_progress":
			return entry.derived.overallWorkState === "working";
		case "needs_attention":
			return entry.derived.needsAttention;
		case "paused":
			return entry.derived.overallWorkState === "dormant";
		case "completed":
			return entry.derived.overallWorkState === "done";
		default:
			return false;
	}
}

function matchesSearch(session: Session, query: string): boolean {
	if (!query.trim()) return true;
	const q = query.toLowerCase().trim();
	const title = session.title?.toLowerCase() ?? "";
	const repo = session.repo?.githubRepoName?.toLowerCase() ?? "";
	const branch = session.branchName?.toLowerCase() ?? "";
	const automationName = session.automation?.name?.toLowerCase() ?? "";
	const snippet = session.promptSnippet?.toLowerCase() ?? "";
	return (
		title.includes(q) ||
		repo.includes(q) ||
		branch.includes(q) ||
		automationName.includes(q) ||
		snippet.includes(q)
	);
}

export function buildSessionListResult({
	sessions,
	activeTab,
	searchQuery,
	originFilter,
	creatorFilter,
	currentUserId,
	automationOriginValue,
	pendingRunsBySession,
	enableSorting,
}: {
	sessions: Session[] | undefined;
	activeTab: FilterTab;
	searchQuery: string;
	originFilter: OriginFilter;
	creatorFilter?: CreatorFilter;
	currentUserId?: string;
	automationOriginValue: OriginFilter;
	pendingRunsBySession: Map<string, PendingRunSummary>;
	enableSorting?: boolean;
}): SessionListResult {
	const baseSessions =
		sessions?.filter((session) => !session.kind || session.kind === "task") ?? [];

	const creatorFiltered =
		creatorFilter === "mine" && currentUserId
			? baseSessions.filter((session) => session.createdBy === currentUserId)
			: baseSessions;

	const entries = creatorFiltered
		.map((session) => {
			const origin = getSessionOrigin(session, automationOriginValue);
			const derived = deriveSessionState(session, pendingRunsBySession.get(session.id));
			return { session, origin, derived };
		})
		.filter((entry) => originFilter === "all" || entry.origin === originFilter);

	const counts: Record<FilterTab, number> = {
		in_progress: 0,
		needs_attention: 0,
		paused: 0,
		completed: 0,
	};

	for (const entry of entries) {
		if (matchesTab(entry, "needs_attention")) {
			counts.needs_attention += 1;
		} else if (matchesTab(entry, "in_progress")) {
			counts.in_progress += 1;
		} else if (matchesTab(entry, "paused")) {
			counts.paused += 1;
		} else if (matchesTab(entry, "completed")) {
			counts.completed += 1;
		}
	}

	const tabFiltered = entries.filter((entry) => matchesTab(entry, activeTab));
	const searched = tabFiltered.filter((entry) => matchesSearch(entry.session, searchQuery));
	const ranked = enableSorting ? sortSessionEntries(searched) : searched;

	return {
		filtered: ranked.map((entry) => entry.session),
		counts,
		totalCount: baseSessions.length,
		visibleHasLive: ranked.some((entry) => entry.derived.isLive),
	};
}
