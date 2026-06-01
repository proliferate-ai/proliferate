import {
  summarizeCloudComposerBadgeControls,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

export interface MobileHomeLaunchConfigSummary {
  label: string;
  pending: boolean;
}

export function summarizeMobileHomeLaunchConfig(
  controls: readonly CloudChatComposerControlView[],
  runtimeLabel: string,
): MobileHomeLaunchConfigSummary {
  const badge = summarizeCloudComposerBadgeControls(controls);
  return {
    label: joinUniqueLabels([badge.label, runtimeLabel]) || "Chat settings",
    pending: badge.pending,
  };
}

function joinUniqueLabels(labels: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const label of labels) {
    const trimmed = label?.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    parts.push(trimmed);
  }
  return parts.join(" · ");
}
