export function normalizeToolResultText(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:console|text|bash|sh)?\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}
