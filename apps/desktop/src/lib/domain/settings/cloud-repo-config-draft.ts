import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";
import {
  envFileVariablesEqual,
  parseEnvFileVariables,
  serializeEnvFileVariablesPreservingOriginal,
  type EnvFileVariable,
} from "@/lib/domain/settings/env-file-draft";

export interface CloudRepoEnvVarRow {
  id: string;
  key: string;
  value: string;
}

export interface CloudRepoSharedEnvFile {
  id: string;
  relativePath: string;
  rows: CloudRepoEnvVarRow[];
  originalContent: string | null;
  originalVariables: EnvFileVariable[];
}

export interface CloudRepoSharedEnvFilePayload {
  relativePath: string;
  content: string;
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

function buildCloudRepoEnvVarRowsFromVariables(
  variables: readonly EnvFileVariable[],
  createId: CloudRepoDraftIdFactory,
): CloudRepoEnvVarRow[] {
  return variables.map((row) => ({
    id: createId(),
    key: row.key,
    value: row.value,
  }));
}

export function buildCloudRepoSharedEnvFiles(
  savedConfig: CloudRepoConfig | null | undefined,
  createId: CloudRepoDraftIdFactory,
): CloudRepoSharedEnvFile[] {
  return (savedConfig?.trackedFiles ?? [])
    .filter((file) => typeof file.content === "string")
    .map((file) => {
      const originalContent = file.content ?? "";
      const originalVariables = parseEnvFileVariables(originalContent);
      return {
        id: createId(),
        relativePath: file.relativePath,
        rows: buildCloudRepoEnvVarRowsFromVariables(originalVariables, createId),
        originalContent,
        originalVariables,
      };
    });
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

function normalizeCloudRepoSharedEnvFilePath(relativePath: string): string {
  return relativePath.trim().replaceAll("\\", "/");
}

function normalizeCloudRepoSharedEnvFiles(
  files: readonly CloudRepoSharedEnvFile[],
): CloudRepoSharedEnvFile[] {
  return files
    .map((file) => ({
      ...file,
      relativePath: normalizeCloudRepoSharedEnvFilePath(file.relativePath),
      rows: file.rows.filter((row) => row.key.trim().length > 0),
    }))
    .filter((file) => file.relativePath.length > 0);
}

export function buildCloudRepoSharedEnvFilePayloads(
  files: readonly CloudRepoSharedEnvFile[],
): CloudRepoSharedEnvFilePayload[] {
  return normalizeCloudRepoSharedEnvFiles(files).map((file) => ({
    relativePath: file.relativePath,
    content: serializeEnvFileVariablesPreservingOriginal(
      file.rows,
      file.originalVariables,
      file.originalContent,
    ),
  }));
}

export function cloudRepoSharedEnvFilesEqual(
  left: readonly CloudRepoSharedEnvFile[],
  right: readonly CloudRepoSharedEnvFile[],
): boolean {
  const leftNormalized = normalizeCloudRepoSharedEnvFiles(left);
  const rightNormalized = normalizeCloudRepoSharedEnvFiles(right);
  if (leftNormalized.length !== rightNormalized.length) {
    return false;
  }
  return leftNormalized.every((leftFile, index) => {
    const rightFile = rightNormalized[index];
    return rightFile?.relativePath === leftFile.relativePath
      && envFileVariablesEqual(leftFile.rows, rightFile.rows);
  });
}

export function nextDefaultCloudRepoSharedEnvFilePath(
  files: readonly CloudRepoSharedEnvFile[],
): string {
  const existing = new Set(
    files.map((file) => normalizeCloudRepoSharedEnvFilePath(file.relativePath)),
  );
  if (!existing.has(".env.shared")) {
    return ".env.shared";
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `.env.shared.${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return ".env.shared";
}

export function buildEmptyCloudRepoSharedEnvFile(input: {
  files: readonly CloudRepoSharedEnvFile[];
  createId: CloudRepoDraftIdFactory;
}): CloudRepoSharedEnvFile {
  return {
    id: input.createId(),
    relativePath: nextDefaultCloudRepoSharedEnvFilePath(input.files),
    rows: [{ id: input.createId(), key: "", value: "" }],
    originalContent: null,
    originalVariables: [],
  };
}
