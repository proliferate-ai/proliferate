import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import type { HarnessAuthEditorApi } from "@/hooks/agents/workflows/use-harness-auth-editor";
import {
  isMultiSourceHarness,
  type AuthMethod,
} from "@/lib/domain/settings/harness-auth-sources";
import { type HarnessBlockVariant } from "./HarnessPanelBlock";
import { isMultiSourceApiKeyConfigVisible } from "./HarnessAuthSection";
import { GatewayDetails } from "./HarnessAuthGatewayDetails";
import { ApiKeyDetails } from "./HarnessAuthApiKeyDetails";
import { CliDetails } from "./HarnessAuthCliDetails";

interface HarnessAuthDetailsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  // Single-source harnesses pass the resolved radio method; multi-source
  // harnesses ignore it and render the union of active/config blocks.
  selectedMethod: AuthMethod;
  editor: HarnessAuthEditorApi;
  variant?: HarnessBlockVariant;
}

export function HarnessAuthDetailsSection({
  harnessKind,
  displayName,
  surface,
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
        <CliDetails surface={surface} editor={editor} variant={variant} />
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
      surface={surface}
      editor={editor}
      variant={variant}
    />
  );
}
