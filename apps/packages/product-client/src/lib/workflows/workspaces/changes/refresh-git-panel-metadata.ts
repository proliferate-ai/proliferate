export async function refreshGitPanelMetadata({
  refreshes,
  advanceForceEpoch,
}: {
  refreshes: ReadonlyArray<() => Promise<{ isError: boolean }>>;
  advanceForceEpoch: () => number;
}): Promise<boolean> {
  const results = await Promise.all(refreshes.map((refresh) => refresh()));
  if (results.some((result) => result.isError)) {
    return false;
  }
  advanceForceEpoch();
  return true;
}
