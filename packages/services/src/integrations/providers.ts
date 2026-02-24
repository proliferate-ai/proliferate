/**
 * External API providers for integrations metadata.
 *
 * Pure HTTP helpers for fetching metadata from Sentry, Linear, and Jira APIs.
 */

// ============================================
// Sentry
// ============================================

export interface SentryProject {
	id: string;
	slug: string;
	name: string;
	platform: string | null;
}

export interface SentryEnvironment {
	name: string;
}

export interface SentryMetadata {
	projects: SentryProject[];
	environments: SentryEnvironment[];
	levels: string[];
}

const SENTRY_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const;

export async function fetchSentryMetadata(
	authToken: string,
	hostname: string,
	projectSlug?: string,
): Promise<SentryMetadata> {
	const baseUrl = `https://${hostname}/api/0`;

	const orgsResponse = await fetch(`${baseUrl}/organizations/`, {
		headers: { Authorization: `Bearer ${authToken}` },
	});

	if (!orgsResponse.ok) {
		throw new Error(`Sentry API error: ${orgsResponse.status}`);
	}

	const orgs = (await orgsResponse.json()) as Array<{ slug: string; name: string }>;

	if (orgs.length === 0) {
		return {
			projects: [],
			environments: [],
			levels: [...SENTRY_LEVELS],
		};
	}

	const orgSlug = orgs[0].slug;

	const projectsResponse = await fetch(`${baseUrl}/organizations/${orgSlug}/projects/`, {
		headers: { Authorization: `Bearer ${authToken}` },
	});

	if (!projectsResponse.ok) {
		throw new Error(`Sentry projects API error: ${projectsResponse.status}`);
	}

	const projects = (await projectsResponse.json()) as SentryProject[];

	let environments: SentryEnvironment[] = [];
	const targetProjectSlug = projectSlug || (projects.length > 0 ? projects[0].slug : null);

	if (targetProjectSlug) {
		const envsResponse = await fetch(
			`${baseUrl}/projects/${orgSlug}/${targetProjectSlug}/environments/`,
			{ headers: { Authorization: `Bearer ${authToken}` } },
		);

		if (envsResponse.ok) {
			environments = (await envsResponse.json()) as SentryEnvironment[];
		}
	}

	return {
		projects,
		environments,
		levels: [...SENTRY_LEVELS],
	};
}

// ============================================
// Linear
// ============================================

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
}

export interface LinearState {
	id: string;
	name: string;
	type: string;
	color: string;
}

export interface LinearLabel {
	id: string;
	name: string;
	color: string;
}

export interface LinearUser {
	id: string;
	name: string;
	email: string;
}

export interface LinearProject {
	id: string;
	name: string;
}

export interface LinearMetadata {
	teams: LinearTeam[];
	states: LinearState[];
	labels: LinearLabel[];
	users: LinearUser[];
	projects: LinearProject[];
}

export async function fetchLinearMetadata(
	authToken: string,
	teamId?: string,
): Promise<LinearMetadata> {
	const query = `
		query LinearMetadata($teamId: ID) {
			teams {
				nodes {
					id
					name
					key
				}
			}
			workflowStates(filter: { team: { id: { eq: $teamId } } }) {
				nodes {
					id
					name
					type
					color
				}
			}
			issueLabels(filter: { team: { id: { eq: $teamId } } }) {
				nodes {
					id
					name
					color
				}
			}
			users {
				nodes {
					id
					name
					email
				}
			}
			projects {
				nodes {
					id
					name
				}
			}
		}
	`;

	const response = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${authToken}`,
		},
		body: JSON.stringify({
			query,
			variables: teamId ? { teamId } : {},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Linear API error: ${response.status} - ${errorText}`);
	}

	const result = (await response.json()) as {
		data?: {
			teams?: { nodes: LinearTeam[] };
			workflowStates?: { nodes: LinearState[] };
			issueLabels?: { nodes: LinearLabel[] };
			users?: { nodes: LinearUser[] };
			projects?: { nodes: LinearProject[] };
		};
		errors?: Array<{ message: string }>;
	};

	if (result.errors?.length) {
		throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
	}

	return {
		teams: result.data?.teams?.nodes || [],
		states: result.data?.workflowStates?.nodes || [],
		labels: result.data?.issueLabels?.nodes || [],
		users: result.data?.users?.nodes || [],
		projects: result.data?.projects?.nodes || [],
	};
}

