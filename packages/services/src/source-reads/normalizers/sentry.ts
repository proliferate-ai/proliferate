/**
 * Sentry source normalizer.
 *
 * Fetches issues from the Sentry API and normalizes them into the common
 * source item format. Uses the /api/0/projects/{org}/{project}/issues/ endpoint.
 *
 * sourceRef format: "{org_slug}/{project_slug}" or "{org_slug}" for org-wide.
 */

import { getServicesLogger } from "../../logger";
import type { NormalizedSourceItem, SourceNormalizer, SourceQueryResult } from "./types";

const SENTRY_API_BASE = "https://sentry.io/api/0";

const SEVERITY_ORDER: Record<string, number> = {
	debug: 0,
	info: 1,
	warning: 2,
	error: 3,
	fatal: 4,
};

function normalizeSeverity(level?: string): string | null {
	if (!level) return null;
	const lower = level.toLowerCase();
	return lower in SEVERITY_ORDER ? lower : null;
}

interface SentryIssue {
	id: string;
	title?: string;
	culprit?: string;
	shortId?: string;
	metadata?: { type?: string; value?: string; filename?: string };
	status?: string;
	level?: string;
	platform?: string;
	count?: string;
	firstSeen?: string;
	lastSeen?: string;
	project?: { id?: string; name?: string; slug?: string };
	permalink?: string;
	assignedTo?: { type?: string; id?: string; name?: string; email?: string } | null;
}

function normalizeIssue(issue: SentryIssue, sourceRef: string): NormalizedSourceItem {
	return {
		sourceType: "sentry",
		sourceRef: issue.id,
		title: issue.title ?? "Untitled Issue",
		body: issue.metadata?.value ?? issue.culprit ?? null,
		severity: normalizeSeverity(issue.level),
		priority: null,
		status: issue.status ?? null,
		url: issue.permalink ?? null,
		createdAt: issue.firstSeen ?? null,
		updatedAt: issue.lastSeen ?? null,
		metadata: {
			shortId: issue.shortId,
			platform: issue.platform,
			eventCount: issue.count,
			project: issue.project?.slug,
			bindingRef: sourceRef,
			assignee: issue.assignedTo?.name ?? null,
			exceptionType: issue.metadata?.type ?? null,
			filename: issue.metadata?.filename ?? null,
		},
	};
}

export class SentryNormalizer implements SourceNormalizer {
	readonly sourceType = "sentry" as const;

	async query(
		token: string,
		sourceRef: string,
		cursor?: string,
		limit = 25,
	): Promise<SourceQueryResult> {
		const log = getServicesLogger().child({ module: "sentry-normalizer" });

		// sourceRef is "org_slug/project_slug" or "org_slug"
		const parts = sourceRef.split("/");
		const orgSlug = parts[0];
		const projectSlug = parts[1];

		let url: string;
		if (projectSlug) {
			url = `${SENTRY_API_BASE}/projects/${orgSlug}/${projectSlug}/issues/`;
		} else {
			url = `${SENTRY_API_BASE}/organizations/${orgSlug}/issues/`;
		}

		const params = new URLSearchParams({ limit: String(limit) });
		if (cursor) {
			params.set("cursor", cursor);
		}

		const response = await fetch(`${url}?${params}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			log.error({ status: response.status, sourceRef }, "Sentry API request failed");
			throw new Error(`Sentry API error: ${response.status}`);
		}

		const issues = (await response.json()) as SentryIssue[];

		// Parse Link header for cursor-based pagination
		const linkHeader = response.headers.get("Link");
		let nextCursor: string | null = null;
		let hasMore = false;
		if (linkHeader) {
			const nextMatch = linkHeader.match(
				/<[^>]+\?[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/,
			);
			if (nextMatch) {
				nextCursor = nextMatch[1];
				hasMore = true;
			}
		}

		return {
			items: issues.map((issue) => normalizeIssue(issue, sourceRef)),
			cursor: nextCursor,
			hasMore,
		};
	}

	async getItem(
		token: string,
		sourceRef: string,
		itemRef: string,
	): Promise<NormalizedSourceItem | null> {
		const log = getServicesLogger().child({ module: "sentry-normalizer" });

		// itemRef is the Sentry issue ID
		const parts = sourceRef.split("/");
		const orgSlug = parts[0];

		const url = `${SENTRY_API_BASE}/organizations/${orgSlug}/issues/${itemRef}/`;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			if (response.status === 404) return null;
			log.error({ status: response.status, sourceRef, itemRef }, "Sentry API get item failed");
			throw new Error(`Sentry API error: ${response.status}`);
		}

		const issue = (await response.json()) as SentryIssue;
		return normalizeIssue(issue, sourceRef);
	}
}
