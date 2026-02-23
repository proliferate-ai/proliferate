import type { RepoSpec } from "../sandbox-provider";

function addCredentialVariant(target: Record<string, string>, url: string, token: string): void {
	if (!url) {
		return;
	}
	target[url] = token;
}

/**
 * Build credential-helper lookup keys for repository URLs.
 *
 * Git can request credentials using path variants that differ from the
 * configured remote (trailing slash, with/without `.git`). We precompute
 * all common forms so helper lookup remains stable.
 */
export function buildGitCredentialsMap(repos: RepoSpec[]): Record<string, string> {
	const credentials: Record<string, string> = {};

	for (const repo of repos) {
		if (!repo.token) {
			continue;
		}

		const raw = repo.repoUrl.trim();
		if (!raw) {
			continue;
		}

		const noTrailingSlash = raw.replace(/\/+$/, "");
		const withoutGit = noTrailingSlash.replace(/\.git$/, "");
		const withGit = withoutGit.endsWith(".git") ? withoutGit : `${withoutGit}.git`;

		addCredentialVariant(credentials, raw, repo.token);
		addCredentialVariant(credentials, noTrailingSlash, repo.token);
		addCredentialVariant(credentials, withoutGit, repo.token);
		addCredentialVariant(credentials, withGit, repo.token);
		addCredentialVariant(credentials, `${withoutGit}/`, repo.token);
		addCredentialVariant(credentials, `${withGit}/`, repo.token);
	}

	return credentials;
}