// ============================================
// Jira
// ============================================

const ATLASSIAN_API_BASE = "https://api.atlassian.com";

export interface JiraSite {
	id: string;
	name: string;
	url: string;
	avatarUrl: string | null;
}

export interface JiraProject {
	id: string;
	key: string;
	name: string;
	projectTypeKey: string;
}

export interface JiraIssueType {
	id: string;
	name: string;
	subtask: boolean;
	description: string | null;
}

export interface JiraMetadata {
	sites: JiraSite[];
	selectedSiteId: string | null;
	projects: JiraProject[];
	issueTypes: JiraIssueType[];
}

export async function fetchJiraMetadata(
	authToken: string,
	siteId?: string,
	projectId?: string,
): Promise<JiraMetadata> {
	const sitesResponse = await fetch(`${ATLASSIAN_API_BASE}/oauth/token/accessible-resources`, {
		headers: {
			Authorization: `Bearer ${authToken}`,
			Accept: "application/json",
		},
	});

	if (!sitesResponse.ok) {
		throw new Error(`Atlassian accessible-resources error: ${sitesResponse.status}`);
	}

	const rawSites = (await sitesResponse.json()) as Array<{
		id: string;
		name: string;
		url: string;
		avatarUrl?: string;
	}>;

	const sites: JiraSite[] = rawSites.map((s) => ({
		id: s.id,
		name: s.name,
		url: s.url,
		avatarUrl: s.avatarUrl ?? null,
	}));

	if (sites.length === 0) {
		return { sites: [], selectedSiteId: null, projects: [], issueTypes: [] };
	}

	const selectedSiteId = siteId ?? sites[0].id;
	const baseUrl = `${ATLASSIAN_API_BASE}/ex/jira/${selectedSiteId}/rest/api/3`;

	const projectsResponse = await fetch(`${baseUrl}/project/search?maxResults=100`, {
		headers: {
			Authorization: `Bearer ${authToken}`,
			Accept: "application/json",
		},
	});

	let projects: JiraProject[] = [];
	if (projectsResponse.ok) {
		const projectData = (await projectsResponse.json()) as {
			values: Array<{
				id: string;
				key: string;
				name: string;
				projectTypeKey: string;
			}>;
		};
		projects = projectData.values.map((p) => ({
			id: p.id,
			key: p.key,
			name: p.name,
			projectTypeKey: p.projectTypeKey,
		}));
	}

	let issueTypes: JiraIssueType[] = [];
	if (projectId) {
		const issueTypesResponse = await fetch(
			`${baseUrl}/issuetype/project?projectId=${projectId}`,
			{
				headers: {
					Authorization: `Bearer ${authToken}`,
					Accept: "application/json",
				},
			},
		);

		if (issueTypesResponse.ok) {
			const rawTypes = (await issueTypesResponse.json()) as Array<{
				id: string;
				name: string;
				subtask: boolean;
				description?: string;
			}>;
			issueTypes = rawTypes.map((t) => ({
				id: t.id,
				name: t.name,
				subtask: t.subtask,
				description: t.description ?? null,
			}));
		}
	} else {
		const issueTypesResponse = await fetch(`${baseUrl}/issuetype`, {
			headers: {
				Authorization: `Bearer ${authToken}`,
				Accept: "application/json",
			},
		});

		if (issueTypesResponse.ok) {
			const rawTypes = (await issueTypesResponse.json()) as Array<{
				id: string;
				name: string;
				subtask: boolean;
				description?: string;
			}>;
			issueTypes = rawTypes.map((t) => ({
				id: t.id,
				name: t.name,
				subtask: t.subtask,
				description: t.description ?? null,
			}));
		}
	}

	return { sites, selectedSiteId, projects, issueTypes };
}
