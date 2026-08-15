import { useMemo } from "react";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import {
  describeMalformedReference,
  parsePromptTokens,
  type PromptToken,
} from "#product/domain/workflows/definition-v2";
import { Badge } from "#product/primitives/Badge";
import { Label } from "#product/primitives/Label";
import { Textarea } from "#product/primitives/Textarea";

export interface WorkflowBuilderPromptFieldProps {
  fieldId: string;
  value: string;
  disabled: boolean;
  /** Declared input names; a `@input:` token outside this set reads as unresolved. */
  inputNames: ReadonlySet<string>;
  /** Declared doc slugs; a `@doc:` token outside this set reads as unresolved. */
  docSlugs: ReadonlySet<string>;
  invalid: boolean;
  onChange: (prompt: string) => void;
}

/**
 * The prompt editor and its token preview.
 *
 * The preview is a separate block rather than styling inside the textarea: a
 * chip painted *in* the input would mean a contenteditable surface with
 * hand-drawn caret and selection behavior, which no library primitive owns.
 * Beneath it, the same `parsePromptTokens` segments the validator reads render
 * as `Badge` chips, so what the author sees marked resolved is exactly what
 * `validateDefinitionV2` accepted.
 *
 * It only appears once the prompt actually references something — a prompt
 * with no tokens has nothing to preview, and an empty mirror of every prompt
 * would double the height of every card for nothing. A malformed reference
 * counts as a reference: `@doc:plan.md` is exactly the case the preview exists
 * to show, so it opens the preview and chips as invalid.
 */
export function WorkflowBuilderPromptField({
  fieldId,
  value,
  disabled,
  inputNames,
  docSlugs,
  invalid,
  onChange,
}: WorkflowBuilderPromptFieldProps) {
  const tokens = useMemo(() => parsePromptTokens(value), [value]);
  const hasReferences = tokens.some((token) => token.kind !== "text");

  return (
    <div>
      <Label htmlFor={fieldId}>{WORKFLOW_BUILDER_COPY.promptLabel}</Label>
      <Textarea
        id={fieldId}
        value={value}
        rows={5}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        placeholder={WORKFLOW_BUILDER_COPY.promptPlaceholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <p className="mt-1 text-ui-sm text-muted-foreground">
        {WORKFLOW_BUILDER_COPY.promptHelp}
      </p>
      {hasReferences ? (
        <div className="mt-3">
          <p className="mb-1 text-ui-sm text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.promptPreviewLabel}
          </p>
          <p className="whitespace-pre-wrap text-ui text-muted-foreground">
            {tokens.map((token, index) => (
              <PromptTokenPart
                key={`${index}:${tokenKey(token)}`}
                token={token}
                inputNames={inputNames}
                docSlugs={docSlugs}
              />
            ))}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PromptTokenPart({
  token,
  inputNames,
  docSlugs,
}: {
  token: PromptToken;
  inputNames: ReadonlySet<string>;
  docSlugs: ReadonlySet<string>;
}) {
  if (token.kind === "text") {
    return <>{token.text}</>;
  }
  // Malformed is its own state, not "unresolved": the reference cannot be made
  // to resolve by declaring anything, because the planes that substitute
  // references would not recognize it. Same destructive chip, and the reason
  // comes from the grammar module so the wording matches the save-gate message.
  if (token.kind === "malformed") {
    return (
      <Badge
        size="micro"
        tone="destructive"
        title={WORKFLOW_BUILDER_COPY.malformedReferenceHint(
          token.raw,
          describeMalformedReference(token),
        )}
        data-resolved="false"
        data-malformed="true"
      >
        {token.raw}
      </Badge>
    );
  }
  const resolved = token.kind === "input"
    ? inputNames.has(token.name)
    : docSlugs.has(token.slug);
  return (
    <Badge
      size="micro"
      tone={resolved ? "accent" : "destructive"}
      title={resolved
        ? WORKFLOW_BUILDER_COPY.resolvedReferenceHint(token.raw)
        : WORKFLOW_BUILDER_COPY.unresolvedReferenceHint(token.raw)}
      data-resolved={resolved ? "true" : "false"}
    >
      {token.raw}
    </Badge>
  );
}

function tokenKey(token: PromptToken): string {
  if (token.kind === "text") {
    return "text";
  }
  return token.raw;
}
