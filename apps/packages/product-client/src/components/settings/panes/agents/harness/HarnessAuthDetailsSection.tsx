import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  isMultiSourceHarness,
  type AuthMethod,
} from "#product/lib/domain/settings/harness-auth-sources";
import { type HarnessBlockVariant } from "#product/components/settings/panes/agents/harness/HarnessPanelBlock";
import { isMultiSourceApiKeyConfigVisible } from "#product/components/settings/panes/agents/harness/HarnessAuthSection";
import { GatewayDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthGatewayDetails";
import { ApiKeyDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthApiKeyDetails";
import { CliDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthCliDetails";

interface HarnessAuthDetailsSectionProps {
  harnessKind: string;
  displayName: string;
  // Single-source harnesses pass the resolved radio method; multi-source
  // harnesses ignore it and render the union of active/config blocks.
  selectedMethod: AuthMethod;
  editor: HarnessAuthEditorApi;
  variant?: HarnessBlockVariant;
}

export function HarnessAuthDetailsSection({
  harnessKind,
  displayName,
  selectedMethod,
  editor,
  variant = "section",
}: HarnessAuthDetailsSectionProps) {
  // Multi-source (opencode): gateway, api_key, and native CLI can all be active
  // at once, so the details area is not a single-method switch. Render the
  // gateway block when gateway is on, the api_key block whenever there are rows
  // present or a key is being configured, and always the CLI/native block
  // (opencode's own providers always coexist).
  if (isMultiSourceHarness(harnessKind)) {
    return (
      <>
        {editor.editorState.gatewayEnabled ? (
          <GatewayDetails editor={editor} variant={variant} />
        ) : null}
        {isMultiSourceApiKeyConfigVisible(editor) ? (
          <ApiKeyDetails
            harnessKind={harnessKind}
            displayName={displayName}
            editor={editor}
            variant={variant}
          />
        ) : null}
        <CliDetails editor={editor} variant={variant} />
      </>
    );
  }

  if (selectedMethod === "gateway") {
    return <GatewayDetails editor={editor} variant={variant} />;
  }

  if (selectedMethod === "api_key") {
    return (
      <ApiKeyDetails
        harnessKind={harnessKind}
        displayName={displayName}
        editor={editor}
        variant={variant}
      />
    );
  }

  return (
    <CliDetails
      editor={editor}
      variant={variant}
    />
  );
}
