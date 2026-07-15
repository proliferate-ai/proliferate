import { useGitHubRepoAuthority } from "@proliferate/cloud-sdk-react";
import {
  resolveCloudRepoActionState,
  type CloudWorkspaceRepoTarget,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-creation";
import { cloudRepositoryKey } from "#product/lib/domain/settings/repositories";

export function useCloudRepoActionState(args: {
  repoTarget: CloudWorkspaceRepoTarget | null;
  configuredRepoKeys: ReadonlySet<string>;
  isInitialConfigLoad: boolean;
  cloudConnected: boolean;
}) {
  const configured = args.repoTarget
    ? args.configuredRepoKeys.has(cloudRepositoryKey(
      args.repoTarget.gitOwner,
      args.repoTarget.gitRepoName,
    ))
    : false;
  const shouldCheckAuthority = args.cloudConnected
    && configured
    && !args.isInitialConfigLoad;
  const authority = useGitHubRepoAuthority({
    gitOwner: args.repoTarget?.gitOwner,
    gitRepoName: args.repoTarget?.gitRepoName,
  }, shouldCheckAuthority);

  return resolveCloudRepoActionState({
    ...args,
    repoAuthority: authority.data,
    isInitialAuthorityLoad: shouldCheckAuthority && authority.isPending && !authority.data,
    authorityError: shouldCheckAuthority && authority.isError,
  });
}
