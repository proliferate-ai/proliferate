export interface GitRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export function formatGitRepoId(repo: GitRepoIdentity): string {
  return `${repo.gitOwner}/${repo.gitRepoName}`;
}

export function gitRepoKey(gitOwner: string, gitRepoName: string): string {
  return formatGitRepoId({ gitOwner, gitRepoName });
}

/** Lower-case for logical comparison. GitHub owners/repos are case-insensitive. */
function caseFold(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/** Strip a single trailing `.git` suffix (case-insensitive) from a repo name. */
function stripDotGit(value: string): string {
  return value.trim().replace(/\.git$/iu, "");
}

/**
 * One canonical, case-folded logical key for a GitHub-style repository.
 *
 * Collapses provider/owner/repo casing and a trailing `.git` so two spellings
 * of the same repository (`Acme/Rocket`, `acme/rocket.git`) map to one group
 * and folder validation agrees. Display strings must keep their original
 * casing; only comparison keys pass through here. Branch names are never
 * folded — Git branch comparison stays case-sensitive.
 */
export function canonicalRepoKey(
  provider: string,
  owner: string,
  repo: string,
): string {
  return `${caseFold(provider)}:${caseFold(owner)}:${caseFold(stripDotGit(repo))}`;
}

export function normalizeGitRepoId(value: string | null | undefined): string | null {
  const parsed = parseGitRepoId(value);
  return parsed ? formatGitRepoId(parsed) : null;
}

export function parseGitRepoId(value: string | null | undefined): GitRepoIdentity | null {
  const candidate = extractGitHubRepoCandidate(value);
  if (!candidate) {
    return null;
  }

  const normalized = candidate
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "");
  const [gitOwner, gitRepoName, ...rest] = normalized.split("/");
  if (
    !gitOwner
    || !gitRepoName
    || rest.length > 0
    || !isValidGitHubOwner(gitOwner)
    || !isValidGitHubRepoName(gitRepoName)
  ) {
    return null;
  }
  return { gitOwner, gitRepoName };
}

function extractGitHubRepoCandidate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("git@github.com:")) {
    return trimmed.slice("git@github.com:".length);
  }

  if (/^https?:\/\//iu.test(trimmed)) {
    const match = /^https?:\/\/github\.com\/([^/?#]+\/[^/?#]+)/iu.exec(trimmed);
    return match?.[1] ?? null;
  }

  return trimmed;
}

function isValidGitHubOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value);
}

function isValidGitHubRepoName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && value !== "." && value !== "..";
}
