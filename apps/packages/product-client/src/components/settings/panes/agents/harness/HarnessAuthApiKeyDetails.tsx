import { useState } from "react";
import {
  useCreateAgentApiKey,
  useRevokeAgentApiKey,
} from "@proliferate/cloud-sdk-react";
import { KeyRound, Trash } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Card } from "#product/primitives/patterns/Card";
import { IconButton } from "#product/primitives/IconButton";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "#product/primitives/SegmentedControl";
import {
  getApiKeyBindingLabel,
  getHarnessEnvVarSuggestions,
} from "#product/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  getProviderConfigFieldSpec,
  getSupportedProviderConfigKinds,
  type ProviderConfigKind,
} from "#product/lib/domain/settings/provider-config-fields";
import { useToastStore } from "#product/stores/toast/toast-store";

type KeyPath = "paste" | "saved" | ProviderConfigKind;

/**
 * API-key method detail (design-handoff v2 "three paths"). When no key is
 * bound: a segmented control over **Paste key | Saved keys | {config kind}**
 * (the third segment renders only for harnesses whose registry declares a
 * typed provider config — none today; see provider-config-fields.ts). When a
 * key IS bound: one field-shaped container showing whose key it is, with a
 * trash affordance that unbinds and returns to the config UI. The env var a
 * key lands in is DERIVED, never shown or edited.
 */
