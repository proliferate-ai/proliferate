import { Github } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

import { useAuthToken } from "../../../providers/WebCloudProvider";

export function ConnectGitHubScreen() {
  const { clearToken } = useAuthToken();

  return (
    <div className="flex h-full items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <div className="flex size-10 items-center justify-center rounded-md bg-accent text-foreground">
          <Github size={19} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Connect GitHub</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          GitHub is required before cloud workspaces, automations, and shared
          sessions are available.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button disabled title="GitHub linking lands with the server callback in the auth implementation PR.">
            <Github size={15} />
            Continue with GitHub
          </Button>
          <Button variant="secondary" onClick={clearToken}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}
