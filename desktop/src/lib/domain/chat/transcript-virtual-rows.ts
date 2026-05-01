export {
  buildTranscriptRowModel as buildTranscriptVirtualRows,
  type TranscriptRow as TranscriptVirtualRow,
} from "@/lib/domain/chat/transcript-row-model";

export function resolveVirtualBottomDistance(input: {
  scrollOffset: number;
  viewportSize: number;
  totalVirtualSize: number;
}): number {
  return Math.max(
    input.totalVirtualSize - input.scrollOffset - input.viewportSize,
    0,
  );
}

export function shouldStickToVirtualBottom(input: {
  scrollOffset: number;
  viewportSize: number;
  totalVirtualSize: number;
  thresholdPx: number;
}): boolean {
  return resolveVirtualBottomDistance(input) <= input.thresholdPx;
}
