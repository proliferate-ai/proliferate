import { Github } from "lucide-react";
import { useState } from "react";

import { AuthLayout } from "@proliferate/product-ui/auth/AuthLayout";
import { AuthProviderButton } from "@proliferate/product-ui/auth/AuthProviderButton";
import { Button } from "@proliferate/ui/primitives/Button";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function ConnectGitHubScreen() {
  const { token, clearToken } = useAuthToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectGitHub() {
    if (!token || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await startWebAuthFlow({
        provider: "github",
        purpose: "required_github_link",
        accessToken: token,
      });
    } catch (connectError) {
      setLoading(false);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "GitHub linking could not start.",
      );
    }
  }

  return (
    <AuthLayout
      mark={<ProliferateMark size={32} />}
      title="Connect GitHub"
      subtitle={
        <>
          Proliferate runs cloud sessions on your behalf. Linking GitHub gives
          agents the access they need to read and modify your repos.
        </>
      }
      footer={
        <span className="block text-faint">
          We only request the permissions needed to materialize sandboxes and
          push branches.
        </span>
      }
    >
      <AuthProviderButton
        icon={<Github size={18} />}
        loading={loading}
        disabled={loading}
        onClick={() => void connectGitHub()}
      >
        Continue with GitHub
      </AuthProviderButton>
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive">
          {error}
        </div>
      )}
      <Button
        className="h-10 justify-center text-xs text-muted-foreground"
        variant="ghost"
        onClick={() => void clearToken()}
      >
        Sign out
      </Button>
    </AuthLayout>
  );
}
