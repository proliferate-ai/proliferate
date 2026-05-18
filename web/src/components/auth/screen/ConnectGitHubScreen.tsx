import { Github } from "lucide-react";

import { AuthLayout } from "@proliferate/ui/auth/AuthLayout";
import { AuthProviderButton } from "@proliferate/ui/auth/AuthProviderButton";
import { Button } from "@proliferate/ui/primitives/Button";

import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function ConnectGitHubScreen() {
  const { clearToken } = useAuthToken();

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
        disabled
        title="GitHub linking lands with the server callback in the auth implementation PR."
      >
        Continue with GitHub
      </AuthProviderButton>
      <Button
        className="h-10 justify-center text-xs text-muted-foreground"
        variant="ghost"
        onClick={clearToken}
      >
        Sign out
      </Button>
    </AuthLayout>
  );
}
