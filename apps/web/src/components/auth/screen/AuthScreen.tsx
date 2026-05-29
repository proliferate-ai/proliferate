import { KeyRound } from "lucide-react";
import { useState } from "react";

import type { AuthProviderName } from "@proliferate/cloud-sdk";
import {
  AUTH_PROVIDER_ORDER,
  AUTH_SIGN_IN_COPY,
  authProviderPresentation,
} from "@proliferate/product-domain/auth/presentation";
import { AuthStartPanel } from "@proliferate/product-ui/auth/AuthStartPanel";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { webEnv } from "../../../config/env";
import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export function AuthScreen() {
  const { setToken } = useAuthToken();
  const [manualToken, setManualToken] = useState("");
  const [showDevAccess, setShowDevAccess] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<AuthProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: AuthProviderName) {
    if (loadingProvider) {
      return;
    }
    setError(null);
    setLoadingProvider(provider);
    try {
      await startWebAuthFlow({ provider });
    } catch (authError) {
      setLoadingProvider(null);
      setError(authError instanceof Error ? authError.message : "Sign in could not start.");
    }
  }

  return (
    <AuthStartPanel
      mark={<ProliferateMark size={36} />}
      title={AUTH_SIGN_IN_COPY.title}
      subtitle={AUTH_SIGN_IN_COPY.subtitle}
      footer={<span className="block text-faint">{AUTH_SIGN_IN_COPY.footer}</span>}
      providers={AUTH_PROVIDER_ORDER.map((provider) => ({
        id: provider,
        label: authProviderPresentation(provider).actionLabel,
        icon: providerIcon(provider),
        loading: loadingProvider === provider,
        disabled: Boolean(loadingProvider),
        primary: provider === "github",
        onClick: () => void signIn(provider),
      }))}
      note={AUTH_SIGN_IN_COPY.note}
      error={error}
      devAccess={webEnv.devAccessTokenLogin ? (
        <div className="mt-2 border-t border-border pt-4">
          {showDevAccess ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <KeyRound size={12} />
                Development access
              </div>
              <Input
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Paste a development access token"
                className="text-sm"
                data-telemetry-mask
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowDevAccess(false);
                    setManualToken("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!manualToken.trim()}
                  onClick={() => setToken(manualToken.trim())}
                >
                  Use token
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => setShowDevAccess(true)}
              className="block w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Use a development access token
            </Button>
          )}
        </div>
      ) : null}
    />
  );
}

function providerIcon(provider: AuthProviderName) {
  return <ProviderBrandIcon provider={provider} />;
}
