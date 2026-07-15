import {
  readPersistedJsonValue,
  removePersistedKey,
  writePersistedJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const PENDING_ORGANIZATION_JOIN_TARGET_KEY = "proliferate.organizationJoinTarget";
const PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS = 60 * 60 * 1000;

interface StoredOrganizationJoinTarget {
  organizationId: string;
  createdAt: number;
}

function isStoredTargetFresh(target: StoredOrganizationJoinTarget): boolean {
  return Date.now() - target.createdAt <= PENDING_ORGANIZATION_JOIN_TARGET_MAX_AGE_MS;
}

export async function readPendingOrganizationJoinTarget(
  context: ProductStorageContext,
): Promise<string | null> {
  const target = await readPersistedJsonValue<StoredOrganizationJoinTarget>(
    context,
    PENDING_ORGANIZATION_JOIN_TARGET_KEY,
  );
  if (!target || typeof target !== "object") {
    return null;
  }
  if (!target.organizationId || !isStoredTargetFresh(target)) {
    await clearPendingOrganizationJoinTarget(context);
    return null;
  }
  return target.organizationId;
}

export async function writePendingOrganizationJoinTarget(
  context: ProductStorageContext,
  organizationId: string,
): Promise<void> {
  await writePersistedJson(context, PENDING_ORGANIZATION_JOIN_TARGET_KEY, {
    organizationId,
    createdAt: Date.now(),
  } satisfies StoredOrganizationJoinTarget);
}

export async function clearPendingOrganizationJoinTarget(
  context: ProductStorageContext,
): Promise<void> {
  await removePersistedKey(context, PENDING_ORGANIZATION_JOIN_TARGET_KEY);
}
