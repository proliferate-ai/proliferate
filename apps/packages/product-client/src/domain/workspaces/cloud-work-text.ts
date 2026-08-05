export function commandStatusDetailMessage(statusDetail: string | null | undefined): string | null {
  const trimmed = statusDetail?.trim();
  if (!trimmed || /^ready$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function compactPreviewText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/gu, " ").trim() ?? "";
  return text || null;
}
