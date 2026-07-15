import { useEffect, useState } from "react";
import { useRepositories, useUpdateRepoConfig } from "@proliferate/cloud-sdk-react";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth";

const MAX_INSTRUCTIONS_CHARS = 4000;

/**
 * Repo → Configure: repo-specific instructions for AI-generated commit
 * messages (the publish dialog's leave-blank-to-generate flow). Stored on
 * the server RepoConfig; applied server-side when the daemon-collected diff
 * is summarized.
 */
export function RepoCommitInstructionsSection({
  gitOwner,
  gitRepoName,
}: {
  gitOwner: string;
  gitRepoName: string;
}) {
  // Gated on a signed-in account only — NOT on the cloud-compute capability:
  // the instructions live on the product server but apply to local
  // workspaces' commit generation too.
  const enabled = useProductAuthStatus() === "authenticated";
  const repositories = useRepositories(enabled);
  const updateMutation = useUpdateRepoConfig();

  const saved = repositories.data?.repositories.find((repo) =>
    repo.gitOwner === gitOwner && repo.gitRepoName === gitRepoName)
    ?.commitInstructions ?? "";
  const [draft, setDraft] = useState(saved);
  const [seeded, setSeeded] = useState<string | null>(null);
  // Reseed the draft when the repo (or its saved value) changes underneath.
  const seedKey = `${gitOwner}/${gitRepoName}:${saved}`;
  useEffect(() => {
    if (seeded !== seedKey) {
      setSeeded(seedKey);
      setDraft(saved);
    }
  }, [saved, seedKey, seeded]);

  const dirty = draft !== saved;

  if (!enabled || repositories.isLoading) {
    return null;
  }

  return (
    <SettingsSection title="Commit messages">
      <div className="space-y-2 pt-2">
        <Textarea
          aria-label="Commit message instructions"
          rows={3}
          value={draft}
          maxLength={MAX_INSTRUCTIONS_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={"Prefix with a conventional-commit type.\nMention the ticket from the branch name when present."}
          disabled={updateMutation.isPending}
          // Quiet field on the settings surface: page-dark with a hairline
          // border, not the grey control fill.
          className="border-border bg-transparent"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui-sm text-muted-foreground/80">
            Guides generated commit messages when the message is left blank.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {updateMutation.error && (
              <span className="text-ui-sm text-destructive">
                {updateMutation.error.message}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dirty || updateMutation.isPending}
              onClick={() => setDraft(saved)}
            >
              Revert
            </Button>
            <Button
              type="button"
              variant="inverted"
              size="sm"
              loading={updateMutation.isPending}
              disabled={!dirty}
              onClick={() => {
                updateMutation.mutate({
                  gitOwner,
                  gitRepoName,
                  body: { commitInstructions: draft },
                });
              }}
            >
              Save instructions
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
