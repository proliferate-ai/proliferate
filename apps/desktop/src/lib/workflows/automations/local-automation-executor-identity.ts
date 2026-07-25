import {
  readProductStorageJson,
  writeProductStorageJson,
  type ProductStorageContext,
} from "@/lib/infra/persistence/product-storage";

const AUTOMATION_LOCAL_EXECUTOR_ID_KEY = "automationLocalExecutorId";

export interface LocalAutomationExecutorIdCache {
  current: Promise<string> | null;
}

export interface LocalAutomationExecutorIdDependencies {
  readPersistedId(): Promise<unknown>;
  persistId(executorId: string): Promise<void>;
  createId(): string;
}

export async function getLocalAutomationExecutorId(
  cache: LocalAutomationExecutorIdCache,
  dependencies: LocalAutomationExecutorIdDependencies,
): Promise<string> {
  if (cache.current) {
    return cache.current;
  }

  const pending = resolveLocalAutomationExecutorId(dependencies);
  cache.current = pending;
  try {
    return await pending;
  } catch (error) {
    if (cache.current === pending) {
      cache.current = null;
    }
    throw error;
  }
}

export function getProductStorageLocalAutomationExecutorId(
  context: ProductStorageContext,
  cache: LocalAutomationExecutorIdCache,
  createId: () => string,
): Promise<string> {
  return getLocalAutomationExecutorId(cache, {
    readPersistedId: () => readProductStorageJson<unknown>(
      context,
      AUTOMATION_LOCAL_EXECUTOR_ID_KEY,
    ),
    persistId: async (executorId) => {
      await writeProductStorageJson(
        context,
        AUTOMATION_LOCAL_EXECUTOR_ID_KEY,
        executorId,
      );
    },
    createId,
  });
}

async function resolveLocalAutomationExecutorId(
  dependencies: LocalAutomationExecutorIdDependencies,
): Promise<string> {
  const persisted = await dependencies.readPersistedId();
  if (typeof persisted === "string" && persisted.trim()) {
    return persisted.trim();
  }

  const executorId = `desktop:${dependencies.createId()}`;
  await dependencies.persistId(executorId);
  return executorId;
}
