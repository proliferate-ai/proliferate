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
