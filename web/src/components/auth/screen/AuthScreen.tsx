import { Github } from "lucide-react";
import { useState } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { webEnv } from "../../../config/env";
import { startBrowserOAuth } from "../../../lib/access/cloud/client";
import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function AuthScreen() {
  const { setToken } = useAuthToken();
  const [manualToken, setManualToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function start(provider: "github" | "google") {
    setError(null);
    try {
      await startBrowserOAuth(webEnv.apiBaseUrl, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign in.");
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-card">
            <ProliferateMark size={30} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">Proliferate</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Run and orchestrate coding agents from cloud surfaces.
          </p>
        </div>

        <div className="grid gap-2">
          <Button className="h-12 w-full justify-center" onClick={() => start("github")}>
            <Github size={17} />
            Continue with GitHub
          </Button>
          <Button
            className="h-12 w-full justify-center"
            variant="secondary"
            onClick={() => start("google")}
          >
            Continue with Google
          </Button>
        </div>

        <div className="mt-5 grid gap-2 rounded-lg border border-border bg-card p-3">
          <Input
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            placeholder="Paste a development access token"
          />
          <Button
            variant="secondary"
            disabled={!manualToken.trim()}
            onClick={() => setToken(manualToken.trim())}
          >
            Use token
          </Button>
        </div>

        {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
      </section>
    </div>
  );
}
