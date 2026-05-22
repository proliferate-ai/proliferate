export interface EnvFileVariable {
  key: string;
  value: string;
}

const SAFE_UNQUOTED_ENV_VALUE_RE = /^[A-Za-z0-9_./:@%+=,-]*$/;

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return value;
}

function serializeEnvValue(value: string): string {
  if (SAFE_UNQUOTED_ENV_VALUE_RE.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export function parseEnvFileVariables(content: string | null | undefined): EnvFileVariable[] {
  const rows: EnvFileVariable[] = [];
  for (const rawLine of (content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalizedLine.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }
    rows.push({
      key,
      value: unquoteEnvValue(normalizedLine.slice(equalsIndex + 1)),
    });
  }
  return rows;
}

export function serializeEnvFileVariables(rows: readonly EnvFileVariable[]): string {
  const lines = rows
    .map((row) => ({
      key: row.key.trim(),
      value: row.value,
    }))
    .filter((row) => row.key.length > 0)
    .map((row) => `${row.key}=${serializeEnvValue(row.value)}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function envFileVariablesEqual(
  left: readonly EnvFileVariable[],
  right: readonly EnvFileVariable[],
): boolean {
  const leftContent = serializeEnvFileVariables(left);
  const rightContent = serializeEnvFileVariables(right);
  return leftContent === rightContent;
}
