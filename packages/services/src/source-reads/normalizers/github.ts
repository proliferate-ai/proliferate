/**
 * GitHub source normalizer.
 *
 * Fetches issues and pull requests from the GitHub REST API and normalizes
 * them into the common source item format.
 *
 * sourceRef format: "{owner}/{repo}" (e.g. "acme/my-app").
 */

import { getServicesLogger } from "../../logger";
import type { NormalizedSourceItem, SourceNormalizer, SourceQueryResult } from "./types";

const GITHUB_API_BASE = "https://api.github.com";

interface GitHubIssue {
	id: number;
	number: number;
	title?: string;
	body?: string;
	state?: string;
	html_url?: string;
	created_at?: string;
	updated_at?: string;
	labels?: Array<{ name?: string }>;
	assignee?: { login?: string } | null;
	assignees?: Array<{ login?: string }>;
	pull_request?: { url?: string; html_url?: string; merged_at?: string | null };
	user?: { login?: string };
	milestone?: { title?: string } | null;
}

function normalizeIssue(issue: GitHubIssue, sourceRef: string): NormalizedSourceItem {
	const isPr = !!issue.pull_request;
	const isMerged = isPr && !!issue.pull_request?.merged_at;

	let status: string;
	if (isMerged) {
		status = "merged";
	} else {
		status = issue.state ?? "open";
	}

	const labels = (issue.labels?.map((l) => l.name).filter(Boolean) as string[]) ?? [];

	// Derive priority from labels if possible
	let priority: string | null = null;
	for (const label of labels) {
		const lower = label.toLowerCase();
		if (lower.includes("critical") || lower.includes("p0")) {
			priority = "critical";
			break;
		}
		if (lower.includes("high") || lower.includes("p1")) {
			priority = "high";
			break;
		}
		if (lower.includes("medium") || lower.includes("p2")) {
			priority = "medium";
			break;
		}
		if (lower.includes("low") || lower.includes("p3")) {
			priority = "low";
			break;
		}
	}

	return {
		sourceType: "github",
		sourceRef: `${sourceRef}#${issue.number}`,
		title: `${isPr ? "PR" : "Issue"} #${issue.number}: ${issue.title ?? "Untitled"}`,
		body: issue.body ?? null,
		severity: null,
		priority,
		status,
		url: issue.html_url ?? null,
		createdAt: issue.created_at ?? null,
		updatedAt: issue.updated_at ?? null,
		metadata: {
			number: issue.number,
			isPullRequest: isPr,
			isMerged,
			labels,
			assignees: issue.assignees?.map((a) => a.login).filter(Boolean) ?? [],
			author: issue.user?.login ?? null,
			milestone: issue.milestone?.title ?? null,
			repo: sourceRef,
		},
	};
}

export class GitHubNormalizer implements SourceNormalizer {
	readonly sourceType = "github" as const;

	async query(
		token: string,
		sourceRef: string,
		cursor?: string,
		limit = 25,
	): Promise<SourceQueryResult> {
		const log = getServicesLogger().child({ module: "github-normalizer" });

		// sourceRef is "owner/repo"
		const url = `${GITHUB_API_BASE}/repos/${sourceRef}/issues`;
		const params = new URLSearchParams({
			per_page: String(limit),
			state: "all",
			sort: "updated",
			direction: "desc",
		});
		if (cursor) {
			params.set("page", cursor);
		}

		const response = await fetch(`${url}?${params}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			log.error({ status: response.status, sourceRef }, "GitHub API request failed");
			throw new Error(`GitHub API error: ${response.status}`);
		}

		const issues = (await response.json()) as GitHubIssue[];

		// Parse Link header for pagination
		const linkHeader = response.headers.get("Link");
		let nextCursor: string | null = null;
		let hasMore = false;
		if (linkHeader) {
			const nextMatch = linkHeader.match(/<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="next"/);
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
		const log = getServicesLogger().child({ module: "github-normalizer" });

		// itemRef is the issue/PR number
		const url = `${GITHUB_API_BASE}/repos/${sourceRef}/issues/${itemRef}`;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			if (response.status === 404) return null;
			log.error({ status: response.status, sourceRef, itemRef }, "GitHub API get item failed");
			throw new Error(`GitHub API error: ${response.status}`);
		}

		const issue = (await response.json()) as GitHubIssue;
		return normalizeIssue(issue, sourceRef);
	}
}
