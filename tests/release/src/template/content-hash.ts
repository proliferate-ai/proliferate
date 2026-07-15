import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

/**
 * The declared inputs that determine whether an E2B template needs a rebuild
 * (specs/developing/testing/README.md: "The E2B template build is cached by
 * content hash of its inputs (runtime binary, Dockerfile, agent pins)").
 */
export interface TemplateInputs {
  /** Path to the Linux AnyHarness binary that gets uploaded into the sandbox. */
  runtimeBinaryPath: string;
  /**
   * Path to the template definition. This repo builds E2B templates via the
   * `Template` builder API (scripts/build-template.mjs), not a checked-in
   * Dockerfile, so the script itself is the declarative input that changes
   * what gets baked into the image.
   */
  templateDefinitionPath: string;
  /** Path to catalog.json — pins the agent CLI versions baked into the template. */
  catalogPath: string;
}

export interface ResolvedTemplateInputs extends TemplateInputs {
  available: boolean;
  missingPaths: string[];
}

/**
 * Checks which declared input paths currently exist, without hashing. Used
 * by --dry-run to report readiness without requiring a built runtime binary.
 */
export async function resolveTemplateInputs(inputs: TemplateInputs): Promise<ResolvedTemplateInputs> {
  const entries = Object.entries(inputs) as [keyof TemplateInputs, string][];
  const missingPaths: string[] = [];
  for (const [, filePath] of entries) {
    const exists = await pathExists(filePath);
    if (!exists) {
      missingPaths.push(filePath);
    }
  }
  return { ...inputs, available: missingPaths.length === 0, missingPaths };
}

/**
 * Computes a stable sha256 over the concatenated bytes of every declared
 * input, in a fixed field order, prefixed with the field name so a rename
 * without a content change still produces a new hash. Throws if any input
 * path is missing — callers should check `resolveTemplateInputs` first when
 * a missing file is an expected/reportable state rather than a hard error.
 */
export async function computeTemplateInputsHash(inputs: TemplateInputs): Promise<string> {
  const hash = createHash("sha256");
  const orderedFields: (keyof TemplateInputs)[] = [
    "runtimeBinaryPath",
    "templateDefinitionPath",
    "catalogPath",
  ];
  for (const field of orderedFields) {
    const filePath = inputs[field];
    const contents = await readFile(filePath);
    hash.update(field);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
