import type { PromptInputBlock } from "@anyharness/sdk";

export function hasPromptContent(
  text: string,
  blocks?: readonly PromptInputBlock[] | null,
): boolean {
  if (text.trim().length > 0) {
    return true;
  }
  return (blocks ?? []).some((block) => {
    switch (block.type) {
      case "text":
        return block.text.trim().length > 0;
      default:
        return true;
    }
  });
}

export function dedupePlanReferenceBlocks(
  blocks: readonly PromptInputBlock[],
): PromptInputBlock[] {
  const seen = new Set<string>();
  const next: PromptInputBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "plan_reference") {
      next.push(block);
      continue;
    }
    const key = `${block.planId}:${block.snapshotHash}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(block);
  }
  return next;
}
