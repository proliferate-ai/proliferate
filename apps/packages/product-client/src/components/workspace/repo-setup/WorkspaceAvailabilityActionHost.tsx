import { useCallback, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@proliferate/ui/kit/AlertDialog";
import { RadioCardGroup } from "@proliferate/ui/primitives/RadioCardGroup";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { remoteRepoKey } from "#product/lib/domain/workspaces/cloud/logical-workspace-source";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { useStandardRepoProjection } from "#product/hooks/workspaces/derived/use-standard-repo-projection";
import { useWorkspaceAvailabilityActions } from "#product/hooks/workspaces/workflows/use-workspace-availability-actions";
import {
  collectLinkCandidates,
  type LinkCandidate,
} from "#product/lib/domain/workspaces/cloud/link-copies-candidates";
import { WorkspaceReconciliationDialog } from "#product/components/workspace/repo-setup/WorkspaceReconciliationDialog";
import {
  useWorkspaceAvailabilityIntentStore,
  type WorkspaceAvailabilityIntent,
} from "#product/stores/cloud/workspace-availability-intent-store";
import { useToastStore } from "#product/stores/toast/toast-store";

const UNLINK_COPY =
  "This removes the association on this Mac. It does not delete either checkout, "
  + "repository, Cloud workspace, or chat history.";

/**
 * The one connected host that owns the active workspace-availability action
 * (PR 5 Flows 2/3/5), mirroring CloudRepoActionDialogHost. It resolves the
 * intent's target from the live projection, shows the required confirmation /
 * progress, and drives useWorkspaceAvailabilityActions (all orchestration lives
 * in product-client). A cold restart leaves the store empty (nothing resumes).
 */
export function WorkspaceAvailabilityActionHost() {
  const intent = useWorkspaceAvailabilityIntentStore((state) => state.activeIntent);
  const clearIntent = useWorkspaceAvailabilityIntentStore((state) => state.clear);
  const beginIntent = useWorkspaceAvailabilityIntentStore((state) => state.begin);
  const host = useProductHost();
  const files = host.desktop?.files ?? null;
  const showToast = useToastStore((state) => state.show);
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { repoRoots, localWorkspaces } = useStandardRepoProjection();
  const { openOnThisMac, linkCopies, addCloudCopy, unlinkThisMac } = useWorkspaceAvailabilityActions();
  const [busy, setBusy] = useState(false);
  // The chosen link candidate, once the user has picked one (or when there is
  // exactly one plausible candidate). Null means "not yet chosen".
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // Resolve an existing local repo root that already hosts the Cloud repo, so
  // Open-on-Mac reuses a clone instead of prompting for a fresh one.
  const cloudWorkspace = useMemo(() => {
    if (!intent || !("cloudWorkspaceId" in intent)) {
      return null;
    }
    const match = logicalWorkspaces.find(
      (w) => w.cloudWorkspace?.id === intent.cloudWorkspaceId,
    );
    return match?.cloudWorkspace ?? null;
  }, [intent, logicalWorkspaces]);

  // Flow 4 candidates: the plausible same-repo/same-branch local workspaces the
  // user could link this Cloud copy to. Exact linkability (clean, exact HEAD) is
  // proven per-candidate at confirm time; this only narrows the choice set.
  const linkCandidates = useMemo<LinkCandidate[]>(() => {
    if (!intent || intent.kind !== "link_copies" || !cloudWorkspace?.repo) {
      return [];
    }
    const alreadyLinked = new Set(
      (cloudWorkspace.materializations ?? [])
        .filter((m) => m.targetKind === "local_desktop" && m.anyharnessWorkspaceId)
        .map((m) => m.anyharnessWorkspaceId!),
    );
    return collectLinkCandidates({
      localWorkspaces,
      repoRoots,
      cloudRepo: cloudWorkspace.repo,
      cloudBranch: cloudWorkspace.repo.branch,
      alreadyLinkedAnyharnessIds: alreadyLinked,
    });
  }, [cloudWorkspace, intent, localWorkspaces, repoRoots]);

  const existingRepoRootId = useMemo(() => {
    const repo = cloudWorkspace?.repo;
    if (!repo) {
      return null;
    }
    const key = remoteRepoKey(repo.provider, repo.owner, repo.name);
    const match = repoRoots.find(
      (root) =>
        root.remoteProvider
        && root.remoteOwner
        && root.remoteRepoName
        && remoteRepoKey(root.remoteProvider, root.remoteOwner, root.remoteRepoName) === key,
    );
    return match?.id ?? null;
  }, [cloudWorkspace, repoRoots]);

  const runOpenOnMac = useCallback(async (cloudWorkspaceId: string, forceFreshWorktree: boolean) => {
    let cloneDestinationPath: string | null = null;
    if (!existingRepoRootId) {
      if (!files) {
        showToast("Cloning is only available in Desktop.");
        return;
      }
      const parent = await files.pickDirectory();
      if (!parent) {
        return;
      }
      const repoName = cloudWorkspace?.repo?.name ?? "repository";
      cloneDestinationPath = `${parent.replace(/\/+$/u, "")}/${repoName}`;
    }
    setBusy(true);
    const ok = await openOnThisMac({
      cloudWorkspaceId,
      existingRepoRootId,
      cloneDestinationPath,
      forceFreshWorktree,
    });
    setBusy(false);
    if (ok) {
      clearIntent();
    }
  }, [cloudWorkspace, clearIntent, existingRepoRootId, files, openOnThisMac, showToast]);

  const closeIntent = useCallback(() => {
    setSelectedCandidateId(null);
    clearIntent();
  }, [clearIntent]);

  const runLink = useCallback(async (candidate: LinkCandidate) => {
    if (!cloudWorkspace) {
      return;
    }
    const managed = (cloudWorkspace.materializations ?? []).find(
      (m) => m.targetKind === "managed_cloud",
    );
    const alreadyLinkedRow = (cloudWorkspace.materializations ?? []).find(
      (m) => m.targetKind === "local_desktop"
        && m.anyharnessWorkspaceId === candidate.anyharnessWorkspaceId,
    );
    setBusy(true);
    const ok = await linkCopies({
      candidate,
      cloudTarget: {
        cloudWorkspaceId: cloudWorkspace.id,
        provider: cloudWorkspace.repo?.provider ?? candidate.provider,
        owner: cloudWorkspace.repo?.owner ?? candidate.owner,
        repoName: cloudWorkspace.repo?.name ?? candidate.repoName,
        branch: cloudWorkspace.repo?.branch ?? null,
        // The Cloud copy's exact published HEAD from the managed materialization
        // (observed head), which the server also independently re-verifies.
        headSha: managed?.observedHeadSha ?? managed?.expectedHeadSha ?? null,
      },
      alreadyLinkedCloudWorkspaceId: alreadyLinkedRow ? cloudWorkspace.id : null,
    });
    setBusy(false);
    if (ok) {
      closeIntent();
    }
  }, [closeIntent, cloudWorkspace, linkCopies]);

  if (!intent) {
    return null;
  }

  if (intent.kind === "reconcile") {
    // PR 6: the one reconciliation dialog. Its recovery verbs hand off to the
    // EXISTING availability intents (relink/recreate/unlink/link) so there is one
    // command model, not a parallel one.
    const beginReconcileHandoff = (next: WorkspaceAvailabilityIntent) => {
      closeIntent();
      beginIntent(next);
    };
    return (
      <WorkspaceReconciliationDialog
        target={{
          localWorkspaceId: intent.localWorkspaceId,
          cloudWorkspaceId: intent.cloudWorkspaceId,
          materializationId: intent.materializationId,
        }}
        logicalWorkspaces={logicalWorkspaces}
        onRelink={(cloudWorkspaceId) =>
          beginReconcileHandoff({ kind: "relink", cloudWorkspaceId, mode: "relink" })}
        onRecreate={(cloudWorkspaceId) =>
          beginReconcileHandoff({ kind: "relink", cloudWorkspaceId, mode: "recreate" })}
        onUnlink={(cloudWorkspaceId, materializationId) =>
          beginReconcileHandoff({ kind: "unlink", cloudWorkspaceId, materializationId })}
        onLink={(cloudWorkspaceId) =>
          beginReconcileHandoff({ kind: "link_copies", cloudWorkspaceId })}
        onClose={closeIntent}
      />
    );
  }

  if (intent.kind === "unlink") {
    return (
      <AlertDialog open onOpenChange={(open) => { if (!open && !busy) closeIntent(); }}>
        <AlertDialogContent overlayClassName="bg-black/70 backdrop-blur-sm" data-telemetry-block>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink this Mac?</AlertDialogTitle>
            <AlertDialogDescription>{UNLINK_COPY}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => closeIntent()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setBusy(true);
                void unlinkThisMac({
                  cloudWorkspaceId: intent.cloudWorkspaceId,
                  materializationId: intent.materializationId,
                }).then((ok) => {
                  setBusy(false);
                  if (ok) closeIntent();
                });
              }}
            >
              {busy ? "Unlinking…" : "Unlink this Mac"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (intent.kind === "link_copies") {
    // Flow 4: association-only. Multiple plausible candidates require explicit
    // selection; we NEVER auto-pick the first when >1 (PR5-LINK-02). Zero
    // candidates is a truthful dead end, not a materialization.
    const chosen = linkCandidates.length === 1
      ? linkCandidates[0]!
      : linkCandidates.find((c) => c.anyharnessWorkspaceId === selectedCandidateId) ?? null;
    const description = linkCandidates.length === 0
      ? "No local copy of this workspace on this Mac matches the Cloud copy's repository "
        + "and branch, so there is nothing to link. Use “Open on this Mac” to create one."
      : linkCandidates.length === 1
        ? "This links your existing local copy to the Cloud workspace. It changes neither "
          + "checkout — both must already be the exact same commit."
        : "Choose which local copy to link. This links the copy you pick to the Cloud "
          + "workspace and changes neither checkout.";
    return (
      <AlertDialog open onOpenChange={(open) => { if (!open && !busy) closeIntent(); }}>
        <AlertDialogContent overlayClassName="bg-black/70 backdrop-blur-sm" data-telemetry-block>
          <AlertDialogHeader>
            <AlertDialogTitle>Link copies</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {linkCandidates.length > 1 ? (
            <RadioCardGroup
              className="py-1"
              orientation="vertical"
              value={selectedCandidateId}
              onChange={setSelectedCandidateId}
              options={linkCandidates.map((candidate) => ({
                value: candidate.anyharnessWorkspaceId,
                label: candidate.displayName,
                description: candidate.worktreePath,
                disabled: busy,
              }))}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => closeIntent()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || chosen === null}
              onClick={(event) => {
                event.preventDefault();
                if (chosen) {
                  void runLink(chosen);
                }
              }}
            >
              {busy ? "Linking…" : "Link copies"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (intent.kind === "open_on_mac" || intent.kind === "relink") {
    const cloudWorkspaceId = intent.cloudWorkspaceId;
    // Recreate (Flow 5) forces a fresh worktree; open/relink reuse or adopt a
    // clean checkout at the ref (PR5-MODE-03).
    const forceFreshWorktree = intent.kind === "relink" && intent.mode === "recreate";
    const title = intent.kind === "open_on_mac"
      ? "Open on this Mac"
      : forceFreshWorktree
        ? "Recreate on this Mac"
        : "Relink existing copy";
    const description = forceFreshWorktree
      ? "This creates a fresh local checkout of the Cloud workspace's exact published "
        + "commit on this Mac and links the two."
      : existingRepoRootId
        ? "This creates a local checkout of the Cloud workspace's exact published commit "
          + "on this Mac and links the two."
        : "This clones the repository to a folder you choose, checks out the exact published "
          + "commit, and links it to the Cloud workspace.";
    return (
      <AlertDialog open onOpenChange={(open) => { if (!open && !busy) closeIntent(); }}>
        <AlertDialogContent overlayClassName="bg-black/70 backdrop-blur-sm" data-telemetry-block>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => closeIntent()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void runOpenOnMac(cloudWorkspaceId, forceFreshWorktree);
              }}
            >
              {busy
                ? "Working…"
                : forceFreshWorktree
                  ? "Recreate on this Mac"
                  : existingRepoRootId
                    ? "Open on this Mac"
                    : "Choose folder & clone"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // add_cloud_copy
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) closeIntent(); }}>
      <AlertDialogContent overlayClassName="bg-black/70 backdrop-blur-sm" data-telemetry-block>
        <AlertDialogHeader>
          <AlertDialogTitle>Add Cloud copy</AlertDialogTitle>
          <AlertDialogDescription>
            This creates a managed-Cloud copy at this workspace's exact published commit.
            The workspace must be clean and its branch published on GitHub.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={() => closeIntent()}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              setBusy(true);
              void addCloudCopy({
                localAnyharnessWorkspaceId: intent.localWorkspaceId,
                gitOwner: intent.gitOwner,
                gitRepoName: intent.gitRepoName,
              }).then((ok) => {
                setBusy(false);
                if (ok) closeIntent();
              });
            }}
          >
            {busy ? "Adding…" : "Add Cloud copy"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
