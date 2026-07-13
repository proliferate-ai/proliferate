/**
 * Typed validation errors shared by the candidate and retained-production
 * manifest loaders. A hash of an invalid manifest must never exist (see
 * contracts/hashing.ts), so both loaders collect every issue and throw
 * before a caller can hash or otherwise trust a malformed manifest.
 */

export interface ManifestIssue {
  /** Dotted path into the manifest, e.g. "anyharness.darwin-aarch64.value.digest". */
  readonly path: string;
  readonly message: string;
}

export class ManifestValidationError extends Error {
  readonly kind: string;
  readonly issues: readonly ManifestIssue[];

  constructor(kind: string, issues: readonly ManifestIssue[]) {
    super(
      `${kind} manifest failed validation with ${issues.length} issue(s):\n` +
        issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n"),
    );
    this.name = "ManifestValidationError";
    this.kind = kind;
    this.issues = issues;
  }
}

/** Accumulates issues across a validation pass without throwing until the caller decides to. */
export class IssueCollector {
  private readonly issues: ManifestIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  get all(): readonly ManifestIssue[] {
    return this.issues;
  }

  get hasIssues(): boolean {
    return this.issues.length > 0;
  }

  throwIfAny(kind: string): void {
    if (this.hasIssues) {
      throw new ManifestValidationError(kind, this.issues);
    }
  }
}
