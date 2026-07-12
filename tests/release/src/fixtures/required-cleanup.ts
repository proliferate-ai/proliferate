export interface RequiredCleanupOptions<T> {
  label: string;
  resourceIds: readonly string[];
  run: () => Promise<T>;
  cleanup: () => Promise<void>;
}

/** Run a live scenario body and make its external-resource cleanup part of the
 * result. Cleanup failure is always red; when the body also failed, preserve
 * both errors instead of letting `finally` hide either one. */
export async function withRequiredCleanup<T>(
  options: RequiredCleanupOptions<T>,
): Promise<T> {
  let value: T | undefined;
  let runError: unknown;
  try {
    value = await options.run();
  } catch (error) {
    runError = error;
  }

  let cleanupError: unknown;
  try {
    await options.cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (cleanupError !== undefined) {
    const resourceSummary = options.resourceIds.join(", ") || "resource id unavailable";
    const contextualCleanupError = new Error(
      `Required cleanup failed for ${options.label} [${resourceSummary}]: ${describe(cleanupError)}`,
      { cause: cleanupError },
    );
    if (runError !== undefined) {
      throw new AggregateError(
        [runError, contextualCleanupError],
        `Scenario execution and required cleanup both failed for ${options.label} [${resourceSummary}]`,
      );
    }
    throw contextualCleanupError;
  }
  if (runError !== undefined) {
    throw runError;
  }
  return value as T;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
