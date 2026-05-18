import { Github } from "lucide-react";
import { useState } from "react";

import { Button } from "@proliferate/ui/primitives/Button";

import { webEnv } from "../../../config/env";
import { startBrowserOAuth } from "../../../lib/access/cloud/client";
import { useAuthToken } from "../../../providers/WebCloudProvider";

export function ConnectGitHubScreen() {
  const { clearToken } = useAuthToken();
  const [error, setError] = useState<string | null>(null);

  async function connectGitHub() {
    setError(null);
    try {
      await startBrowserOAuth(webEnv.apiBaseUrl, "github");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start GitHub sign in.");
    }
  }

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
          <Button onClick={connectGitHub}>
            <Github size={15} />
            Continue with GitHub
          </Button>
          <Button variant="secondary" onClick={clearToken}>
            Sign out
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>
    </div>
  );
}
