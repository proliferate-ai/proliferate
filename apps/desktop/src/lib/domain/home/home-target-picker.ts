import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "@/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type { CloudRepoActionState } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";

export function homeRepoLaunchKindLabel(kind: HomeNextRepoLaunchKind): string {
  switch (kind) {
    case "worktree":
      return "New worktree";
    case "local":
      return "Work locally";
    case "cloud":
      return "Cloud";
    case "ssh":
      return "SSH target";
  }
}

export function homeTargetProjectLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "No project";
  }
  return input.selectedRepository?.name ?? "Choose repository";
}

export function homeTargetRuntimeOptionLabel(input: {
  launchKind: HomeNextRepoLaunchKind;
  cloudAction: CloudRepoActionState;
}): string {
  if (input.launchKind !== "cloud") {
    return homeRepoLaunchKindLabel(input.launchKind);
  }
  if (input.cloudAction.kind === "loading") {
    return input.cloudAction.label;
  }
  if (input.cloudAction.kind === "configure") {
    return "Set up cloud";
  }
  if (input.cloudAction.kind === "hidden") {
    return "Cloud unavailable";
  }
  return homeRepoLaunchKindLabel(input.launchKind);
}

export function homeTargetProjectAriaLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "Project: No project";
  }
  return input.selectedRepository
    ? `Project: ${input.selectedRepository.name} repository`
    : "Project: Choose repository";
}

export function homeTargetRuntimeAriaLabel(input: {
  label: string;
  selectedRepository: SettingsRepositoryEntry | null;
  destination: HomeNextDestination;
}): string {
  if (!input.selectedRepository || input.destination === "cowork") {
    return "Runtime: no repository selected";
  }
  return `Runtime: ${input.label}`;
}

export function resolveHomeTargetLaunchKindForRepository(input: {
  currentLaunchKind: HomeNextRepoLaunchKind;
  sourceRoot: string;
  cloudActionBySourceRoot: Record<string, CloudRepoActionState>;
}): HomeNextRepoLaunchKind {
  if (input.currentLaunchKind !== "cloud") {
    return input.currentLaunchKind;
  }
  const cloudAction = input.cloudActionBySourceRoot[input.sourceRoot];
  return cloudAction?.kind === "create" ? "cloud" : "worktree";
}
