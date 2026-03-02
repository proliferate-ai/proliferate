/**
 * Linear source normalizer.
 *
 * Fetches issues from the Linear GraphQL API and normalizes them
 * into the common source item format.
 *
 * sourceRef format: team key (e.g. "ENG") or "all" for all teams.
 */

import { getServicesLogger } from "../../logger";
import type { NormalizedSourceItem, SourceNormalizer, SourceQueryResult } from "./types";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const PRIORITY_MAP: Record<number, string> = {
	0: "none",
	1: "urgent",
	2: "high",
	3: "medium",
	4: "low",
};

interface LinearIssue {
	id: string;
	identifier?: string;
	title?: string;
	description?: string;
	priority?: number;
	state?: { id?: string; name?: string };
	labels?: { nodes?: Array<{ id?: string; name?: string }> };
	assignee?: { id?: string; name?: string; email?: string };
	team?: { id?: string; name?: string; key?: string };
	project?: { id?: string; name?: string };
	url?: string;
	createdAt?: string;
	updatedAt?: string;
}

interface LinearPageInfo {
	hasNextPage: boolean;
	endCursor?: string;
}

interface LinearIssuesResponse {
	data?: {
		issues?: {
			nodes?: LinearIssue[];
			pageInfo?: LinearPageInfo;
		};
		team?: {
			issues?: {
				nodes?: LinearIssue[];
				pageInfo?: LinearPageInfo;
			};
		};
	};
	errors?: Array<{ message: string }>;
}

function normalizeIssue(issue: LinearIssue, sourceRef: string): NormalizedSourceItem {
	return {
		sourceType: "linear",
		sourceRef: issue.id,
		title: issue.identifier
			? `${issue.identifier}: ${issue.title ?? "Untitled"}`
			: (issue.title ?? "Untitled"),
		body: issue.description ?? null,
		severity: null,
		priority: issue.priority != null ? (PRIORITY_MAP[issue.priority] ?? null) : null,
		status: issue.state?.name ?? null,
		url: issue.url ?? null,
		createdAt: issue.createdAt ?? null,
		updatedAt: issue.updatedAt ?? null,
		metadata: {
			identifier: issue.identifier,
			team: issue.team?.key ?? null,
			teamName: issue.team?.name ?? null,
			project: issue.project?.name ?? null,
			assignee: issue.assignee?.name ?? null,
			labels: issue.labels?.nodes?.map((l) => l.name).filter(Boolean) ?? [],
			bindingRef: sourceRef,
		},
	};
}

const ISSUES_QUERY = `
query IssuesQuery($first: Int!, $after: String, $teamKey: String) {
  issues(
    first: $first
    after: $after
    filter: { team: { key: { eq: $teamKey } } }
    orderBy: updatedAt
  ) {
    nodes {
      id identifier title description priority url createdAt updatedAt
      state { id name }
      labels { nodes { id name } }
      assignee { id name email }
      team { id name key }
      project { id name }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const ALL_ISSUES_QUERY = `
query AllIssuesQuery($first: Int!, $after: String) {
  issues(first: $first, after: $after, orderBy: updatedAt) {
    nodes {
      id identifier title description priority url createdAt updatedAt
      state { id name }
      labels { nodes { id name } }
      assignee { id name email }
      team { id name key }
      project { id name }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const ISSUE_BY_ID_QUERY = `
query IssueById($id: String!) {
  issue(id: $id) {
    id identifier title description priority url createdAt updatedAt
    state { id name }
    labels { nodes { id name } }
    assignee { id name email }
    team { id name key }
    project { id name }
  }
}
`;

export class LinearNormalizer implements SourceNormalizer {
	readonly sourceType = "linear" as const;

	async query(
		token: string,
		sourceRef: string,
		cursor?: string,
		limit = 25,
	): Promise<SourceQueryResult> {
		const log = getServicesLogger().child({ module: "linear-normalizer" });

		const isAll = sourceRef === "all" || !sourceRef;
		const query = isAll ? ALL_ISSUES_QUERY : ISSUES_QUERY;
		const variables: Record<string, unknown> = { first: limit };
		if (!isAll) variables.teamKey = sourceRef;
		if (cursor) variables.after = cursor;

		const response = await fetch(LINEAR_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: token,
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			log.error({ status: response.status, sourceRef }, "Linear API request failed");
			throw new Error(`Linear API error: ${response.status}`);
		}

		const result = (await response.json()) as LinearIssuesResponse;

		if (result.errors?.length) {
			const msg = result.errors.map((e) => e.message).join(", ");
			log.error({ errors: msg, sourceRef }, "Linear GraphQL errors");
			throw new Error(`Linear GraphQL error: ${msg}`);
		}

		const issuesData = result.data?.issues ?? result.data?.team?.issues;
		const nodes = issuesData?.nodes ?? [];
		const pageInfo = issuesData?.pageInfo;

		return {
			items: nodes.map((issue) => normalizeIssue(issue, sourceRef)),
			cursor: pageInfo?.endCursor ?? null,
			hasMore: pageInfo?.hasNextPage ?? false,
		};
	}

	async getItem(
		token: string,
		_sourceRef: string,
		itemRef: string,
	): Promise<NormalizedSourceItem | null> {
		const log = getServicesLogger().child({ module: "linear-normalizer" });

		const response = await fetch(LINEAR_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: token,
			},
			body: JSON.stringify({
				query: ISSUE_BY_ID_QUERY,
				variables: { id: itemRef },
			}),
		});

		if (!response.ok) {
			log.error({ status: response.status, itemRef }, "Linear API get item failed");
			throw new Error(`Linear API error: ${response.status}`);
		}

		const result = (await response.json()) as {
			data?: { issue?: LinearIssue };
			errors?: Array<{ message: string }>;
		};

		if (result.errors?.length) {
			const msg = result.errors.map((e) => e.message).join(", ");
			if (msg.includes("not found") || msg.includes("Entity not found")) return null;
			throw new Error(`Linear GraphQL error: ${msg}`);
		}

		const issue = result.data?.issue;
		if (!issue) return null;
		return normalizeIssue(issue, _sourceRef);
	}
}
