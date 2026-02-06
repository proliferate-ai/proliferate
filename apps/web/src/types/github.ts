/**
 * GitHub API response types.
 * These represent data returned from GitHub's API, not our database models.
 */

/**
 * GitHub repository from the GitHub API.
 * Used when fetching available repositories for a user/installation.
 */
export interface GitHubRepo {
	id: number;
	name?: string;
	full_name: string;
	html_url: string;
	default_branch: string;
	private: boolean;
	description?: string | null;
	stargazers_count?: number;
	language?: string | null;
}

/**
 * Response from the available-repos endpoint.
 */
export interface AvailableReposResponse {
	repositories: GitHubRepo[];
	integrationId: string;
}
