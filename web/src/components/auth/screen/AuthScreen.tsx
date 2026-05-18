import { Apple, Github, KeyRound } from "lucide-react";
import { useState } from "react";

import type { AuthProviderName } from "@proliferate/cloud-sdk";
import { AuthLayout } from "@proliferate/product-ui/auth/AuthLayout";
import { AuthProviderButton } from "@proliferate/product-ui/auth/AuthProviderButton";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { webEnv } from "../../../config/env";
import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

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
    <AuthLayout
      mark={<ProliferateMark size={36} />}
      title={<span className="text-2xl tracking-tight">Proliferate</span>}
      subtitle="Run and orchestrate coding agents."
      footer={
        <span className="block text-faint">
          By continuing you agree to the Proliferate
          <br />
          Terms and Privacy Policy.
        </span>
      }
    >
      <AuthProviderButton
        icon={<Github size={18} />}
        loading={loadingProvider === "github"}
        disabled={Boolean(loadingProvider)}
        onClick={() => void signIn("github")}
      >
        Continue with GitHub
      </AuthProviderButton>
      <AuthProviderButton
        icon={<Apple size={18} />}
        loading={loadingProvider === "apple"}
        disabled={Boolean(loadingProvider)}
        onClick={() => void signIn("apple")}
      >
        Continue with Apple
      </AuthProviderButton>
      <AuthProviderButton
        icon={<GoogleGlyph />}
        loading={loadingProvider === "google"}
        disabled={Boolean(loadingProvider)}
        onClick={() => void signIn("google")}
      >
        Continue with Google
      </AuthProviderButton>

      <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
        GitHub is required for cloud workspaces and automations. You can link it
        after signing in with Apple or Google.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
          {error}
        </div>
      )}

      {webEnv.devAccessTokenLogin && (
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
      )}
    </AuthLayout>
  );
}

function GoogleGlyph() {
  return (
    <span className="text-[17px] font-semibold leading-none text-foreground" aria-hidden="true">
      G
    </span>
  );
}