export function ApiKeyDetails({
  harnessKind,
  editor,
}: {
  harnessKind: string;
  editor: HarnessAuthEditorApi;
}) {
  const apiKeys = editor.apiKeysQuery.data ?? [];
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  // The env var a pasted key lands in is DERIVED, never user-facing:
  // Claude Code's key is the Anthropic key, Codex's the OpenAI key, and so on
  // (STATIC_HARNESS_ENV_VARS).
  const usedEnvVars = new Set(editor.editorState.rows.map((row) => row.envVarName));
  const envVarSuggestion = getHarnessEnvVarSuggestions(harnessKind).find(
    (candidate) => !usedEnvVars.has(candidate.envVarName),
  );
  const keyLabel = envVarSuggestion
    ? getApiKeyBindingLabel(envVarSuggestion.envVarName, envVarSuggestion.providerHint)
    : null;

  // Typed provider-config kinds (Bedrock/Azure) this harness may offer:
  // the registry's non-pending `providerConfig` declarations — the same set
  // the server's selection write gate admits (see provider-config-fields.ts's
  // module comment). Empty for a harness with no declarations (cursor, grok),
  // so those panes render no third segment.
  const providerConfigKinds = getSupportedProviderConfigKinds(harnessKind);
  const [path, setPath] = useState<KeyPath>("paste");
  const [pastedKey, setPastedKey] = useState("");

  // Inline paste: the pasted secret becomes a vault key titled by the derived
  // provider ("Anthropic API key") and is bound to the derived env var in one
  // flow. No modal, no env-var field.
  function handleInlinePaste() {
    const value = pastedKey.trim();
    const envVarName = envVarSuggestion?.envVarName;
    if (!envVarName || value.length === 0) return;
    createKey.mutate(
      { title: keyLabel ?? "API key", value, kind: "api_key" },
      {
        onSuccess: (created) => {
          setPastedKey("");
          editor.addBoundApiKey(
            envVarName,
            envVarSuggestion?.providerHint ?? null,
            created.id,
            {
              // A rejected selection PUT must not strand the just-created
              // vault key (nothing references it) — same revoke-on-failure
              // contract as HarnessProvidersSection.handleProviderSubmit.
              onError: (message) => {
                revokeKey.mutate(created.id);
                showToast(message);
              },
            },
          );
        },
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.addApiKeyError);
        },
      },
    );
  }

  // Selecting an already-saved vault key binds it directly — same derivation,
  // no create.
  function handleSavedKeySelect(keyId: string) {
    const envVarName = envVarSuggestion?.envVarName;
    if (!envVarName) return;
    editor.addBoundApiKey(envVarName, envVarSuggestion?.providerHint ?? null, keyId);
  }

  const boundRow = editor.editorState.rows.find((row) => row.apiKeyId !== null);

  // Bound state: the single field replaces the config UI entirely
  // (design-handoff v2 "Bound key field") — trash unbinds and returns here.
  if (boundRow) {
    const boundKey = apiKeys.find((key) => key.id === boundRow.apiKeyId);
    const label = getApiKeyBindingLabel(boundRow.envVarName, boundRow.providerHint);
    return (
      // Bound-key field frame: not a Card site (this is an input-shaped
      // affordance, not a content container). h-[38px] is a stray 2px over
      // Input's own h-9 (36px) — not on the space scale — because the frame
      // must fit both the redacted-hint/dots trailing text and the trailing
      // IconButton without clipping either; deferred, no adoption target.
      <div
        className="flex h-[38px] max-w-md items-center gap-2 rounded-md border border-input bg-surface-control pl-3 pr-2"
        data-api-key-saved={boundRow.providerHint ?? undefined}
      >
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          {boundKey?.title ?? label}
        </span>
        {boundKey?.redactedHint ? (
          // Vault secrets are never re-shown — the redacted hint is the whole
          // disclosure, so there is no eye/reveal affordance here.
          <span className="shrink-0 font-mono text-ui-sm text-muted-foreground/65">
            {boundKey.redactedHint}
          </span>
        ) : (
          // tracking-[0.1em] is not a type-scale token — it exists only to
          // even out the bullet glyphs' own uneven advance width in the
          // masked-dots display, not to set prose rhythm.
          <span
            aria-hidden
            className="shrink-0 font-mono text-ui tracking-[0.1em] text-muted-foreground/85"
          >
            ••••••••
          </span>
        )}
        <IconButton
          aria-label={HARNESS_PANE_COPY.removeVariable}
          title={HARNESS_PANE_COPY.removeVariable}
          disabled={editor.busy}
          className="hover:bg-destructive-subtle hover:text-destructive"
          onClick={() => editor.handleRemoveRow(boundRow.uid)}
        >
          <Trash className="icon-paired" />
        </IconButton>
      </div>
    );
  }

  if (!envVarSuggestion) return null;

  const segments: SegmentedControlItem<string>[] = [
    { id: "paste", label: HARNESS_PANE_COPY.segmentPasteKey },
    { id: "saved", label: HARNESS_PANE_COPY.segmentSavedKeys },
    ...providerConfigKinds.map((kind) => ({
      id: kind,
      label: getProviderConfigFieldSpec(kind).displayName,
    })),
  ];

  const savedKeyPool = apiKeys.filter((key) => key.status === "active");

  return (
    <div className="space-y-3">
      <SegmentedControl
        ariaLabel="API key configuration path"
        items={segments}
        value={path}
        onChange={(next) => setPath(next as KeyPath)}
      />

      {path === "paste" ? (
        <div className="space-y-2">
          <form
            className="flex max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleInlinePaste();
            }}
          >
            <Input
              aria-label={keyLabel ?? "API key"}
              type="password"
              value={pastedKey}
              data-api-key-input={envVarSuggestion.providerHint ?? undefined}
              data-telemetry-mask
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste your ${keyLabel ?? "API key"}`}
              onChange={(event) => setPastedKey(event.currentTarget.value)}
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={createKey.isPending}
              disabled={editor.busy || createKey.isPending || pastedKey.trim().length === 0}
              data-api-key-save={envVarSuggestion.providerHint ?? undefined}
            >
              Save
            </Button>
          </form>
          <GetApiKeyLink />
        </div>
      ) : null}

      {path === "saved" ? (
        savedKeyPool.length > 0 ? (
          // Card, surface="opaque": closest match to the original border+
          // no-fill list shell. Adopting it adds the card's own bg-card fill
          // (the original had none) — a documented delta, not a regression:
          // "opaque" is the only Card variant that carries a border at all.
          <Card surface="opaque" as="section" className="max-w-md">
            <ul className="divide-y divide-border">
              {savedKeyPool.map((key) => (
                <li key={key.id}>
                  <Button
                    variant="unstyled"
                    size="unstyled"
                    type="button"
                    disabled={editor.busy}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
                    onClick={() => handleSavedKeySelect(key.id)}
                  >
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-control text-muted-foreground"
                    >
                      <KeyRound className="icon-compact" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
                      {key.title}
                    </span>
                    {key.redactedHint ? (
                      <span className="shrink-0 font-mono text-ui-sm text-muted-foreground/65">
                        {key.redactedHint}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-ui-sm text-muted-foreground">
                      {HARNESS_PANE_COPY.savedKeyUse}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.savedKeysEmpty}
          </p>
        )
      ) : null}

      {path !== "paste" && path !== "saved" ? (
        <ProviderConfigPanel kind={path} busy={editor.busy} />
      ) : null}
    </div>
  );
}

/**
 * "Get an API key" — the prototype links `#`, but the repo has no per-provider
 * console URL registry yet, so this is plain guidance text. No arrow glyph and
 * no link styling until a real href exists: an inert element dressed as a link
 * misleads both sighted and assistive-tech users.
 */
function GetApiKeyLink() {
  return (
    <p className="text-ui text-muted-foreground">
      {HARNESS_PANE_COPY.getApiKey}
    </p>
  );
}

/**
 * Typed provider-config panel (Bedrock/Azure). Renders for harnesses whose
 * registry declares a non-pending providerConfig kind (the segment above).
 *
 * FOLLOW-UP (typed-config UI wiring): the server side is fully open —
 * POST /v1/cloud/agent-auth/keys/provider-config stores the entry and a
 * selection referencing it (api_key source, NO envVarName) persists and
 * renders — but Save here is still a placeholder: the editor's row model
 * (EditableApiKeyRow / buildDesiredSources) is env-var-keyed and cannot yet
 * represent a typed row, so the collected payload is not wired anywhere.
 * The real mutation + typed-row editor support is the remaining UI half.
 */
function ProviderConfigPanel({ kind, busy }: { kind: ProviderConfigKind; busy: boolean }) {
  const spec = getProviderConfigFieldSpec(kind);
  const [values, setValues] = useState<Record<string, string>>({});
  const requiredFilled = spec.fields
    .filter((field) => field.required)
    .every((field) => (values[field.key] ?? "").trim().length > 0);

  return (
    // Card, surface="tint": fill matches the original bg-surface-elevated-
    // secondary exactly. The original also drew border-border on top of that
    // fill, but Card's own doc rules that combination out ("giving [tint] a
    // border too produces a third look nobody asked for") — the border is
    // dropped here rather than carried over as a className override.
    <Card surface="tint" className="max-w-md space-y-3 p-3.5">
      <div className="grid grid-cols-2 gap-2.5">
        {spec.fields.map((field) => (
          <Label key={field.key} className="mb-0 space-y-1 text-ui-sm text-muted-foreground">
            <span className="block">{field.label}</span>
            <Input
              type={field.secret ? "password" : "text"}
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              autoComplete="off"
              spellCheck={false}
              data-telemetry-mask={field.secret ? true : undefined}
              className="h-8"
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.key]: event.currentTarget.value }))}
            />
          </Label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-ui-sm text-muted-foreground/65">
          {HARNESS_PANE_COPY.configVaultNote}
        </p>
        <Button type="button" variant="primary" size="sm" disabled={busy || !requiredFilled}>
          Save
        </Button>
      </div>
    </Card>
  );
}
