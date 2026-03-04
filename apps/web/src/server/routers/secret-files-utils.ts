/**
 * Secret file path utilities.
 *
 * Thin wrapper around the service-layer normalizer for backward compatibility.
 * The canonical implementation lives in @proliferate/services/secret-files/service.ts.
 */

import { secretFiles } from "@proliferate/services";

/**
 * Normalize and validate a secret file path for sandbox use.
 * Delegates to the service layer and re-throws domain errors as-is.
 */
export const normalizeSecretFilePathForSandbox = secretFiles.normalizeSecretFilePath;
