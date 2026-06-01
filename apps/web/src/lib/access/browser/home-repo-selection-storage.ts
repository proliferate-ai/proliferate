import { normalizeGitRepoId } from "@proliferate/product-domain/repos/repo-id";

const HOME_REPO_STORAGE_KEY = "proliferate.web.homeRepo";

export function readLastHomeRepoId(): string | null {
  try {
    return normalizeGitRepoId(window.localStorage.getItem(HOME_REPO_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeLastHomeRepoId(repo: string): void {
  try {
    window.localStorage.setItem(HOME_REPO_STORAGE_KEY, repo);
  } catch {
    // Ignore storage failures; the picker state remains in memory.
  }
}
