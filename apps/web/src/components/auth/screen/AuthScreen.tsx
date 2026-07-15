import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { type AuthProviderName } from "@proliferate/cloud-sdk";
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
import { routes } from "../../../config/routes";
import { WEB_AUTH_COPY } from "../../../copy/auth/web-auth-copy";
import { useWebDeploymentSsoDiscovery } from "../../../hooks/auth/derived/use-web-deployment-sso-discovery";
import {
  startWebAuthFlow,
  startWebSsoFlow,
} from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

const WEB_SIGN_IN_PROVIDERS = new Set<AuthProviderName>(["github", "google"]);
type LoadingAuthTarget = AuthProviderName | "sso";

export function AuthScreen() {
  const { setToken, bootstrapUnreachable } = useAuthToken();
  const [manualToken, setManualToken] = useState("");
  const [ssoEmail, setSsoEmail] = useState("");
  const [showDevAccess, setShowDevAccess] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<LoadingAuthTarget | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const deploymentSsoDiscovery = useWebDeploymentSsoDiscovery();
  const busy = Boolean(loadingProvider);
  const deploymentSso = deploymentSsoDiscovery.data?.enabled
    && deploymentSsoDiscovery.data.scope === "deployment"
    ? deploymentSsoDiscovery.data
    : null;
  const providerActions = deploymentSso
    ? [{
      id: "sso",
      label: deploymentSsoActionLabel(deploymentSso.displayName),
      icon: (
        <ProviderBrandIcon provider="sso" label={deploymentSso.displayName} />
      ),
      loading: loadingProvider === "sso",
      disabled: busy,
      primary: true,
      onClick: () => void signInWithDeploymentSso(),
    }]
    : deploymentSsoDiscovery.isLoading
    ? [{
      id: "sso-discovery",
      label: "Checking sign-in options",
      icon: <ProviderBrandIcon provider="sso" />,
      loading: true,
      disabled: true,
      primary: true,
      onClick: () => {},
    }]
    : AUTH_PROVIDER_ORDER
    .filter((provider) => WEB_SIGN_IN_PROVIDERS.has(provider))
    .map((provider) => ({
      id: provider,
      label: authProviderPresentation(provider).actionLabel,
      icon: providerIcon(provider),
      loading: loadingProvider === provider,
      disabled: busy,
      primary: provider === "github",
      onClick: () => void signIn(provider),
    }));
  const credentialForm = deploymentSso || deploymentSsoDiscovery.isLoading
    ? null
    : (
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void signInWithSso();
        }}
      >
        <Input
          type="email"
          value={ssoEmail}
          onChange={(event) => setSsoEmail(event.target.value)}
          placeholder="name@company.com"
          className="text-sm"
          disabled={busy}
          autoComplete="email"
        />
        <Button
          type="submit"
          size="md"
          variant="secondary"
          className="w-full"
          loading={loadingProvider === "sso"}
          disabled={busy || !ssoEmail.trim()}
        >
          <ProviderBrandIcon provider="sso" className="size-[15px]" />
          Continue with SSO
        </Button>
      </form>
    );

  async function signIn(provider: AuthProviderName) {
    if (busy) {
      return;
    }
    setProviderError(null);
    setLoadingProvider(provider);
    try {
      await startWebAuthFlow({ provider });
    } catch (authError) {
      setLoadingProvider(null);
      setProviderError(authError instanceof Error ? authError.message : "Sign in could not start.");
    }
  }

  async function signInWithSso() {
    if (busy) {
      return;
    }
    setProviderError(null);
    setLoadingProvider("sso");
    try {
      await startWebSsoFlow({ email: ssoEmail });
    } catch (authError) {
      setLoadingProvider(null);
      setProviderError(authError instanceof Error ? authError.message : "SSO could not start.");
    }
  }

  async function signInWithDeploymentSso() {
    if (busy || !deploymentSso) {
      return;
    }
    setProviderError(null);
    setLoadingProvider("sso");
    try {
      await startWebSsoFlow({
        organizationId: deploymentSso.organizationId ?? null,
        connectionId: deploymentSso.connectionId ?? null,
      });
    } catch (authError) {
      setLoadingProvider(null);
      setProviderError(authError instanceof Error ? authError.message : "SSO could not start.");
    }
  }

  return (
    <AuthStartPanel
      mark={<ProliferateMark size={36} />}
      title={AUTH_SIGN_IN_COPY.title}
      subtitle={(
        <span>
          <span className="font-medium text-foreground/80">{WEB_AUTH_COPY.betaLabel}.</span>{" "}
          {WEB_AUTH_COPY.subtitle}
        </span>
      )}
      footer={<span className="block text-faint">{AUTH_SIGN_IN_COPY.footer}</span>}
      credentialForm={credentialForm}
      providers={providerActions}
      note={deploymentSso || deploymentSsoDiscovery.isLoading ? null : (
        <Link
          to={routes.ssoLogin}
          className="underline underline-offset-4 hover:text-foreground"
        >
          Sign in with SSO
        </Link>
      )}
      error={providerError ?? (bootstrapUnreachable ? localApiUnreachableNotice() : null)}
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

function deploymentSsoActionLabel(displayName: string | null | undefined) {
  const name = displayName?.trim() || "SSO";
  return name.toLowerCase().includes("sso")
    ? `Continue with ${name}`
    : `Continue with ${name} SSO`;
}

function localApiUnreachableNotice() {
  return (
    <>
      Local API is not reachable at <code>{webEnv.apiBaseUrl}</code>. Start the
      Proliferate API or set <code>VITE_PROLIFERATE_API_BASE_URL</code> before
      signing in.
    </>
  );
}
