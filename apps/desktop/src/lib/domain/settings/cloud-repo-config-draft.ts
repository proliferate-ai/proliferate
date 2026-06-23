export interface CloudRepoEnvVarRow {
  id: string;
  key: string;
  value: string;
}

type CloudRepoDraftIdFactory = () => string;

export function buildCloudRepoEnvVarRows(
  envVars: Record<string, string>,
  createId: CloudRepoDraftIdFactory,
): CloudRepoEnvVarRow[] {
  return Object.entries(envVars)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ({
      id: createId(),
      key,
      value,
    }));
}

export function buildCloudRepoEnvVarsFromRows(
  rows: readonly CloudRepoEnvVarRow[],
): Record<string, string> {
  return rows.reduce<Record<string, string>>((accumulator, row) => {
    const key = row.key.trim();
    if (!key) {
      return accumulator;
    }
    accumulator[key] = row.value;
    return accumulator;
  }, {});
}
