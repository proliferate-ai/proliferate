import { Github } from "lucide-react";
import { useState } from "react";

import { ConnectGitHubRequiredPanel } from "@proliferate/product-ui/auth/ConnectGitHubRequiredPanel";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";

import { startWebAuthFlow } from "../../../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../../../providers/WebCloudProvider";

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
    <ConnectGitHubRequiredPanel
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
      actionIcon={<Github size={18} />}
      actionLabel="Continue with GitHub"
      loading={loading}
      error={error}
      onConnect={() => void connectGitHub()}
      onSignOut={() => void clearToken()}
    />
  );
}
