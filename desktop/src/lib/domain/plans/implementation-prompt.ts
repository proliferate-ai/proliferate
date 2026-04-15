export function formatImplementPlanDraft(documentPath: string): string {
  const normalizedPath = documentPath.trim();
  if (!normalizedPath) {
    return "Carry out the approved plan document now.";
  }

  return `Carry out the approved plan document now:\n\n${normalizedPath}`;
}
