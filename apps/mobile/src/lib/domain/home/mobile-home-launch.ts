import type {
  CloudAgentCatalogResponse,
  CloudTargetSummary,
} from "@proliferate/cloud-sdk";
import {
  buildLaunchSessionConfigUpdates,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import type { MobileIconName } from "../../../components/primitives/MobileIcon";

export interface MobileRepoOption {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
}

export type MobileRuntimeOption =
  | {
    id: "cloud";
    kind: "cloud";
    label: string;
    description: string;
    icon: MobileIconName;
    online: true;
    targetId: null;
  }
  | {
    id: string;
    kind: "target";
    label: string;
    description: string;
    icon: MobileIconName;
    online: boolean;
    targetId: string;
  };

export function buildMobileRepoOptions(
  configs: readonly {
    gitOwner: string;
    gitRepoName: string;
  }[],
): MobileRepoOption[] {
  return configs
    .map((config) => ({
      id: `${config.gitOwner}/${config.gitRepoName}`,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: `${config.gitOwner}/${config.gitRepoName}`,
      description: "Configured cloud repo",
    }));
}

export function buildMobileBranchOptions(input: {
  branches?: readonly string[] | null;
  defaultBranch?: string | null;
  selectedBranch?: string | null;
}): string[] {
  const options: string[] = [];
  addUniqueBranch(options, input.defaultBranch);
  addUniqueBranch(options, input.selectedBranch);
  for (const branch of input.branches ?? []) {
    addUniqueBranch(options, branch);
  }
  return options;
}

export function buildMobileRuntimeOptions(
  targets: readonly CloudTargetSummary[] | undefined,
): MobileRuntimeOption[] {
  return [
    {
      id: "cloud",
      kind: "cloud",
      label: "Cloud sandbox",
      description: "Run in managed cloud compute",
      icon: "cloud",
      online: true,
      targetId: null,
    },
    ...((targets ?? [])
      .filter((target) => target.kind === "desktop_dispatch")
      .map((target): MobileRuntimeOption => ({
        id: target.id,
        kind: "target",
        label: targetLabel(target),
        description: target.status === "online"
          ? "Dispatch to this connected target"
          : target.statusDetail?.statusDetail ?? "Target is offline",
        icon: targetIcon(target),
        online: target.status === "online",
        targetId: target.id,
      }))),
  ];
}

export function buildMobilePendingPrompt(input: {
  text: string;
  selection: CloudLaunchComposerSelection;
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  repo: MobileRepoOption;
  runtime: MobileRuntimeOption;
}): MobilePendingPrompt {
  return {
    id: `mobile-home:${Date.now().toString(36)}`,
    text: input.text,
    agentKind: input.selection.agentKind,
    modelId: input.selection.modelId,
    modeId: input.selection.modeId,
    sessionConfigUpdates: buildLaunchSessionConfigUpdates({
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
      selection: input.selection,
    }),
    selectedRepo: input.repo.id,
    selectedRuntimeTargetId: input.runtime.targetId,
    createdAt: Date.now(),
  };
}

export function buildBranchName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    || "mobile-chat";
  return `proliferate/${slug}-${Date.now().toString(36).slice(-6)}`;
}

export function buildWorkspaceDisplayName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) {
    return normalized || "Mobile chat";
  }
  return `${normalized.slice(0, 39).trimEnd()}...`;
}

function targetLabel(target: CloudTargetSummary): string {
  if (target.displayName?.trim()) {
    return target.displayName.trim();
  }
  switch (target.kind) {
    case "desktop_dispatch":
      return "Desktop Mac";
    case "ssh":
      return "SSH target";
    case "self_hosted_cloud":
      return "Self-hosted target";
    default:
      return "Target";
  }
}

function targetIcon(target: CloudTargetSummary): MobileIconName {
  switch (target.kind) {
    case "desktop_dispatch":
      return "monitor";
    case "ssh":
    case "self_hosted_cloud":
      return "external";
    default:
      return "cloud";
  }
}

function addUniqueBranch(options: string[], branch: string | null | undefined): void {
  const trimmed = branch?.trim();
  if (trimmed && !options.includes(trimmed)) {
    options.push(trimmed);
  }
}
