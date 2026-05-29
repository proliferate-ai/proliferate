export type GitHubLinkKind = "repo" | "issue" | "pull" | "commit" | "file";

export interface ParsedGitHubLink {
  href: string;
  kind: GitHubLinkKind;
  owner: string;
  repo: string;
  label: string;
  typeLabel: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITHUB_NUMBER_PATTERN = /^\d+$/;
const GITHUB_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

export function parseGitHubLink(href: string): ParsedGitHubLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment);
  if (segments.length < 2) {
    return null;
  }

  const [owner, repo] = segments;
  if (!owner || !repo) {
    return null;
  }
  const repoLabel = `${owner}/${repo}`;
  if (segments.length === 2) {
    return {
      href,
      kind: "repo",
      owner,
      repo,
      label: repoLabel,
      typeLabel: "Repo",
    };
  }

  const section = segments[2];
  const target = segments[3];
  if (section === "issues" && target && GITHUB_NUMBER_PATTERN.test(target)) {
    return {
      href,
      kind: "issue",
      owner,
      repo,
      label: `${repoLabel}#${target}`,
      typeLabel: "Issue",
    };
  }
  if (section === "pull" && target && GITHUB_NUMBER_PATTERN.test(target)) {
    return {
      href,
      kind: "pull",
      owner,
      repo,
      label: `${repoLabel}#${target}`,
      typeLabel: "PR",
    };
  }
  if (section === "commit" && target && GITHUB_COMMIT_PATTERN.test(target)) {
    return {
      href,
      kind: "commit",
      owner,
      repo,
      label: `${repoLabel}@${target.slice(0, 7)}`,
      typeLabel: "Commit",
    };
  }
  if (section === "blob" && target && segments.length > 4) {
    const filePath = segments.slice(4).join("/");
    return {
      href,
      kind: "file",
      owner,
      repo,
      label: `${repoLabel}/${filePath}`,
      typeLabel: "File",
    };
  }

  return null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
