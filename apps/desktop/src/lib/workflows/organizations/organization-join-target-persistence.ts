import {
  readProductStorageJson,
  removeProductStorageItem,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const PENDING_ORGANIZATION_JOIN_TARGET_KEY =
  "proliferate.organizationJoinTarget";
const PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS = 60 * 60 * 1000;

interface StoredOrganizationJoinTarget {
  organizationId: string;
  createdAt: number;
}

function normalizeStoredTarget(value: unknown): StoredOrganizationJoinTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.organizationId === "string"
      && record.organizationId.length > 0
      && typeof record.createdAt === "number"
    ? {
        organizationId: record.organizationId,
        createdAt: record.createdAt,
      }
    : null;
}

export async function readPendingOrganizationJoinTarget(
  context: ProductStorageContext,
  now = Date.now(),
): Promise<string | null> {
  const target = normalizeStoredTarget(await readProductStorageJson(
    context,
    PENDING_ORGANIZATION_JOIN_TARGET_KEY,
  ));
  if (
    !target
    || now - target.createdAt > PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS
  ) {
    if (target) {
      await removeProductStorageItem(
        context,
        PENDING_ORGANIZATION_JOIN_TARGET_KEY,
      );
    }
    return null;
  }
  return target.organizationId;
}

export async function writePendingOrganizationJoinTarget(
  context: ProductStorageContext,
  organizationId: string,
  createdAt = Date.now(),
): Promise<void> {
  await writeProductStorageJson(context, PENDING_ORGANIZATION_JOIN_TARGET_KEY, {
    organizationId,
    createdAt,
  } satisfies StoredOrganizationJoinTarget);
}

export async function clearPendingOrganizationJoinTarget(
  context: ProductStorageContext,
): Promise<void> {
  await removeProductStorageItem(context, PENDING_ORGANIZATION_JOIN_TARGET_KEY);
}
