interface AdminRequestRepo {
  gitOwner: string;
  gitRepoName: string;
}

/**
 * Factual, copy-to-clipboard request a non-privileged member sends to an
 * organization admin when they cannot install/grant the GitHub App themselves
 * (resolver action `copy_admin_request`). Plain text, no markup.
 */
export function buildCloudAdminRequestMessage(input: {
  orgName: string | null;
  repo: AdminRequestRepo | null;
  installUrl: string;
}): string {
  const org = input.orgName?.trim() || "our organization";
  const repoSuffix = input.repo
    ? ` and grant access to ${input.repo.gitOwner}/${input.repo.gitRepoName}`
    : "";
  return (
    `Please install the Proliferate GitHub App for ${org}${repoSuffix} `
    + `so we can use Proliferate Cloud: ${input.installUrl}`
  );
}
