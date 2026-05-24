# SSH Targets UI Context Bundle

Generated for a design/mockup pass on the SSH Targets settings page. This file intentionally bundles product intent, docs excerpts, and the current source that shapes the page and related target-selection flows.

## Product Direction

- Rename the current overloaded **Compute** page to **SSH Targets** for the user-facing V1.
- V1 should answer: **Can Proliferate run work on this external machine, and where is it allowed to be used?**
- Treat this page as inventory, setup, readiness, and light policy for SSH/manual external targets.
- Do not show **This Mac** here; that belongs in local runtime / desktop dispatch settings.
- Do not show **Shared cloud sandbox** here; that belongs in Shared Sandbox / shared environment settings.
- Do not expose or configure Agent Auth, Agent Defaults, model defaults, or harness-specific configuration here. SSH targets should use the same target-level launch/configuration path as the rest of the product.
- Do not make this the runtime config authoring surface. Show whether runtime config exists and link out to the owning settings page.

## Ruthless V1 Functionality

Keep on SSH Targets:

- Target list: name, scope, host label, status, last seen, and quick actions such as test/configure/disable.
- Add/edit target: display name, personal/org scope, SSH host/user/port, SSH key or connection method, workspace root, save, and test connection.
- Readiness summary: Ready, Offline, Needs worker, Missing Git, Missing Node, Missing Python/uv, Missing runtime config.
- Expandable readiness details: worker heartbeat/version, Git, Node/npm, Python/uv, runtime config/profile state.
- Usage policy: whether the target is available for new chats, automations, migrations, and team/shared work.
- Treat agent/model/harness config as fully separate. A selected SSH target should inherit the same agent configuration flow as any other target, with no SSH-specific agent settings.

Move or cut from SSH Targets:

- Managed cloud sandboxes and shared cloud sandbox cards.
- Desktop/local runtime entries like This Mac.
- Full credential source management, credential syncing, secret selection, Agent Auth, Agent Defaults, model defaults, or harness-specific controls.
- Full runtime profile editor.
- Long prose explainer blocks repeated per readiness item.
- Any cloud-only team environment controls that belong in Shared Sandbox / Environments.

Related but separate reusable control:

- **Target Setting / picker** appears in new chats, automations, migration, and mobile dispatch. It chooses where work runs.
- **SSH Targets page** configures external machines that can become choices in that picker.

## Current User-Facing Compute Copy Snapshot

- Page title today: `Compute`.
- Current framing: `SSH targets and runtimes available to cloud-dispatchable agent work. Each target gets an icon and color for quick visual identification.`
- User critique: the page is overloaded and should likely only show SSH targets.
- Current UI also shows organization targets like `Shared cloud sandbox`, personal targets like `This Mac`, readiness, direct SSH access, and agent auth cards. The redesign should remove that coupling from SSH Targets: agent/auth/model settings are separate product surfaces.

## Docs Excerpts

### docs/architecture/cloud-worker-pr-stack-review-guide.md

#### PR #214: Compute Targets and Worker Enrollment

Lines 327-414:

````markdown
 327 | ## PR #214: Compute Targets And Worker Enrollment
 328 | 
 329 | Link: https://github.com/proliferate-ai/proliferate/pull/214
 330 | 
 331 | ### Purpose
 332 | 
 333 | Adds the target registry and first target-side install/enrollment loop:
 334 | 
 335 | - Cloud target records
 336 | - one-time enrollment tokens
 337 | - worker heartbeat and inventory persistence
 338 | - Rust `proliferate-worker`
 339 | - Rust `proliferate-supervisor`
 340 | - SSH installer
 341 | - Desktop Compute settings pane
 342 | 
 343 | ### User-Visible Behavior
 344 | 
 345 | Desktop gets a Compute pane where users can:
 346 | 
 347 | - list targets
 348 | - inspect readiness/inventory
 349 | - create an SSH enrollment command
 350 | - archive targets
 351 | 
 352 | Running the installer on a remote machine turns it into a Cloud-visible target.
 353 | 
 354 | ### Architecture Flow
 355 | 
 356 | ```text
 357 | User creates enrollment
 358 |   -> Cloud creates cloud_targets row and hashed single-use token
 359 |   -> installer writes worker/supervisor config
 360 |   -> worker POST /v1/cloud/worker/enroll
 361 |   -> Cloud returns worker token
 362 |   -> worker stores identity in local SQLite
 363 |   -> worker sends inventory and heartbeats
 364 |   -> Cloud updates target status and inventory
 365 | ```
 366 | 
 367 | ### Important Files
 368 | 
 369 | - `server/proliferate/server/cloud/targets/{api,models,service}.py`
 370 | - `server/proliferate/server/cloud/worker/{api,models,service}.py`
 371 | - `server/proliferate/db/models/cloud/targets.py`
 372 | - `server/proliferate/db/store/cloud_sync/{targets,worker_auth,inventory}.py`
 373 | - `server/alembic/versions/c4d5e6f7a8b9_cloud_targets_workers.py`
 374 | - `anyharness/crates/proliferate-worker/**`
 375 | - `anyharness/crates/proliferate-supervisor/**`
 376 | - `install/proliferate-target-install.sh`
 377 | - `desktop/src/components/settings/panes/ComputePane.tsx`
 378 | 
 379 | ### Key Endpoints And Tables
 380 | 
 381 | User APIs:
 382 | 
 383 | - `POST /v1/cloud/targets/enrollments`
 384 | - `GET /v1/cloud/targets`
 385 | - `GET /v1/cloud/targets/{target_id}`
 386 | - `POST /v1/cloud/targets/{target_id}/archive`
 387 | 
 388 | Worker APIs:
 389 | 
 390 | - `POST /v1/cloud/worker/enroll`
 391 | - `POST /v1/cloud/worker/heartbeat`
 392 | - `POST /v1/cloud/worker/inventory`
 393 | 
 394 | Tables:
 395 | 
 396 | - `cloud_targets`
 397 | - `cloud_workers`
 398 | - `cloud_target_enrollments`
 399 | - `cloud_target_inventory`
 400 | - `cloud_target_status`
 401 | 
 402 | ### Review Checklist
 403 | 
 404 | - Enrollment tokens are hashed, single-use, and expire.
 405 | - Archived target tokens are rejected.
 406 | - Target list/get/archive are org/user scoped.
 407 | - Worker inventory does not expose raw secrets.
 408 | - Worker config and DB files are created with private permissions.
 409 | - Installer handles artifact URLs, install paths, and systemd launch safely.
 410 | - Desktop invalidates target queries after enrollment/archive.
 411 | 
 412 | ### Relationship And Risk
 413 | 
 414 | This PR makes targets real. Later PRs depend on its target IDs, worker tokens,
````

#### Target config materialization / runtime profiles

Lines 867-950:

````markdown
 867 | Adds target-scoped materialization for environment/config state needed before a
 868 | session runs on SSH, managed Cloud, or desktop-dispatch targets.
 869 | 
 870 | Materialization can include:
 871 | 
 872 | - env files
 873 | - repo files
 874 | - Git credentials
 875 | - MCP package/config data
 876 | - skills
 877 | - agent credential files
 878 | 
 879 | ### User-Visible Behavior
 880 | 
 881 | Users can request materialization for a target/repo and inspect target config
 882 | records/status. Worker-owned secret plans are not exposed in user-facing
 883 | responses.
 884 | 
 885 | ### Architecture Flow
 886 | 
 887 | ```text
 888 | User requests materialization
 889 |   -> Cloud validates target/repo/config
 890 |   -> Cloud stores encrypted plan in cloud_target_configs
 891 |   -> Cloud queues materialize_environment command
 892 |   -> worker leases command
 893 |   -> worker fetches materialization plan with command_id/config_version/lease_id
 894 |   -> worker writes local files/config
 895 |   -> worker reports status
 896 | ```
 897 | 
 898 | The worker should not decide which credentials or bundles are allowed. Cloud
 899 | resolves that policy and sends a narrow plan.
 900 | 
 901 | ### Important Files
 902 | 
 903 | - `server/proliferate/server/cloud/target_config/{api,models,service}.py`
 904 | - `server/proliferate/server/cloud/target_config/domain/**`
 905 | - `server/proliferate/db/models/cloud/target_config.py`
 906 | - `server/proliferate/db/store/cloud_sync/target_config.py`
 907 | - `server/alembic/versions/d0*.py`
 908 | - `anyharness/crates/proliferate-worker/src/materialization/{env,files,git,mcp,skills,mod}.rs`
 909 | - `anyharness/crates/proliferate-worker/src/cloud_client/target_config.rs`
 910 | - `anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`
 911 | - `cloud/sdk/src/client/target-configs.ts`
 912 | 
 913 | ### Key Endpoints, Command, And Table
 914 | 
 915 | User APIs:
 916 | 
 917 | - `GET /v1/cloud/targets/{targetId}/configs`
 918 | - `GET /v1/cloud/targets/{targetId}/configs/{configId}`
 919 | - `POST /v1/cloud/targets/{targetId}/configs/materialize`
 920 | 
 921 | Worker APIs:
 922 | 
 923 | - `GET /v1/cloud/worker/target-configs/{configId}/materialization?command_id=&config_version=&lease_id=`
 924 | - `POST /v1/cloud/worker/target-configs/{configId}/status`
 925 | 
 926 | Command kind:
 927 | 
 928 | - `materialize_environment`
 929 | 
 930 | Table:
 931 | 
 932 | - `cloud_target_configs`
 933 | 
 934 | ### Review Checklist
 935 | 
 936 | - Encrypted plan contents never leak through user responses.
 937 | - Worker plan fetch requires the matching command ID, worker ID, lease ID, and
 938 |   config version.
 939 | - Stale commands cannot apply newer config materialization plans.
 940 | - Workspace-root validation matches worker-side canonicalization.
 941 | - Path traversal, symlink, absolute path, and parent-dir escapes are blocked.
 942 | - Files are written with private permissions where appropriate.
 943 | - Git config rejects control characters and unsafe keys.
 944 | - Agent credential file materialization is provider-keyed and allowlisted.
 945 | - Idempotency accounts for config version changes.
 946 | 
 947 | ### Relationship And Risk
 948 | 
 949 | This PR depends on durable commands and live target streams. It supplies the
 950 | target-preparation path needed for SSH/BYO targets, managed Cloud, MCP bundles,
````

#### Compute APIs

Lines 1009-1018:

````markdown
1009 | - `cloud/sdk/src/types/targets.ts`
1010 | 
1011 | ### Key Endpoints And Fields
1012 | 
1013 | Compute APIs:
1014 | 
1015 | - `POST /v1/cloud/compute/targets/{targetId}/desired-versions`
1016 | - `POST /v1/cloud/compute/targets/{targetId}/safe-stop-check`
1017 | - `POST /v1/cloud/compute/targets/{targetId}/revoke-workers`
1018 | 
````

### docs/architecture/shared-sandbox-config-admin-ui-spec.md

#### Target cardinality

Lines 152-163:

````markdown
 152 | 2. Managed cloud target cardinality becomes one per owner.
 153 | 
 154 |    The end state is:
 155 | 
 156 |    ```text
 157 |    user personal cloud      -> one unarchived managed_cloud target
 158 |    organization shared cloud -> one unarchived managed_cloud target
 159 |    personal SSH targets     -> many allowed
 160 |    organization SSH targets -> many allowed
 161 |    ```
 162 | 
 163 |    Workspaces and repos are materialized under that owner target. A repo should
````

#### Compute page relationship

Lines 993-1004:

````markdown
 993 | ### Compute Page
 994 | 
 995 | The existing Compute page should distinguish:
 996 | 
 997 | ```text
 998 | Personal targets
 999 | Organization targets
1000 | ```
1001 | 
1002 | Managed cloud targets are shown as the owner default managed target. SSH
1003 | targets can still be many. Organization SSH targets use the organization shared
1004 | profile when they run organization work.
````

#### SSH / non-direct access

Lines 1119-1128:

````markdown
1119 | ## SSH And Non-Direct Access
1120 | 
1121 | Organization SSH targets should use the same shared profile resolver as the
1122 | organization managed cloud target. The selected target changes where work runs,
1123 | not which shared MCPs, skills, agent credentials, or repo environment config
1124 | apply.
1125 | 
1126 | Workstream 2 should not require Desktop to have direct SSH or direct
1127 | AnyHarness access to an organization target. Cloud commands and the worker
1128 | control channel remain the standard path. Workstream 3 can add claiming and
````

### docs/current/implementation/00-cloud-target-managed-sandbox-foundation.md

#### Managed sandbox foundation context

Lines 1-220:

````markdown
   1 | # Cloud Target And Managed Sandbox Foundation
   2 | 
   3 | Date: 2026-05-20
   4 | 
   5 | Status: implementation planning reference for a single replacement PR.
   6 | 
   7 | This is the foundation underneath MCPs/skills/plugins, agent auth, shared
   8 | sandboxes, automations, Slack, web/mobile, and claiming.
   9 | 
  10 | ## Docs Read
  11 | 
  12 | - `docs/README.md`
  13 | - `docs/server/README.md`
  14 | - `docs/server/guides/database.md`
  15 | - `docs/server/guides/domains.md`
  16 | - `docs/architecture/cloud-work-launch-model-spec.md`
  17 | - `docs/architecture/cloud-worker-control-plane.md`
  18 | - `docs/architecture/cloud-worker-implementation-phases.md`
  19 | 
  20 | ## Goal
  21 | 
  22 | Move the managed cloud model from the current repo-scoped runtime environment
  23 | shape to a stable sandbox/profile shape:
  24 | 
  25 | ```text
  26 | personal cloud
  27 |   one managed cloud sandbox profile per user
  28 | 
  29 | shared cloud
  30 |   one managed cloud sandbox profile per organization
  31 | 
  32 | workspace
  33 |   durable row inside one sandbox profile and one target
  34 | ```
  35 | 
  36 | Implementation assumption:
  37 | 
  38 | ```text
  39 | No production users depend on the old schema.
  40 | No backwards-compatibility path is required.
  41 | Prefer replacing the old managed-cloud root model over dual-writing or
  42 | long-running compatibility shims.
  43 | ```
  44 | 
  45 | After this lands, later systems can say:
  46 | 
  47 | ```text
  48 | MCPs/skills/plugins
  49 |   configure sandbox profile desired runtime config
  50 | 
  51 | agent auth
  52 |   configure sandbox profile desired auth config
  53 | 
  54 | workspace/session launch
  55 |   requires the target for that profile to have applied current revisions
  56 | ```
  57 | 
  58 | ## High Level Notes / Mental Model Broadly
  59 | 
  60 | There are three different objects:
  61 | 
  62 | ```text
  63 | sandbox profile
  64 |   Stable product/config identity.
  65 |   Owns "what this personal/shared sandbox should be configured with."
  66 | 
  67 | cloud target
  68 |   Addressable worker + AnyHarness runtime.
  69 |   Owns "where commands go and what runtime state has actually been applied."
  70 | 
  71 | sandbox slot
  72 |   Managed compute/provider lifecycle.
  73 |   Owns "what E2B sandbox backs this managed cloud target right now."
  74 | ```
  75 | 
  76 | Current code already has several related pieces, but the root object is
  77 | different and should be replaced for managed cloud:
  78 | 
  79 | ```text
  80 | Current main:
  81 |   CloudWorkspace
  82 |     -> CloudRuntimeEnvironment, unique by user/org + repo + isolation policy
  83 |       -> CloudTarget
  84 |       -> CloudSandbox
  85 | 
  86 | Target model:
  87 |   CloudSandboxProfile, unique by user/org
  88 |     -> CloudTarget
  89 |       -> CloudSandboxSlot
  90 |       -> CloudWorkspace[]
  91 | ```
  92 | 
  93 | The current `CloudRuntimeEnvironment` is repo-scoped and mixes repo identity,
  94 | target identity, active provider sandbox, runtime URL/token, data key,
  95 | credential state, and env state. Since compatibility is not required, managed
  96 | cloud should stop using it as the root in this PR rather than carrying it as a
  97 | long-term bridge.
  98 | 
  99 | ## Basic UX / High Level
 100 | 
 101 | ### What Is The Relationship Between Sandboxes And People / Orgs?
 102 | 
 103 | V1 product invariant:
 104 | 
 105 | ```text
 106 | user
 107 |   -> one personal managed cloud sandbox profile
 108 | 
 109 | organization
 110 |   -> one shared managed cloud sandbox profile
 111 | ```
 112 | 
 113 | Do not create managed compute on signup or org creation.
 114 | 
 115 | Create the profile lazily on explicit cloud intent:
 116 | 
 117 | ```text
 118 | personal profile creation triggers:
 119 |   user clicks Enable Personal Cloud
 120 |   user configures personal cloud agent auth
 121 |   user configures personal cloud MCP/skills/plugins
 122 |   user configures a repo for personal cloud
 123 |   user starts first personal cloud workspace
 124 | 
 125 | organization profile creation triggers:
 126 |   admin clicks Enable Shared Cloud
 127 |   admin configures shared cloud agent auth
 128 |   admin makes MCPs/skills/plugins public and requests shared readiness
 129 |   admin creates first shared automation/Slack/cloud workspace requiring shared cloud
 130 | ```
 131 | 
 132 | The best UX should still present this as an explicit enablement flow:
 133 | 
 134 | ```text
 135 | Enable Personal Cloud
 136 |   create profile
 137 |   collect/check required config
 138 |   provision target/slot only when needed or when setup completes
 139 | 
 140 | Enable Shared Cloud
 141 |   create org profile
 142 |   collect shared auth/public MCP/repo/env config
 143 |   provision target/slot only when needed or when setup completes
 144 | ```
 145 | 
 146 | ### What Is The Relationship Between Workspace And The Cloud DB?
 147 | 
 148 | Every managed-cloud workspace should have a durable Cloud row before
 149 | AnyHarness materialization starts.
 150 | 
 151 | Cloud DB stores:
 152 | 
 153 | ```text
 154 | cloud_workspace
 155 |   sandbox_profile_id
 156 |   target_id
 157 |   owner scope
 158 |   repo identity
 159 |   branch/base branch
 160 |   worktree path
 161 |   AnyHarness workspace id once known
 162 |   status/lifecycle
 163 |   required runtime/auth revisions
 164 | ```
 165 | 
 166 | Cloud DB does not store:
 167 | 
 168 | ```text
 169 | full git worktree contents
 170 | live process state
 171 | raw AnyHarness caches
 172 | raw MCP credential values
 173 | raw provider secrets
 174 | ```
 175 | 
 176 | This makes passive UI possible:
 177 | 
 178 | ```text
 179 | E2B sandbox paused
 180 |   -> Cloud can still list workspaces/sessions/status from Cloud DB
 181 |   -> no need to wake compute just to render sidebar/history
 182 | ```
 183 | 
 184 | ### Managed Cloud Versus Non-Managed Targets
 185 | 
 186 | This spec is about managed cloud foundation first. Do not accidentally make
 187 | all targets subordinate to sandbox profiles.
 188 | 
 189 | ```text
 190 | managed_cloud target
 191 |   belongs to one sandbox profile when profile-managed
 192 |   uses the one primary target for that profile
 193 | 
 194 | ssh / desktop_dispatch / self_hosted_cloud target
 195 |   remains target-first
 196 |   may optionally be associated with a profile for policy/defaults later
 197 |   does not require a cloud_sandbox_slot
 198 | ```
 199 | 
 200 | The launch model remains target-first for non-managed targets. The profile is
 201 | the product/config root for personal/shared managed cloud; it is not a new
 202 | universal parent for every SSH or local target.
 203 | 
 204 | ## Current Repo Snapshot
 205 | 
 206 | ### Existing Models
 207 | 
 208 | ```text
 209 | server/proliferate/db/models/cloud/targets.py
 210 |   CloudTarget
 211 |   CloudWorker
 212 |   CloudTargetEnrollment
 213 |   CloudTargetInventory
 214 |   CloudTargetStatus
 215 | 
 216 | server/proliferate/db/models/cloud/sandboxes.py
 217 |   CloudSandbox
 218 | 
 219 | server/proliferate/db/models/cloud/runtime_environments.py
 220 |   CloudRuntimeEnvironment
````

## Source Files

### desktop/src/components/settings/panes/ComputePane.tsx

_Size: 5,176 bytes_

````tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { AddSshTargetDialog } from "@/components/settings/panes/compute/AddSshTargetDialog";
import { ComputeTargetDetails } from "@/components/settings/panes/compute/ComputeTargetDetails";
import { ComputeTargetList } from "@/components/settings/panes/compute/ComputeTargetList";
import { ChevronRight } from "@/components/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  useCloudTarget,
  useCloudTargets,
} from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

const EMPTY_TARGETS: ComputeTargetSummary[] = [];

interface ComputePaneProps {
  initialTargetId?: string | null;
}

export function ComputePane({ initialTargetId = null }: ComputePaneProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { data, isLoading } = useCloudTargets();
  const targets: ComputeTargetSummary[] = data ?? EMPTY_TARGETS;
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const consumedInitialTargetIdRef = useRef<string | null>(null);
  const selectedTargetExists = selectedTargetId
    ? targets.some((target) => target.id === selectedTargetId)
    : false;
  const effectiveTargetId = selectedTargetExists ? selectedTargetId : null;
  const selectedSummary = useMemo(
    () => targets.find((target) => target.id === effectiveTargetId) ?? null,
    [effectiveTargetId, targets],
  );
  const { data: selectedDetail, isLoading: detailLoading } = useCloudTarget(
    effectiveTargetId,
    Boolean(effectiveTargetId),
  );
  const { archiveTarget, isArchivingTarget } = useCloudTargetMutations();
  const appearancePreferences = useComputeTargetAppearancePreferences();

  useEffect(() => {
    if (
      initialTargetId
      && consumedInitialTargetIdRef.current !== initialTargetId
      && targets.some((target) => target.id === initialTargetId)
    ) {
      consumedInitialTargetIdRef.current = initialTargetId;
      setSelectedTargetId(initialTargetId);
    }
  }, [initialTargetId, targets]);

  useEffect(() => {
    if (selectedTargetId && !targets.some((target) => target.id === selectedTargetId)) {
      setSelectedTargetId(null);
    }
  }, [selectedTargetId, targets]);

  const commonDialog = (
    <AddSshTargetDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      onTargetAppearanceSaved={appearancePreferences.reload}
    />
  );

  if (effectiveTargetId) {
    return (
      <section className="space-y-6">
        <div className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelectedTargetId(null)}
            className="h-auto px-0 py-0 text-sm hover:bg-transparent"
          >
            {COMPUTE_COPY.title}
            <ChevronRight className="size-4" />
            <span className="text-foreground">
              {selectedSummary?.displayName ?? COMPUTE_COPY.targetFallbackTitle}
            </span>
          </Button>
        </div>

        <ComputeTargetDetails
          target={selectedDetail ?? selectedSummary}
          appearancePreference={appearancePreferences.preferences[effectiveTargetId] ?? null}
          loading={detailLoading}
          onSaveAppearance={appearancePreferences.savePreference}
          archiving={isArchivingTarget}
          onArchive={(targetId) => {
            setArchiveError(null);
            void archiveTarget(targetId).then(() => {
              setSelectedTargetId(null);
            }).catch((error) => {
              setArchiveError(
                error instanceof Error ? error.message : COMPUTE_COPY.archiveError,
              );
            });
          }}
        />

        {archiveError && (
          <p className="text-sm text-destructive">{archiveError}</p>
        )}

        {commonDialog}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={COMPUTE_COPY.title}
        description={COMPUTE_COPY.description}
        action={(
          <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        )}
      />

      <ComputeTargetList
        targets={targets}
        appearancePreferences={appearancePreferences.preferences}
        loading={isLoading || appearancePreferences.loading}
        selectedTargetId={effectiveTargetId}
        onSelectTarget={setSelectedTargetId}
        onAddSshTarget={() => setDialogOpen(true)}
      />

      {archiveError && (
        <p className="text-sm text-destructive">{archiveError}</p>
      )}

      {commonDialog}
    </section>
  );
}

````

### desktop/src/components/settings/panes/compute/AddSshTargetDialog.tsx

_Size: 10,319 bytes_

````tsx
import { useState, type CSSProperties, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Select } from "@/components/ui/Select";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useComputeTargetEnrollment } from "@/hooks/settings/workflows/use-compute-target-enrollment";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetIconGlyph } from "./ComputeTargetSwatch";
import { EnrollmentCommandBlock } from "./EnrollmentCommandBlock";

interface AddSshTargetDialogProps {
  open: boolean;
  onClose: () => void;
  onTargetAppearanceSaved?: () => void;
}

export function AddSshTargetDialog({
  open,
  onClose,
  onTargetAppearanceSaved,
}: AddSshTargetDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("~/proliferate-workspaces");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [ownerScope, setOwnerScope] = useState<"personal" | "organization">("personal");
  const [iconId, setIconId] = useState<ComputeTargetIconId>("monitor");
  const [colorId, setColorId] = useState<ComputeTargetColorId>("blue");
  const [error, setError] = useState<string | null>(null);
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canCreateOrganizationTarget = Boolean(activeOrganizationId && admin.isAdmin);
  const {
    enrollment,
    isCreating,
    clearEnrollment,
    startSshEnrollment,
  } = useComputeTargetEnrollment();

  const close = () => {
    clearEnrollment();
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const effectiveOwnerScope = canCreateOrganizationTarget ? ownerScope : "personal";
    const parsedSshPort = Number.parseInt(sshPort, 10);
    const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
    void startSshEnrollment({
      displayName,
      ownerScope: effectiveOwnerScope,
      organizationId: effectiveOwnerScope === "organization" ? activeOrganizationId : null,
      defaultWorkspaceRoot: workspaceRoot,
      directAccess: {
        sshHost,
        sshUser,
        sshPort: Number.isFinite(parsedSshPort) ? parsedSshPort : 22,
        identityFile: identityFile.trim() || null,
        remoteAnyHarnessPort: Number.isFinite(parsedRuntimePort) ? parsedRuntimePort : 8457,
        workspaceRoot,
      },
      appearance: {
        iconId,
        colorId,
      },
    }).then(() => {
      onTargetAppearanceSaved?.();
    }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Could not create enrollment.");
    });
  };

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="Add SSH target"
      description="Create a one-time enrollment command for a machine you can SSH into."
      sizeClassName="max-w-2xl"
      footer={(
        <Button type="button" variant="outline" onClick={close}>
          Done
        </Button>
      )}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <Label htmlFor="compute-target-name">Display name</Label>
          <Input
            id="compute-target-name"
            value={displayName}
            placeholder="Staging SSH Box"
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
            required
          />
        </div>
        {canCreateOrganizationTarget && (
          <div>
            <Label htmlFor="compute-target-scope">Target scope</Label>
            <Select
              id="compute-target-scope"
              value={ownerScope}
              onChange={(event) =>
                setOwnerScope(event.target.value === "organization" ? "organization" : "personal")}
              disabled={isCreating || Boolean(enrollment)}
            >
              <option value="personal">Personal cloud</option>
              <option value="organization">
                {activeOrganization ? `${activeOrganization.name} shared cloud` : "Team cloud"}
              </option>
            </Select>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              Team targets can be used by shared automations, Slack, and claimed shared workspaces.
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_ICON_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  aria-label={option.label}
                  aria-pressed={iconId === option.id}
                  disabled={isCreating || Boolean(enrollment)}
                  className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-foreground ${
                    iconId === option.id
                      ? "border-foreground text-foreground"
                      : "border-transparent bg-surface-control text-muted-foreground"
                  }`}
                  onClick={() => setIconId(option.id)}
                >
                  <ComputeTargetIconGlyph iconId={option.id} />
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_COLOR_OPTIONS.map((option) => {
                const style = {
                  "--compute-target-color": option.value,
                } as CSSProperties;
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    aria-label={option.label}
                    aria-pressed={colorId === option.id}
                    disabled={isCreating || Boolean(enrollment)}
                    className={`relative size-[26px] rounded-md border bg-[var(--compute-target-color)] transition-transform hover:scale-105 ${
                      colorId === option.id
                        ? "ring-1 ring-foreground ring-offset-2 ring-offset-background"
                        : "border-border"
                    }`}
                    style={style}
                    onClick={() => setColorId(option.id)}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="compute-target-ssh-host">SSH host</Label>
          <Input
            id="compute-target-ssh-host"
            value={sshHost}
            placeholder="44.247.206.119"
            onChange={(event) => setSshHost(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div>
            <Label htmlFor="compute-target-ssh-user">SSH user</Label>
            <Input
              id="compute-target-ssh-user"
              value={sshUser}
              placeholder="ubuntu"
              onChange={(event) => setSshUser(event.target.value)}
              disabled={isCreating || Boolean(enrollment)}
              required
            />
          </div>
          <div>
            <Label htmlFor="compute-target-ssh-port">SSH port</Label>
            <Input
              id="compute-target-ssh-port"
              value={sshPort}
              inputMode="numeric"
              onChange={(event) => setSshPort(event.target.value)}
              disabled={isCreating || Boolean(enrollment)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="compute-target-identity-file">SSH key path</Label>
          <Input
            id="compute-target-identity-file"
            value={identityFile}
            placeholder="~/.ssh/id_ed25519"
            onChange={(event) => setIdentityFile(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        <div>
          <Label htmlFor="compute-target-runtime-port">Remote AnyHarness port</Label>
          <Input
            id="compute-target-runtime-port"
            value={remoteAnyHarnessPort}
            inputMode="numeric"
            onChange={(event) => setRemoteAnyHarnessPort(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        <div>
          <Label htmlFor="compute-target-root">Default workspace root</Label>
          <Input
            id="compute-target-root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        {!enrollment && (
          <Button
            type="submit"
            loading={isCreating}
            disabled={!displayName.trim() || !sshHost.trim() || !sshUser.trim()}
          >
            {COMPUTE_COPY.createEnrollmentCommand}
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {enrollment && <EnrollmentCommandBlock command={enrollment.installCommand} />}
      </form>
    </ModalShell>
  );
}

````

### desktop/src/components/settings/panes/compute/ComputeTargetAgentAuthCard.tsx

_Size: 9,426 bytes_

````tsx
import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import {
  useAgentAuthCredentials,
  useAgentAuthMutations,
  useCloudCapabilities,
  useSandboxAgentAuthSelections,
  useSandboxAgentAuthTargetStates,
} from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSelectableReason,
  isAgentAuthCredentialVisibleForCapabilities,
  selectionByAgentKind,
  targetStateSummary,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";

interface ComputeTargetAgentAuthCardProps {
  target: ComputeTargetDetail | ComputeTargetSummary;
}

export function ComputeTargetAgentAuthCard({ target }: ComputeTargetAgentAuthCardProps) {
  const [profile, setProfile] = useState<SandboxProfile | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const sharedTarget = target.ownerScope === "organization";
  const admin = useIsAdmin(sharedTarget ? target.organizationId ?? null : null);
  const canManageAgentAuth = !sharedTarget || admin.isAdmin;
  const mutations = useAgentAuthMutations();
  const { data: credentials = [] } = useAgentAuthCredentials({
    organizationId: profile?.organizationId ?? null,
    enabled: profile !== null,
  });
  const { data: selections = [] } = useSandboxAgentAuthSelections(profile?.id ?? null);
  const { data: targetStates = [] } = useSandboxAgentAuthTargetStates(profile?.id ?? null);
  const { data: capabilities } = useCloudCapabilities();
  const agentGatewayCapabilities = capabilities?.agentGateway ?? null;
  const visibleCredentials = useMemo(
    () =>
      credentials.filter((credential) =>
        isAgentAuthCredentialVisibleForCapabilities(credential, agentGatewayCapabilities)),
    [agentGatewayCapabilities, credentials],
  );
  const selectionsByAgent = useMemo(() => selectionByAgentKind(selections), [selections]);
  const targetState = profile ? targetStateSummary(targetStates, target.id) : null;

  useEffect(() => {
    setProfile(null);
    setFeedback(null);
  }, [target.id]);

  async function handleEnsureProfile() {
    if (!canManageAgentAuth) {
      return;
    }
    setFeedback(null);
    try {
      const nextProfile = target.ownerScope === "organization"
        ? await mutations.ensureOrganizationProfile({
            organizationId: target.organizationId!,
          })
        : await mutations.ensurePersonalProfile();
      setProfile(nextProfile);
      setFeedback("Agent auth profile loaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load agent auth profile.");
    }
  }

  async function handleSelect(agentKind: AgentAuthAgentKind, credentialId: string) {
    if (!profile || !credentialId || !canManageAgentAuth) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        selection: {
          credentialId,
          credentialShareId: credentials.find(
            (credential) => credential.id === credentialId && credential.agentKind === agentKind,
          )?.activeCredentialShareId ?? null,
        },
      });
      const nextProfile = profile.ownerScope === "organization"
        ? await mutations.ensureOrganizationProfile({
            organizationId: profile.organizationId!,
          })
        : await mutations.ensurePersonalProfile();
      setProfile(nextProfile);
      setFeedback(`${agentAuthAgentLabel(agentKind)} auth selection saved.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save auth selection.");
    }
  }

  return (
    <div className="space-y-3 border-t border-border/40 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-medium text-foreground">Agent auth</h4>
          <p className="text-xs text-muted-foreground">
            Select launch credentials for agent harnesses on this target.
          </p>
        </div>
        {targetState && (
          <Badge tone={agentAuthCredentialStatusTone(targetState.status)}>
            {agentAuthCredentialStatusLabel(targetState.status)}
          </Badge>
        )}
      </div>

      {!profile ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-3">
          <p className="text-xs text-muted-foreground">
            {feedback ?? (sharedTarget && !canManageAgentAuth
              ? "Shared target auth can only be configured by an organization admin."
              : "Initialize this target's sandbox profile before selecting auth.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={mutations.isEnsuringProfile}
            disabled={
              !canManageAgentAuth
              || (sharedTarget && admin.isLoading)
              || (target.ownerScope === "organization" && !target.organizationId)
            }
            onClick={() => { void handleEnsureProfile(); }}
          >
            {sharedTarget && admin.isLoading
              ? "Checking"
              : sharedTarget && !canManageAgentAuth ? "Admin only" : "Configure"}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/40 rounded-md border border-border/50">
          {AGENT_AUTH_AGENT_ORDER.map((agentKind) => {
            const selection = selectionsByAgent.get(agentKind);
            const agentCredentials = visibleCredentials.filter(
              (credential) => credential.agentKind === agentKind,
            );
            const selectedCredential = selection
              ? credentials.find((credential) => credential.id === selection.credentialId)
              : undefined;
            const selectedCredentialVisible = selectedCredential
              ? agentCredentials.some((credential) => credential.id === selectedCredential.id)
              : selection === undefined;
            let unavailableSelectedCredentialLabel: string | null = null;
            if (selection && !selectedCredential) {
              unavailableSelectedCredentialLabel = "Selected credential unavailable";
            } else if (selectedCredential && !selectedCredentialVisible) {
              unavailableSelectedCredentialLabel = `${selectedCredential.displayName} · unavailable in hosted cloud`;
            }
            return (
              <AgentAuthSelectionRow
                key={agentKind}
                agentKind={agentKind}
                profile={profile}
                credentials={agentCredentials}
                selectedCredentialId={selection?.credentialId ?? ""}
                unavailableSelectedCredentialLabel={unavailableSelectedCredentialLabel}
                selecting={mutations.isSelectingCredential}
                disabled={!canManageAgentAuth}
                onSelect={handleSelect}
              />
            );
          })}
          {feedback && <p className="px-3 py-2 text-xs text-muted-foreground">{feedback}</p>}
        </div>
      )}
    </div>
  );
}

function AgentAuthSelectionRow({
  agentKind,
  profile,
  credentials,
  selectedCredentialId,
  unavailableSelectedCredentialLabel,
  selecting,
  disabled,
  onSelect,
}: {
  agentKind: AgentAuthAgentKind;
  profile: SandboxProfile;
  credentials: AgentAuthCredential[];
  selectedCredentialId: string;
  unavailableSelectedCredentialLabel: string | null;
  selecting: boolean;
  disabled: boolean;
  onSelect: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
      <div className="text-sm font-medium text-foreground">{agentAuthAgentLabel(agentKind)}</div>
      <Select
        value={selectedCredentialId}
        disabled={disabled || selecting || credentials.length === 0}
        onChange={(event) => onSelect(agentKind, event.target.value)}
      >
        <option value="">
          {credentials.length === 0 ? "No compatible credentials" : "Select credential"}
        </option>
        {unavailableSelectedCredentialLabel && (
          <option value={selectedCredentialId} disabled>
            {unavailableSelectedCredentialLabel}
          </option>
        )}
        {credentials.map((credential) => {
          const disabledReason = credentialSelectableReason(credential, profile.ownerScope);
          return (
            <option
              key={credential.id}
              value={credential.id}
              disabled={disabledReason !== null}
            >
              {credential.displayName} · {agentAuthCredentialKindLabel(credential)}
              {disabledReason ? ` · ${disabledReason}` : ""}
            </option>
          );
        })}
      </Select>
    </div>
  );
}

````

### desktop/src/components/settings/panes/compute/ComputeTargetDetails.tsx

_Size: 17,443 bytes_

````tsx
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/Badge";
import { Archive, Check, RefreshCw, Server } from "@/components/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useSshDirectTargetProfile } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import { useSandboxProfileTargetState } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { useSandboxProfileRuntimeConfig } from "@proliferate/cloud-sdk-react/hooks/runtime-config";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
  resolveComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { ComputeTargetAgentAuthCard } from "./ComputeTargetAgentAuthCard";
import { ComputeTargetReadiness } from "./ComputeTargetReadiness";
import { ComputeTargetIconGlyph, ComputeTargetSwatch } from "./ComputeTargetSwatch";

interface ComputeTargetDetailsProps {
  target: ComputeTargetDetail | ComputeTargetSummary | null;
  appearancePreference: ComputeTargetAppearancePreference | null;
  loading: boolean;
  onSaveAppearance: (preference: ComputeTargetAppearancePreference) => Promise<void>;
  onArchive: (targetId: string) => void;
  archiving: boolean;
}

export function ComputeTargetDetails({
  target,
  appearancePreference,
  loading,
  onSaveAppearance,
  onArchive,
  archiving,
}: ComputeTargetDetailsProps) {
  const directProfile = useSshDirectTargetProfile(
    target?.kind === "ssh" ? target.id : null,
  );
  const readinessSandboxProfileId = target?.sandboxProfileId ?? null;
  const shouldLoadSandboxReadiness = target?.kind === "managed_cloud"
    && readinessSandboxProfileId !== null;
  const targetStateQuery = useSandboxProfileTargetState(
    readinessSandboxProfileId,
    shouldLoadSandboxReadiness,
  );
  const runtimeConfigQuery = useSandboxProfileRuntimeConfig(
    readinessSandboxProfileId,
    shouldLoadSandboxReadiness,
  );
  const [displayName, setDisplayName] = useState("");
  const [iconId, setIconId] = useState<ComputeTargetIconId>("monitor");
  const [colorId, setColorId] = useState<ComputeTargetColorId>("blue");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const targetAppearance = useMemo(() => {
    if (!target) {
      return null;
    }
    return resolveComputeTargetAppearance({
      targetId: target.id,
      displayName: target.displayName,
      kind: target.kind,
      preference: appearancePreference,
    });
  }, [appearancePreference, target]);

  const draftAppearance = useMemo(() => {
    if (!target) {
      return null;
    }
    return resolveComputeTargetAppearance({
      targetId: target.id,
      displayName: target.displayName,
      kind: target.kind,
      preference: {
        targetId: target.id,
        displayName: displayName.trim() || null,
        iconId,
        colorId,
      },
    });
  }, [colorId, displayName, iconId, target]);

  useEffect(() => {
    if (!target || !targetAppearance) {
      setDisplayName("");
      setIconId("monitor");
      setColorId("blue");
      setFeedback(null);
      return;
    }
    setDisplayName(targetAppearance.displayName);
    setIconId(targetAppearance.iconId);
    setColorId(targetAppearance.colorId);
    setFeedback(null);
  }, [target, targetAppearance]);

  useEffect(() => {
    const profile = directProfile.profile;
    setSshHost(profile?.sshHost ?? "");
    setSshUser(profile?.sshUser ?? "");
    setSshPort(String(profile?.sshPort ?? 22));
    setIdentityFile(profile?.identityFile ?? "");
    setRemoteAnyHarnessPort(String(profile?.remoteAnyHarnessPort ?? 8457));
    setWorkspaceRoot(profile?.workspaceRoot ?? target?.defaultWorkspaceRoot ?? "");
  }, [directProfile.profile, target?.defaultWorkspaceRoot, target?.id]);

  if (loading) {
    return (
      <SettingsCard className="min-h-[320px]">
        <div className="space-y-4 p-4">
          <div className="h-4 w-48 rounded-full bg-foreground/10" />
          <div className="h-24 rounded-md bg-foreground/5" />
          <div className="h-24 rounded-md bg-foreground/5" />
          <p className="text-sm text-muted-foreground">Loading target details...</p>
        </div>
      </SettingsCard>
    );
  }
  if (!target || !draftAppearance) {
    return <ComputeTargetEmptyState />;
  }

  const canTestConnection = target.kind === "ssh"
    && Boolean(sshHost.trim())
    && Boolean(sshUser.trim());

  async function handleSave() {
    if (!target) {
      return;
    }
    setFeedback(null);
    const trimmedName = displayName.trim();
    try {
      await onSaveAppearance({
        targetId: target.id,
        displayName: trimmedName && trimmedName !== target.displayName ? trimmedName : null,
        iconId,
        colorId,
      });
      if (target.kind === "ssh" && (sshHost.trim() || sshUser.trim())) {
        await directProfile.saveProfile(buildSshProfileInput(target.id));
      }
      setFeedback(COMPUTE_COPY.saveSuccess);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : COMPUTE_COPY.saveError);
    }
  }

  async function handleTestConnection() {
    if (!target || target.kind !== "ssh") {
      return;
    }
    setFeedback(null);
    try {
      const result = await directProfile.testConnection(buildSshProfileInput(target.id));
      setFeedback(`${COMPUTE_COPY.testConnectionSuccess} ${result.localUrl}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : COMPUTE_COPY.testConnectionError);
    }
  }

  function buildSshProfileInput(targetId: string) {
    const parsedSshPort = Number.parseInt(sshPort, 10);
    const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
    return {
      targetId,
      sshHost,
      sshUser,
      sshPort: validPortOrDefault(parsedSshPort, 22),
      identityFile: identityFile.trim() || null,
      remoteAnyHarnessPort: validPortOrDefault(parsedRuntimePort, 8457),
      workspaceRoot: workspaceRoot.trim() || target?.defaultWorkspaceRoot || null,
    };
  }

  return (
    <SettingsCard>
      <div className="border-b border-border/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ComputeTargetSwatch appearance={draftAppearance} size="sm" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-foreground">
                {draftAppearance.displayName}
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {computeTargetKindLabel(target.kind)}
                {" · "}
                {computeTargetStatusLabel(target.status).toLowerCase()}
                {" · "}
                {computeTargetOwnerLabel(target.ownerScope)}
                {target.statusDetail?.lastHeartbeatAt
                  ? ` · last heartbeat ${target.statusDetail.lastHeartbeatAt}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={computeTargetStatusTone(target.status)}>
              {computeTargetStatusLabel(target.status)}
            </Badge>
            {target.kind === "ssh" && (
              <Button
                type="button"
                variant="ghost"
                disabled={!canTestConnection}
                loading={directProfile.testing}
                onClick={() => { void handleTestConnection(); }}
              >
                <RefreshCw className="size-3.5" />
                {COMPUTE_COPY.testConnection}
              </Button>
            )}
            <Button type="button" onClick={() => { void handleSave(); }}>
              <Check className="size-3.5" />
              {COMPUTE_COPY.save}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">Appearance</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {COMPUTE_COPY.appearanceHelp}
            </p>
          </div>
          <div>
            <Label htmlFor="compute-target-detail-display-name">Name</Label>
            <Input
              id="compute-target-detail-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_ICON_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  aria-label={option.label}
                  aria-pressed={iconId === option.id}
                  title={option.label}
                  className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-foreground ${
                    iconId === option.id
                      ? "border-foreground text-foreground"
                      : "border-transparent bg-surface-control text-muted-foreground"
                  }`}
                  onClick={() => setIconId(option.id)}
                >
                  <ComputeTargetIconGlyph iconId={option.id} />
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_COLOR_OPTIONS.map((option) => {
                const style = {
                  "--compute-target-color": option.value,
                } as CSSProperties;
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    aria-label={option.label}
                    aria-pressed={colorId === option.id}
                    title={option.label}
                    className={`relative size-[26px] rounded-md border bg-[var(--compute-target-color)] transition-transform hover:scale-105 ${
                      colorId === option.id
                        ? "ring-1 ring-foreground ring-offset-2 ring-offset-background"
                        : "border-border"
                    }`}
                    style={style}
                    onClick={() => setColorId(option.id)}
                  />
                );
              })}
            </div>
          </div>
        </section>

        <Divider />

        <ComputeTargetReadiness
          target={target}
          sandboxProfileTargetState={targetStateQuery.data ?? null}
          runtimeConfigStatus={runtimeConfigQuery.data ?? null}
          loadingTargetState={targetStateQuery.isLoading}
          loadingRuntimeConfig={runtimeConfigQuery.isLoading}
        />

        <Divider />

        <ComputeTargetAgentAuthCard target={target} />

        <Divider />

        <section className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">Direct SSH access</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {target.kind === "ssh"
                ? COMPUTE_COPY.directSshHelp
                : COMPUTE_COPY.directSshUnavailable}
            </p>
          </div>
          {target.kind === "ssh" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div>
                  <Label htmlFor="compute-target-detail-ssh-host">Host</Label>
                  <Input
                    id="compute-target-detail-ssh-host"
                    className="font-mono"
                    value={sshHost}
                    placeholder="44.247.206.119"
                    onChange={(event) => setSshHost(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="compute-target-detail-ssh-port">Port</Label>
                  <Input
                    id="compute-target-detail-ssh-port"
                    className="font-mono"
                    value={sshPort}
                    inputMode="numeric"
                    onChange={(event) => setSshPort(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <div>
                  <Label htmlFor="compute-target-detail-ssh-user">User</Label>
                  <Input
                    id="compute-target-detail-ssh-user"
                    className="font-mono"
                    value={sshUser}
                    placeholder="ubuntu"
                    onChange={(event) => setSshUser(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="compute-target-detail-runtime-port">Runtime port</Label>
                  <Input
                    id="compute-target-detail-runtime-port"
                    className="font-mono"
                    value={remoteAnyHarnessPort}
                    inputMode="numeric"
                    onChange={(event) => setRemoteAnyHarnessPort(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="compute-target-detail-identity-file">SSH key path</Label>
                <Input
                  id="compute-target-detail-identity-file"
                  className="font-mono"
                  value={identityFile}
                  placeholder="~/.ssh/id_ed25519"
                  onChange={(event) => setIdentityFile(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="compute-target-detail-workspace-root">Workspace root</Label>
                <Input
                  id="compute-target-detail-workspace-root"
                  className="font-mono"
                  value={workspaceRoot}
                  placeholder="~/proliferate-workspaces"
                  onChange={(event) => setWorkspaceRoot(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 bg-foreground/5 p-3 text-xs text-muted-foreground">
              {COMPUTE_COPY.directSshNotSshTarget}
            </div>
          )}
        </section>

        {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}

        {target.status !== "archived" && (
          <>
            <Divider />
            <div className="flex justify-start">
              <Button
                type="button"
                variant="ghost"
                loading={archiving}
                onClick={() => {
                  if (window.confirm(COMPUTE_COPY.archiveConfirm)) {
                    onArchive(target.id);
                  }
                }}
              >
                <Archive className="size-3.5" />
                {COMPUTE_COPY.archiveTarget}
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}

function ComputeTargetEmptyState() {
  return (
    <SettingsCard className="min-h-[320px]">
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
          <Server className="size-5" aria-hidden="true" />
        </span>
        <div className="max-w-sm space-y-2">
          <h3 className="text-sm font-medium text-foreground">{COMPUTE_COPY.selectTargetTitle}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {COMPUTE_COPY.selectTargetDescription}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

function validPortOrDefault(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

function Divider() {
  return <div className="-mx-4 h-px bg-border/40" />;
}

````

### desktop/src/components/settings/panes/compute/ComputeTargetList.tsx

_Size: 7,318 bytes_

````tsx
import { Badge } from "@/components/ui/Badge";
import { ChevronRight, Server } from "@/components/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
  groupComputeTargetsByOwnerScope,
  type ComputeTargetOwnerGroup,
} from "@/lib/domain/compute/target-presentation";
import {
  resolveComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetSwatch } from "./ComputeTargetSwatch";

interface ComputeTargetListProps {
  targets: ComputeTargetSummary[];
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selectedTargetId: string | null;
  loading: boolean;
  onSelectTarget: (targetId: string) => void;
  onAddSshTarget: () => void;
}

export function ComputeTargetList({
  targets,
  appearancePreferences,
  selectedTargetId,
  loading,
  onSelectTarget,
  onAddSshTarget,
}: ComputeTargetListProps) {
  const targetGroups = groupComputeTargetsByOwnerScope(targets);

  return (
    <SettingsCard>
      <div className="flex items-start justify-between gap-3 border-b border-border/40 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            <Server className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">Targets</h3>
              {!loading && targets.length > 0 ? (
                <Badge tone="neutral">{targetCountLabel(targets.length)}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select a runtime target to inspect readiness, access, and auth.
            </p>
          </div>
        </div>
        {loading || targets.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={onAddSshTarget}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          <TargetRowSkeleton />
          <TargetRowSkeleton />
        </div>
      ) : targets.length === 0 ? (
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-dashed border-border/70 bg-foreground/5 p-4">
            <div className="text-sm font-medium text-foreground">{COMPUTE_COPY.emptyTitle}</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {COMPUTE_COPY.emptyDescription}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onAddSshTarget}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 p-3">
          {targetGroups.map((group) => (
            <TargetGroup
              key={group.id}
              group={group}
              appearancePreferences={appearancePreferences}
              selectedTargetId={selectedTargetId}
              onSelectTarget={onSelectTarget}
            />
          ))}
        </div>
      )}
    </SettingsCard>
  );
}

function TargetGroup({
  group,
  appearancePreferences,
  selectedTargetId,
  onSelectTarget,
}: {
  group: ComputeTargetOwnerGroup;
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selectedTargetId: string | null;
  onSelectTarget: (targetId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5 px-1">
        <h4 className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground/90">
          {group.label}
        </h4>
        <p className="text-xs leading-5 text-muted-foreground">{group.description}</p>
      </div>
      <div className="space-y-2">
        {group.targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            appearancePreferences={appearancePreferences}
            selected={selectedTargetId === target.id}
            onSelectTarget={onSelectTarget}
          />
        ))}
      </div>
    </div>
  );
}

function TargetRow({
  target,
  appearancePreferences,
  selected,
  onSelectTarget,
}: {
  target: ComputeTargetSummary;
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selected: boolean;
  onSelectTarget: (targetId: string) => void;
}) {
  const appearance = resolveComputeTargetAppearance({
    targetId: target.id,
    displayName: target.displayName,
    kind: target.kind,
    preference: appearancePreferences[target.id],
  });

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-pressed={selected}
      className={`group/target flex min-h-[74px] w-full items-center justify-between gap-3 whitespace-normal rounded-md border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-border bg-accent text-accent-foreground shadow-subtle"
          : "border-border/50 bg-foreground/5 hover:border-border hover:bg-foreground/10"
      }`}
      onClick={() => onSelectTarget(target.id)}
    >
      <ComputeTargetSwatch appearance={appearance} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{appearance.displayName}</span>
          <Badge tone={computeTargetStatusTone(target.status)}>
            {computeTargetStatusLabel(target.status)}
          </Badge>
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{computeTargetKindLabel(target.kind)}</span>
          <span aria-hidden="true">·</span>
          <span>{computeTargetOwnerLabel(target.ownerScope)}</span>
        </span>
        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
          {target.defaultWorkspaceRoot ?? "Workspace root not set"}
        </span>
      </span>
      <ChevronRight
        className={`size-4 shrink-0 transition-colors ${
          selected ? "text-foreground" : "text-muted-foreground group-hover/target:text-foreground"
        }`}
        aria-hidden="true"
      />
    </Button>
  );
}

function TargetRowSkeleton() {
  return (
    <div className="flex min-h-[74px] items-center gap-3 rounded-md border border-border/40 bg-foreground/5 px-3 py-3">
      <div className="size-8 shrink-0 rounded-lg bg-foreground/10" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-1/2 rounded-full bg-foreground/10" />
        <div className="h-2.5 w-3/4 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

function targetCountLabel(count: number) {
  return count === 1 ? "1 target" : `${count} targets`;
}

````

### desktop/src/components/settings/panes/compute/ComputeTargetReadiness.tsx

_Size: 2,528 bytes_

````tsx
import { Badge } from "@/components/ui/Badge";
import { computeTargetReadiness } from "@/lib/domain/compute/target-readiness";
import type {
  ComputeRuntimeConfigStatus,
  ComputeSandboxProfileTargetState,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

interface ComputeTargetReadinessProps {
  target: ComputeTargetSummary;
  sandboxProfileTargetState?: ComputeSandboxProfileTargetState | null;
  runtimeConfigStatus?: ComputeRuntimeConfigStatus | null;
  loadingTargetState?: boolean;
  loadingRuntimeConfig?: boolean;
}

const READINESS_TONE: Record<
  ReturnType<typeof computeTargetReadiness>[number]["status"],
  "success" | "warning" | "neutral" | "destructive"
> = {
  ready: "success",
  pending: "warning",
  missing: "warning",
  unavailable: "neutral",
};

export function ComputeTargetReadiness({
  target,
  sandboxProfileTargetState = null,
  runtimeConfigStatus = null,
  loadingTargetState = false,
  loadingRuntimeConfig = false,
}: ComputeTargetReadinessProps) {
  const items = computeTargetReadiness(target, {
    sandboxProfileTargetState,
    runtimeConfigStatus,
    loadingTargetState,
    loadingRuntimeConfig,
  });
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">Readiness</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Tooling and target state required for cloud-dispatched work.
        </p>
      </div>
      <div className="divide-y divide-border/40 rounded-md border border-border/60 bg-foreground/5">
        {items.map((item) => {
          const badgeLabel = readinessLabel(item);
          return (
            <div key={item.key} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
              </div>
              <Badge tone={READINESS_TONE[item.status]}>{badgeLabel}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function readinessLabel(item: ReturnType<typeof computeTargetReadiness>[number]): string {
  if (item.status === "ready") {
    return item.key === "git" || item.key === "node" || item.key === "python"
      ? "Installed"
      : "Ready";
  }
  if (item.status === "pending") {
    return "Pending";
  }
  if (item.status === "missing") {
    return "Missing";
  }
  return "Unavailable";
}

````

### desktop/src/components/settings/panes/compute/ComputeTargetSwatch.tsx

_Size: 1,586 bytes_

````tsx
import type { ComponentType, CSSProperties, SVGProps } from "react";
import {
  Blocks,
  CloudIcon,
  Folder,
  Globe,
  Monitor,
  Terminal,
  Zap,
} from "@/components/ui/icons";
import type {
  ComputeTargetAppearance,
  ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";

type SwatchSize = "sm" | "md";

const ICONS: Record<ComputeTargetIconId, ComponentType<SVGProps<SVGSVGElement>>> = {
  monitor: Monitor,
  cloud: CloudIcon,
  bolt: Zap,
  blocks: Blocks,
  terminal: Terminal,
  globe: Globe,
  folder: Folder,
};

const SIZE_CLASSES: Record<SwatchSize, string> = {
  sm: "size-7 rounded-md",
  md: "size-8 rounded-lg",
};

export function ComputeTargetSwatch({
  appearance,
  size = "md",
  className = "",
}: {
  appearance: Pick<ComputeTargetAppearance, "iconId" | "iconLabel" | "colorValue">;
  size?: SwatchSize;
  className?: string;
}) {
  const Icon = ICONS[appearance.iconId] ?? Monitor;
  const style = {
    "--compute-target-color": appearance.colorValue,
  } as CSSProperties;
  return (
    <span
      aria-label={`${appearance.iconLabel} target`}
      className={`inline-flex shrink-0 items-center justify-center bg-[var(--compute-target-color)] text-foreground ${SIZE_CLASSES[size]} ${className}`}
      style={style}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function ComputeTargetIconGlyph({
  iconId,
  className = "size-4",
}: {
  iconId: ComputeTargetIconId;
  className?: string;
}) {
  const Icon = ICONS[iconId] ?? Monitor;
  return <Icon className={className} aria-hidden="true" />;
}

````

### desktop/src/components/settings/panes/compute/EnrollmentCommandBlock.tsx

_Size: 1,255 bytes_

````tsx
import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Copy } from "@/components/ui/icons";
import { COMPUTE_COPY } from "@/copy/settings/compute";

interface EnrollmentCommandBlockProps {
  command: string;
}

export function EnrollmentCommandBlock({ command }: EnrollmentCommandBlockProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-muted-foreground">
          {COMPUTE_COPY.installCommandLabel}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
        {command}
      </pre>
    </div>
  );
}

````

### desktop/src/config/settings.ts

_Size: 754 bytes_

````tsx
export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "environments",
  "shared-environments",
  "compute",
  "agents",
  "agent-defaults",
  "agent-authentication",
  "review",
  "slack-bot",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "general";

export const SETTINGS_SHORTCUT_SECTION_ORDER = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "environments",
  "shared-environments",
  "compute",
  "agents",
  "agent-defaults",
  "agent-authentication",
  "review",
  "slack-bot",
] as const satisfies readonly SettingsSection[];

````

### desktop/src/components/settings/settings-navigation.ts

_Size: 2,951 bytes_

````tsx
import type { ComponentType } from "react";
import {
  Blocks,
  BotMessageSquare,
  Building2,
  CircleUser,
  ClipboardList,
  CreditCard,
  FolderList,
  Keyboard,
  LifeBuoy,
  Palette,
  RefreshCw,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  UsersRound,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import type { SettingsSection } from "@/config/settings";

export type SettingsNavItem =
  | {
    kind: "section";
    id: SettingsSection;
    label: string;
    icon: ComponentType<IconProps>;
    adminOnly?: boolean;
  }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

export interface SettingsNavGroup {
  id: "preferences" | "organization_account" | "workspace" | "agents" | "slack_bot" | "help";
  heading: string | null;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "preferences",
    heading: "Preferences",
    items: [
      { kind: "section", id: "general", label: "General", icon: Settings },
      { kind: "section", id: "appearance", label: "Appearance", icon: Palette },
      { kind: "section", id: "keyboard", label: "Keyboard", icon: Keyboard },
    ],
  },
  {
    id: "organization_account",
    heading: "Organization & Account",
    items: [
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "organization", label: "Organization", icon: Building2 },
      { kind: "section", id: "billing", label: "Billing", icon: CreditCard },
    ],
  },
  {
    id: "workspace",
    heading: "Workspace",
    items: [
      { kind: "section", id: "environments", label: "Environments", icon: FolderList },
      {
        kind: "section",
        id: "shared-environments",
        label: "Shared environments",
        icon: UsersRound,
        adminOnly: true,
      },
      { kind: "section", id: "compute", label: "Compute", icon: Server },
    ],
  },
  {
    id: "agents",
    heading: "Agents",
    items: [
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "agent-defaults", label: "Agent Defaults", icon: SlidersHorizontal },
      {
        kind: "section",
        id: "agent-authentication",
        label: "Agent Authentication",
        icon: Shield,
      },
      { kind: "section", id: "review", label: "Review", icon: ClipboardList },
    ],
  },
  {
    id: "slack_bot",
    heading: null,
    items: [
      {
        kind: "section",
        id: "slack-bot",
        label: "Slack bot",
        icon: BotMessageSquare,
        adminOnly: true,
      },
    ],
  },
  {
    id: "help",
    heading: "Help",
    items: [
      { kind: "action", id: "support", label: "Support", icon: LifeBuoy },
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Desktop updates",
        icon: RefreshCw,
      },
    ],
  },
];

````

### desktop/src/components/settings/shared/SettingsPageHeader.tsx

_Size: 90 bytes_

````tsx
export { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

````

### desktop/src/components/settings/shared/SettingsCard.tsx

_Size: 78 bytes_

````tsx
export { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";

````

### desktop/src/components/settings/shared/SettingsCardRow.tsx

_Size: 84 bytes_

````tsx
export { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";

````

### desktop/src/copy/settings/compute.ts

_Size: 1,543 bytes_

````tsx
export const COMPUTE_COPY = {
  title: "Compute",
  description: "SSH targets and runtimes available to cloud-dispatchable agent work. Each target gets an icon and color for quick visual identification.",
  addSshTarget: "Add SSH target",
  createEnrollmentCommand: "Create enrollment command",
  save: "Save",
  saveSuccess: "Target settings saved.",
  saveError: "Could not save target settings.",
  testConnection: "Test connection",
  testConnectionSuccess: "Connection succeeded through",
  testConnectionError: "Could not reach AnyHarness through SSH.",
  emptyTitle: "No cloud compute targets yet",
  emptyDescription: "Connect an SSH machine or enable a managed cloud target to run work remotely.",
  selectTargetTitle: "No target selected",
  selectTargetDescription: "Choose a target from the list to review readiness, launch auth, direct access, and appearance settings.",
  targetFallbackTitle: "Target",
  installCommandLabel: "Run this on the target machine",
  appearanceHelp: "Shown alongside this target's name throughout the app.",
  directSshHelp: "How Desktop tunnels into this target's AnyHarness runtime. These values are stored locally on this Desktop.",
  directSshUnavailable: "Direct SSH access applies to SSH targets. Managed cloud and local targets use their own runtime connection path.",
  directSshNotSshTarget: "This target does not use a Desktop-managed SSH tunnel.",
  archiveTarget: "Archive target",
  archiveConfirm: "Archive this compute target?",
  archiveError: "Could not archive target.",
} as const;

````

### desktop/src/hooks/settings/workflows/use-compute-target-enrollment.ts

_Size: 2,291 bytes_

````tsx
import { useState } from "react";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  setComputeTargetAppearancePreference,
  setSshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";
import type {
  ComputeTargetColorId,
  ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";

interface StartSshEnrollmentInput {
  displayName: string;
  ownerScope?: "personal" | "organization";
  organizationId?: string | null;
  defaultWorkspaceRoot?: string | null;
  directAccess?: {
    sshHost: string;
    sshUser: string;
    sshPort: number;
    identityFile?: string | null;
    remoteAnyHarnessPort: number;
    workspaceRoot?: string | null;
  } | null;
  appearance?: {
    iconId: ComputeTargetIconId;
    colorId: ComputeTargetColorId;
  } | null;
}

interface ComputeTargetEnrollmentResult {
  installCommand: string;
  targetId: string;
}

export function useComputeTargetEnrollment() {
  const { createTargetEnrollment, isCreatingTargetEnrollment } = useCloudTargetMutations();
  const [result, setResult] = useState<ComputeTargetEnrollmentResult | null>(null);

  return {
    enrollment: result,
    isCreating: isCreatingTargetEnrollment,
    clearEnrollment: () => setResult(null),
    startSshEnrollment: async (input: StartSshEnrollmentInput) => {
      const next = await createTargetEnrollment({
        displayName: input.displayName,
        kind: "ssh",
        ownerScope: input.ownerScope ?? "personal",
        organizationId: input.ownerScope === "organization" ? input.organizationId ?? null : null,
        defaultWorkspaceRoot: input.defaultWorkspaceRoot ?? null,
      });
      if (input.directAccess) {
        await setSshDirectTargetProfile({
          targetId: next.target.id,
          ...input.directAccess,
        });
      }
      if (input.appearance) {
        await setComputeTargetAppearancePreference({
          targetId: next.target.id,
          displayName: input.displayName,
          iconId: input.appearance.iconId,
          colorId: input.appearance.colorId,
        });
      }
      const result = {
        installCommand: next.installCommand,
        targetId: next.target.id,
      };
      setResult(result);
      return result;
    },
  };
}

````

### desktop/src/hooks/settings/workflows/use-ssh-direct-target-profile.ts

_Size: 2,595 bytes_

````tsx
import { useCallback, useEffect, useState } from "react";
import { ensureSshAnyHarnessTunnel } from "@/lib/access/tauri/ssh-tunnel";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  getSshDirectTargetProfile,
  setComputeTargetAppearancePreference,
  setSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";

export function useSshDirectTargetProfile(targetId: string | null | undefined) {
  const [profile, setProfile] = useState<SshDirectTargetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    if (!targetId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    try {
      setProfile(await getSshDirectTargetProfile(targetId));
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveProfile = useCallback(async (next: SshDirectTargetProfile) => {
    await setSshDirectTargetProfile(next);
    setProfile(next);
  }, []);

  const testConnection = useCallback(async (next: SshDirectTargetProfile) => {
    setTesting(true);
    try {
      return await ensureSshAnyHarnessTunnel({
        targetId: next.targetId,
        sshHost: next.sshHost,
        sshUser: next.sshUser,
        sshPort: next.sshPort,
        identityFile: next.identityFile ?? null,
        remoteAnyHarnessPort: next.remoteAnyHarnessPort,
      });
    } finally {
      setTesting(false);
    }
  }, []);

  return {
    profile,
    loading,
    testing,
    reload,
    saveProfile,
    testConnection,
  };
}

export function useComputeTargetAppearancePreferences() {
  const [preferences, setPreferences] = useState<
    Record<string, ComputeTargetAppearancePreference>
  >({});
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await getComputeTargetAppearancePreferences());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const savePreference = useCallback(async (
    preference: ComputeTargetAppearancePreference,
  ) => {
    await setComputeTargetAppearancePreference(preference);
    setPreferences((current) => ({
      ...current,
      [preference.targetId]: preference,
    }));
  }, []);

  return {
    preferences,
    loading,
    reload,
    savePreference,
  };
}

````

### desktop/src/hooks/access/cloud/targets/query-keys.ts

_Size: 88 bytes_

````tsx
export {
  cloudTargetKey,
  cloudTargetsKey,
} from "@/hooks/access/cloud/query-keys";

````

### desktop/src/hooks/access/cloud/targets/use-cloud-targets.ts

_Size: 122 bytes_

````tsx
import "@/lib/access/cloud/client";

export {
  useCloudTarget,
  useCloudTargets,
} from "@proliferate/cloud-sdk-react";

````

### desktop/src/hooks/access/cloud/targets/use-cloud-target-mutations.ts

_Size: 1,467 bytes_

````tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveTarget,
  createTargetEnrollment,
  type ArchiveCloudTargetResponse,
  type CloudTargetEnrollmentRequest,
  type CloudTargetEnrollmentResponse,
} from "@proliferate/cloud-sdk";
import "@/lib/access/cloud/client";
import { cloudTargetKey, cloudTargetsKey } from "./query-keys";

export function useCloudTargetMutations() {
  const queryClient = useQueryClient();
  const createEnrollment = useMutation<
    CloudTargetEnrollmentResponse,
    Error,
    CloudTargetEnrollmentRequest
  >({
    mutationFn: (body) => createTargetEnrollment(body),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
        queryClient.invalidateQueries({ queryKey: cloudTargetKey(result.target.id) }),
      ]);
    },
  });
  const archive = useMutation<ArchiveCloudTargetResponse, Error, string>({
    mutationFn: (targetId) => archiveTarget(targetId),
    onSuccess: async (_result, targetId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
        queryClient.invalidateQueries({ queryKey: cloudTargetKey(targetId) }),
      ]);
    },
  });
  return {
    createTargetEnrollment: createEnrollment.mutateAsync,
    isCreatingTargetEnrollment: createEnrollment.isPending,
    archiveTarget: archive.mutateAsync,
    isArchivingTarget: archive.isPending,
  };
}

````

### desktop/src/lib/domain/compute/target-types.ts

_Size: 2,402 bytes_

````tsx
export type ComputeTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type ComputeTargetStatus = "online" | "offline" | "degraded" | "enrolling" | "archived";

export interface ComputeTargetInventory {
  os?: string | null;
  arch?: string | null;
  distro?: string | null;
  shell?: string | null;
  git?: Record<string, unknown> | null;
  node?: Record<string, unknown> | null;
  python?: Record<string, unknown> | null;
  browser?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
  providers?: Record<string, unknown> | null;
  mcp?: Record<string, unknown> | null;
  updatedAt: string;
}

export interface ComputeTargetStatusDetail {
  status: ComputeTargetStatus;
  statusDetail?: string | null;
  lastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
  updatedAt?: string | null;
}

export interface ComputeTargetSummary {
  id: string;
  displayName: string;
  kind: ComputeTargetKind;
  status: ComputeTargetStatus;
  ownerScope: "personal" | "organization";
  sandboxProfileId?: string | null;
  profileTargetRole?: "primary" | "none" | string;
  organizationId?: string | null;
  defaultWorkspaceRoot?: string | null;
  inventory?: ComputeTargetInventory | null;
  statusDetail?: ComputeTargetStatusDetail | null;
  update?: {
    channel?: string | null;
    status?: string | null;
    currentVersions?: {
      workerId?: string | null;
      anyharnessVersion?: string | null;
      workerVersion?: string | null;
      supervisorVersion?: string | null;
      reportedAt?: string | null;
    } | null;
  } | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeTargetDetail extends ComputeTargetSummary {
  ownerUserId?: string | null;
  createdByUserId: string;
}

export interface ComputeSandboxProfileTargetState {
  ready: boolean;
  slot?: {
    id: string;
    status: string;
    slotGeneration?: number | null;
    blockedReason?: string | null;
  } | null;
  runtimeAccess?: {
    activeSandboxId?: string | null;
    slotGeneration?: number | null;
    anyharnessBaseUrl?: string | null;
    lastHeartbeatAt?: string | null;
  } | null;
}

export interface ComputeRuntimeConfigStatus {
  currentRevision?: {
    revisionId: string;
    sequence: number;
    contentHash: string;
    createdAt: string;
  } | null;
}

````

### desktop/src/lib/domain/compute/target-readiness.ts

_Size: 7,022 bytes_

````tsx
import type {
  ComputeTargetInventory,
  ComputeRuntimeConfigStatus,
  ComputeSandboxProfileTargetState,
  ComputeTargetStatus,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

export interface ComputeReadinessItem {
  key: "target" | "worker" | "git" | "node" | "python" | "runtime-config" | "sandbox-slot";
  label: string;
  status: "ready" | "pending" | "missing" | "unavailable";
  detail: string;
}

function hasAvailableFlag(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) {
    return false;
  }
  if (typeof value.available === "boolean") {
    return value.available;
  }
  return Object.values(value).some((entry) => (
    typeof entry === "object"
    && entry !== null
    && "available" in entry
    && (entry as { available?: unknown }).available === true
  ));
}

export function computeTargetReadiness(
  targetOrInventory: ComputeTargetSummary | ComputeTargetInventory | null | undefined,
  options: {
    sandboxProfileTargetState?: ComputeSandboxProfileTargetState | null;
    runtimeConfigStatus?: ComputeRuntimeConfigStatus | null;
    loadingTargetState?: boolean;
    loadingRuntimeConfig?: boolean;
  } = {},
): ComputeReadinessItem[] {
  const target = isComputeTargetSummary(targetOrInventory) ? targetOrInventory : null;
  const inventory: ComputeTargetInventory | null | undefined = target
    ? target.inventory
    : targetOrInventory as ComputeTargetInventory | null | undefined;
  const targetStatus = target?.status ?? null;
  const currentVersions = target?.update?.currentVersions ?? null;
  const sandboxState = options.sandboxProfileTargetState ?? null;
  const runtimeConfig = options.runtimeConfigStatus ?? null;
  return [
    {
      key: "target",
      label: "Target",
      status: readinessStatusFromTargetStatus(targetStatus),
      detail: target?.statusDetail?.lastHeartbeatAt
        ? `Last heartbeat ${target.statusDetail.lastHeartbeatAt}.`
        : "Worker heartbeat determines whether Cloud can dispatch commands here.",
    },
    {
      key: "worker",
      label: "Worker / AnyHarness",
      status: currentVersions?.workerVersion || currentVersions?.anyharnessVersion
        ? "ready"
        : "unavailable",
      detail: formatWorkerVersions(currentVersions),
    },
    {
      key: "git",
      label: "Git",
      status: hasAvailableFlag(inventory?.git) ? "ready" : "missing",
      detail: "Required for repository checkout and worktree operations.",
    },
    {
      key: "node",
      label: "Node / npm",
      status: hasAvailableFlag(inventory?.node) ? "ready" : "missing",
      detail: "Required for most product MCP servers and plugin materialization.",
    },
    {
      key: "python",
      label: "Python / uv",
      status: hasAvailableFlag(inventory?.python) ? "ready" : "missing",
      detail: "Used by Python-based setup scripts and some future MCP bundles.",
    },
    {
      key: "runtime-config",
      label: "Runtime config",
      status: runtimeConfigReadiness(target, runtimeConfig, options.loadingRuntimeConfig ?? false),
      detail: runtimeConfigDetail(target, runtimeConfig, options.loadingRuntimeConfig ?? false),
    },
    {
      key: "sandbox-slot",
      label: "Sandbox slot",
      status: sandboxSlotReadiness(
        target,
        sandboxState,
        options.loadingTargetState ?? false,
      ),
      detail: sandboxSlotDetail(target, sandboxState, options.loadingTargetState ?? false),
    },
  ];
}

function isComputeTargetSummary(
  value: ComputeTargetSummary | ComputeTargetInventory | null | undefined,
): value is ComputeTargetSummary {
  return Boolean(value && "kind" in value && "status" in value);
}

function readinessStatusFromTargetStatus(
  status: ComputeTargetStatus | null,
): ComputeReadinessItem["status"] {
  if (status === "online") {
    return "ready";
  }
  if (status === "enrolling") {
    return "pending";
  }
  if (status === "offline" || status === "degraded") {
    return "missing";
  }
  return "unavailable";
}

function formatWorkerVersions(
  versions: NonNullable<NonNullable<ComputeTargetSummary["update"]>["currentVersions"]> | null,
): string {
  if (!versions) {
    return "Worker version has not been reported by this target.";
  }
  const parts = [
    versions.workerVersion ? `Worker ${versions.workerVersion}` : null,
    versions.anyharnessVersion ? `AnyHarness ${versions.anyharnessVersion}` : null,
    versions.supervisorVersion ? `Supervisor ${versions.supervisorVersion}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Worker version has not been reported.";
}

function runtimeConfigReadiness(
  target: ComputeTargetSummary | null,
  runtimeConfig: ComputeRuntimeConfigStatus | null,
  loading: boolean,
): ComputeReadinessItem["status"] {
  if (!target?.sandboxProfileId) {
    return "unavailable";
  }
  if (loading) {
    return "pending";
  }
  return runtimeConfig?.currentRevision ? "ready" : "missing";
}

function runtimeConfigDetail(
  target: ComputeTargetSummary | null,
  runtimeConfig: ComputeRuntimeConfigStatus | null,
  loading: boolean,
): string {
  if (!target?.sandboxProfileId) {
    return "This target does not have a sandbox profile runtime config.";
  }
  if (loading) {
    return "Loading current sandbox runtime config revision.";
  }
  const revision = runtimeConfig?.currentRevision;
  if (!revision) {
    return "No runtime config revision has been generated for this sandbox profile.";
  }
  return `Revision ${revision.sequence} generated ${revision.createdAt}.`;
}

function sandboxSlotReadiness(
  target: ComputeTargetSummary | null,
  sandboxState: ComputeSandboxProfileTargetState | null,
  loading: boolean,
): ComputeReadinessItem["status"] {
  if (target?.kind !== "managed_cloud") {
    return "ready";
  }
  if (loading) {
    return "pending";
  }
  if (!sandboxState?.slot) {
    return "missing";
  }
  if (sandboxState.ready) {
    return "ready";
  }
  if (sandboxState.slot.status === "creating" || sandboxState.slot.status === "provisioning") {
    return "pending";
  }
  return "missing";
}

function sandboxSlotDetail(
  target: ComputeTargetSummary | null,
  sandboxState: ComputeSandboxProfileTargetState | null,
  loading: boolean,
): string {
  if (target?.kind !== "managed_cloud") {
    return "Direct SSH and local targets do not use a managed cloud slot.";
  }
  if (loading) {
    return "Loading managed cloud sandbox slot state.";
  }
  if (!sandboxState?.slot) {
    return "No active managed sandbox slot is assigned to this target.";
  }
  if (sandboxState.slot.blockedReason) {
    return `Slot ${sandboxState.slot.slotGeneration ?? "-"} blocked: ${sandboxState.slot.blockedReason}.`;
  }
  if (!sandboxState.runtimeAccess?.anyharnessBaseUrl) {
    return `Slot ${sandboxState.slot.slotGeneration ?? "-"} is ${sandboxState.slot.status}; runtime access is not ready.`;
  }
  return `Slot ${sandboxState.slot.slotGeneration ?? "-"} is ${sandboxState.slot.status}; runtime access is ready.`;
}

````

### desktop/src/lib/domain/compute/target-presentation.ts

_Size: 2,333 bytes_

````tsx
import type {
  ComputeTargetKind,
  ComputeTargetStatus,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

export interface ComputeTargetOwnerGroup {
  id: "personal" | "organization";
  label: string;
  description: string;
  targets: ComputeTargetSummary[];
}

export function computeTargetKindLabel(kind: ComputeTargetKind): string {
  switch (kind) {
    case "managed_cloud":
      return "Managed cloud";
    case "ssh":
      return "SSH target";
    case "desktop_dispatch":
      return "Desktop dispatch";
    case "local_direct":
      return "Local direct";
    case "self_hosted_cloud":
      return "Self-hosted cloud";
  }
}

export function computeTargetStatusTone(
  status: ComputeTargetStatus,
): "success" | "warning" | "neutral" | "destructive" {
  switch (status) {
    case "online":
      return "success";
    case "enrolling":
      return "warning";
    case "offline":
    case "archived":
      return "neutral";
    case "degraded":
      return "destructive";
  }
}

export function computeTargetStatusLabel(status: ComputeTargetStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "enrolling":
      return "Waiting for enrollment";
    case "offline":
      return "Offline";
    case "degraded":
      return "Degraded";
    case "archived":
      return "Archived";
  }
}

export function computeTargetOwnerLabel(ownerScope: "personal" | "organization"): string {
  return ownerScope === "organization" ? "Organization" : "Personal";
}

export function groupComputeTargetsByOwnerScope(
  targets: readonly ComputeTargetSummary[],
): ComputeTargetOwnerGroup[] {
  const personal = targets.filter((target) => target.ownerScope === "personal");
  const organization = targets.filter((target) => target.ownerScope === "organization");
  const groups: ComputeTargetOwnerGroup[] = [];

  if (personal.length > 0) {
    groups.push({
      id: "personal",
      label: "Personal targets",
      description: "Available to your personal cloud and local work.",
      targets: personal,
    });
  }

  if (organization.length > 0) {
    groups.push({
      id: "organization",
      label: "Organization targets",
      description: "Available to shared cloud work for your organization.",
      targets: organization,
    });
  }

  return groups;
}

````

### desktop/src/lib/domain/compute/target-appearance.ts

_Size: 4,707 bytes_

````tsx
import type { ComputeTargetKind } from "@/lib/domain/compute/target-types";

export const COMPUTE_TARGET_ICON_IDS = [
  "monitor",
  "cloud",
  "bolt",
  "blocks",
  "terminal",
  "globe",
  "folder",
] as const;

export type ComputeTargetIconId = (typeof COMPUTE_TARGET_ICON_IDS)[number];

export const COMPUTE_TARGET_COLOR_IDS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type ComputeTargetColorId = (typeof COMPUTE_TARGET_COLOR_IDS)[number];

export interface ComputeTargetAppearancePreference {
  targetId: string;
  displayName?: string | null;
  iconId: ComputeTargetIconId;
  colorId: ComputeTargetColorId;
}

export interface ComputeTargetAppearance {
  displayName: string;
  iconId: ComputeTargetIconId;
  iconLabel: string;
  colorId: ComputeTargetColorId;
  colorLabel: string;
  colorValue: string;
}

export const COMPUTE_TARGET_ICON_OPTIONS: Array<{
  id: ComputeTargetIconId;
  label: string;
}> = [
  { id: "monitor", label: "Monitor" },
  { id: "cloud", label: "Cloud" },
  { id: "bolt", label: "Lightning" },
  { id: "blocks", label: "Blocks" },
  { id: "terminal", label: "Terminal" },
  { id: "globe", label: "Globe" },
  { id: "folder", label: "Folder" },
];

export const COMPUTE_TARGET_COLOR_OPTIONS: Array<{
  id: ComputeTargetColorId;
  label: string;
  value: string;
}> = [
  { id: "slate", label: "Slate", value: "#6b7280" },
  { id: "red", label: "Red", value: "#b04444" },
  { id: "orange", label: "Orange", value: "#b56b3a" },
  { id: "amber", label: "Amber", value: "#b59a3a" },
  { id: "green", label: "Green", value: "#4a8d5a" },
  { id: "teal", label: "Teal", value: "#3c8a86" },
  { id: "blue", label: "Blue", value: "#4a72b5" },
  { id: "purple", label: "Purple", value: "#7a5ab0" },
  { id: "pink", label: "Pink", value: "#b0567c" },
];

const ICON_OPTIONS_BY_ID = new Map(
  COMPUTE_TARGET_ICON_OPTIONS.map((option) => [option.id, option]),
);
const COLOR_OPTIONS_BY_ID = new Map(
  COMPUTE_TARGET_COLOR_OPTIONS.map((option) => [option.id, option]),
);

function isComputeTargetIconId(value: unknown): value is ComputeTargetIconId {
  return typeof value === "string"
    && COMPUTE_TARGET_ICON_IDS.includes(value as ComputeTargetIconId);
}

function isComputeTargetColorId(value: unknown): value is ComputeTargetColorId {
  return typeof value === "string"
    && COMPUTE_TARGET_COLOR_IDS.includes(value as ComputeTargetColorId);
}

function stableIndex(input: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

export function defaultComputeTargetIconId(kind: ComputeTargetKind): ComputeTargetIconId {
  switch (kind) {
    case "managed_cloud":
    case "self_hosted_cloud":
      return "cloud";
    case "desktop_dispatch":
    case "local_direct":
      return "monitor";
    case "ssh":
      return "monitor";
  }
}

export function defaultComputeTargetColorId(targetId: string): ComputeTargetColorId {
  return COMPUTE_TARGET_COLOR_IDS[stableIndex(targetId, COMPUTE_TARGET_COLOR_IDS.length)]
    ?? "blue";
}

export function normalizeComputeTargetAppearancePreference(
  input: unknown,
): ComputeTargetAppearancePreference | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
  if (!targetId) {
    return null;
  }
  const displayName = typeof record.displayName === "string"
    ? record.displayName.trim()
    : "";
  return {
    targetId,
    displayName: displayName || null,
    iconId: isComputeTargetIconId(record.iconId) ? record.iconId : "monitor",
    colorId: isComputeTargetColorId(record.colorId) ? record.colorId : "blue",
  };
}

export function resolveComputeTargetAppearance(input: {
  targetId: string;
  displayName: string;
  kind: ComputeTargetKind;
  preference?: ComputeTargetAppearancePreference | null;
}): ComputeTargetAppearance {
  const iconId = input.preference?.iconId ?? defaultComputeTargetIconId(input.kind);
  const colorId = input.preference?.colorId ?? defaultComputeTargetColorId(input.targetId);
  const icon = ICON_OPTIONS_BY_ID.get(iconId) ?? ICON_OPTIONS_BY_ID.get("monitor")!;
  const color = COLOR_OPTIONS_BY_ID.get(colorId) ?? COLOR_OPTIONS_BY_ID.get("blue")!;
  const displayName = input.preference?.displayName?.trim() || input.displayName;
  return {
    displayName,
    iconId: icon.id,
    iconLabel: icon.label,
    colorId: color.id,
    colorLabel: color.label,
    colorValue: color.value,
  };
}

````

### desktop/src/lib/domain/compute/target-workspace-id.ts

_Size: 722 bytes_

````tsx
const TARGET_WORKSPACE_PREFIX = "target";

export interface TargetWorkspaceSyntheticId {
  targetId: string;
  anyharnessWorkspaceId: string;
}

export function targetWorkspaceSyntheticId(
  targetId: string,
  anyharnessWorkspaceId: string,
): string {
  return `${TARGET_WORKSPACE_PREFIX}:${targetId}:${anyharnessWorkspaceId}`;
}

export function parseTargetWorkspaceSyntheticId(
  workspaceId: string,
): TargetWorkspaceSyntheticId | null {
  const [prefix, targetId, anyharnessWorkspaceId, ...extra] = workspaceId.split(":");
  if (
    prefix !== TARGET_WORKSPACE_PREFIX
    || !targetId
    || !anyharnessWorkspaceId
    || extra.length > 0
  ) {
    return null;
  }
  return { targetId, anyharnessWorkspaceId };
}

````

### cloud/sdk-react/src/hooks/targets.ts

_Size: 824 bytes_

````tsx
import { useQuery } from "@tanstack/react-query";
import {
  getTarget,
  listTargets,
  type CloudTargetDetail,
  type CloudTargetSummary,
} from "@proliferate/cloud-sdk";
import { cloudTargetKey, cloudTargetsKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudTargets(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudTargetSummary[]>({
    queryKey: cloudTargetsKey(),
    queryFn: () => listTargets(client),
    enabled,
  });
}

export function useCloudTarget(targetId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudTargetDetail>({
    queryKey: cloudTargetKey(targetId),
    queryFn: () => getTarget(targetId!, client),
    enabled: enabled && targetId !== null,
  });
}

````

### cloud/sdk/src/client/targets.ts

_Size: 1,470 bytes_

````tsx
import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  ArchiveCloudTargetResponse,
  CloudTargetDetail,
  CloudTargetEnrollmentRequest,
  CloudTargetEnrollmentResponse,
  CloudTargetSummary,
} from "../types/index.js";

export async function createTargetEnrollment(
  body: CloudTargetEnrollmentRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetEnrollmentResponse> {
  return client.requestJson<CloudTargetEnrollmentResponse>({
    method: "POST",
    path: "/v1/cloud/targets/enrollments",
    body,
  });
}

export async function listTargets(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetSummary[]> {
  return client.requestJson<CloudTargetSummary[]>({
    method: "GET",
    path: "/v1/cloud/targets",
  });
}

export async function getTarget(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudTargetDetail> {
  return client.requestJson<CloudTargetDetail>({
    method: "GET",
    path: "/v1/cloud/targets/{target_id}",
    pathParams: { target_id: targetId },
  });
}

export async function archiveTarget(
  targetId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ArchiveCloudTargetResponse> {
  return client.requestJson<ArchiveCloudTargetResponse>({
    method: "POST",
    path: "/v1/cloud/targets/{target_id}/archive",
    pathParams: { target_id: targetId },
  });
}

````

### cloud/sdk/src/types/targets.ts

_Size: 2,013 bytes_

````tsx
import type { components } from "../generated/openapi.js";

export type CloudTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type CloudTargetStatus = "online" | "offline" | "degraded" | "enrolling" | "archived";
export type CloudTargetUpdateChannel = "stable" | "beta" | "pinned";

export type CloudTargetInventory = components["schemas"]["CloudTargetInventoryModel"];

export type CloudTargetStatusDetail = Omit<
  components["schemas"]["CloudTargetStatusModel"],
  "status"
> & {
  status: CloudTargetStatus;
};

export type CloudTargetSummary = Omit<
  components["schemas"]["CloudTargetSummary"],
  "kind" | "status" | "ownerScope" | "statusDetail"
> & {
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  statusDetail?: CloudTargetStatusDetail | null;
};

export type CloudTargetDetail = Omit<
  components["schemas"]["CloudTargetDetail"],
  "kind" | "status" | "ownerScope" | "statusDetail"
> & {
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  statusDetail?: CloudTargetStatusDetail | null;
};

export type CloudTargetEnrollmentRequest = Omit<
  components["schemas"]["CloudTargetEnrollmentRequest"],
  "kind"
> & {
  kind: Exclude<CloudTargetKind, "local_direct" | "managed_cloud">;
};

export type CloudTargetEnrollmentResponse =
  components["schemas"]["CloudTargetEnrollmentResponse"];

export type ArchiveCloudTargetResponse =
  components["schemas"]["ArchiveCloudTargetResponse"];

export type SetDesiredVersionsRequest = Omit<
  components["schemas"]["SetDesiredVersionsRequest"],
  "updateChannel"
> & {
  updateChannel?: CloudTargetUpdateChannel | null;
};

export type SetDesiredVersionsResponse =
  components["schemas"]["SetDesiredVersionsResponse"];

export type SafeStopCheckResponse =
  components["schemas"]["SafeStopCheckResponse"];

export type RevokeWorkersResponse =
  components["schemas"]["RevokeWorkersResponse"];

````

### desktop/src/components/home/screen/HomeTargetPicker.tsx

_Size: 14,051 bytes_

````tsx
import { useState } from "react";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  PickerEmptyRow,
  PickerPopoverContent,
} from "@/components/ui/PickerPopoverContent";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  ChevronRight,
  CloudIcon,
  FolderPlus,
  GitBranchIcon,
  Monitor,
  Search,
  Sparkles,
  X,
} from "@/components/ui/icons";
import { matchesPickerSearch } from "@/lib/infra/search/search";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "@/lib/domain/home/home-next-launch";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type { CloudRepoActionState } from "@/lib/domain/workspaces/cloud/cloud-workspace-creation";

interface HomeTargetPickerProps {
  destination: HomeNextDestination;
  repoLaunchKind: HomeNextRepoLaunchKind;
  repositories: SettingsRepositoryEntry[];
  selectedRepository: SettingsRepositoryEntry | null;
  selectedBranchName: string | null;
  branchOptions: string[];
  branchLoading: boolean;
  cloudActionBySourceRoot: Record<string, CloudRepoActionState>;
  onSelectCowork: () => void;
  onSelectRepository: (sourceRoot: string) => void;
  onSelectRuntime: (launchKind: HomeNextRepoLaunchKind) => void;
  onSelectBranch: (branchName: string) => void;
  onAddRepository: () => void;
  onConfigureCloud: (repository: SettingsRepositoryEntry) => void;
}

function launchKindLabel(kind: HomeNextRepoLaunchKind): string {
  switch (kind) {
    case "worktree":
      return "New worktree";
    case "local":
      return "Work locally";
    case "cloud":
      return "Cloud workspace";
  }
}

function launchKindIcon(kind: HomeNextRepoLaunchKind) {
  switch (kind) {
    case "worktree":
      return <GitBranchIcon className="size-3.5" />;
    case "local":
      return <Monitor className="size-3.5" />;
    case "cloud":
      return <CloudIcon className="size-3.5" />;
  }
}

function projectLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "No project";
  }
  return input.selectedRepository?.name ?? "Choose repository";
}

function TargetSection({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1.5 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
      {label}
    </div>
  );
}

function targetRowSubtext(input: {
  repository: SettingsRepositoryEntry;
  launchKind: HomeNextRepoLaunchKind;
  selectedBranchName: string | null;
}): string {
  if (input.launchKind === "local") {
    return `${input.repository.name} · existing checkout`;
  }

  return `${input.repository.name} · ${input.selectedBranchName ?? "default branch"}`;
}

function runtimeOptionLabel(input: {
  launchKind: HomeNextRepoLaunchKind;
  cloudAction: CloudRepoActionState;
}): string {
  if (input.launchKind !== "cloud") {
    return launchKindLabel(input.launchKind);
  }
  if (input.cloudAction.kind === "loading") {
    return input.cloudAction.label;
  }
  if (input.cloudAction.kind === "configure") {
    return "Configure cloud workspace";
  }
  if (input.cloudAction.kind === "hidden") {
    return "Cloud unavailable";
  }
  return launchKindLabel(input.launchKind);
}

function projectAriaLabel(input: {
  destination: HomeNextDestination;
  selectedRepository: SettingsRepositoryEntry | null;
}): string {
  if (input.destination === "cowork") {
    return "Project: No project";
  }
  return input.selectedRepository
    ? `Project: ${input.selectedRepository.name} repository`
    : "Project: Choose repository";
}

function ProjectSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="p-2 pb-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search projects"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
}

function runtimeAriaLabel(input: {
  label: string;
  selectedRepository: SettingsRepositoryEntry | null;
  destination: HomeNextDestination;
}): string {
  if (!input.selectedRepository || input.destination === "cowork") {
    return "Runtime: no repository selected";
  }
  return `Runtime: ${input.label}`;
}

function BranchSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-control px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search branches"
          className="h-8 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
        />
      </div>
    </div>
  );
}

export function HomeTargetPicker({
  destination,
  repoLaunchKind,
  repositories,
  selectedRepository,
  selectedBranchName,
  branchOptions,
  branchLoading,
  cloudActionBySourceRoot,
  onSelectCowork,
  onSelectRepository,
  onSelectRuntime,
  onSelectBranch,
  onAddRepository,
  onConfigureCloud,
}: HomeTargetPickerProps) {
  const [projectSearchValue, setProjectSearchValue] = useState("");
  const [runtimeSearchValue, setRuntimeSearchValue] = useState("");
  const filteredRepositories = repositories.filter((repository) =>
    matchesPickerSearch([repository.name, repository.sourceRoot], projectSearchValue)
  );
  const filteredBranches = branchOptions.filter((branch) =>
    matchesPickerSearch([branch], runtimeSearchValue)
  );
  const isRepositoryTarget = destination === "repository" && !!selectedRepository;
  const canShowBranchChoices = isRepositoryTarget;
  const selectedRepositoryCloudAction: CloudRepoActionState = selectedRepository
    ? cloudActionBySourceRoot[selectedRepository.sourceRoot] ?? { kind: "hidden", label: null }
    : { kind: "hidden", label: null };
  const clearSearch = () => {
    setProjectSearchValue("");
    setRuntimeSearchValue("");
  };
  const runtimeLabel = repoLaunchKind === "cloud"
    ? runtimeOptionLabel({
      launchKind: repoLaunchKind,
      cloudAction: selectedRepositoryCloudAction,
    })
    : launchKindLabel(repoLaunchKind);
  const runtimeButton = (
    <PillControlButton
      icon={launchKindIcon(repoLaunchKind)}
      label={destination === "cowork" ? "No repository" : runtimeLabel}
      disabled={!selectedRepository || destination === "cowork"}
      disclosure={!!selectedRepository && destination === "repository"}
      aria-label={runtimeAriaLabel({
        label: runtimeLabel,
        selectedRepository,
        destination,
      })}
      className="max-w-[13rem]"
    />
  );

  return (
    <>
      <PopoverButton
        trigger={(
          <PillControlButton
            icon={destination === "cowork" ? <Sparkles className="size-3.5" /> : null}
            label={projectLabel({ destination, selectedRepository })}
            disclosure
            aria-label={projectAriaLabel({ destination, selectedRepository })}
            className="max-w-[14rem]"
          />
        )}
        side="top"
        className="w-[23rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <div className="flex max-h-[20rem] min-h-0 flex-col">
            <ProjectSearchField
              value={projectSearchValue}
              onChange={setProjectSearchValue}
            />
            <div className="min-h-0 overflow-y-auto py-1">
              {filteredRepositories.map((repository) => {
                const isSelected =
                  destination === "repository"
                  && selectedRepository?.sourceRoot === repository.sourceRoot;
                return (
                  <PopoverMenuItem
                    key={repository.sourceRoot}
                    label={repository.name}
                    trailing={isSelected ? <Check className="size-4" /> : null}
                    className="rounded-lg px-3 py-1.5 text-sm"
                    onClick={() => {
                      onSelectRepository(repository.sourceRoot);
                      clearSearch();
                      close();
                    }}
                  />
                );
              })}
              {filteredRepositories.length === 0 ? (
                <PickerEmptyRow label="No projects found" />
              ) : null}
            </div>

            <div className="mx-2.5 my-1 border-t border-border/70" />
            <div className="pb-1">
              <PopoverMenuItem
                icon={<FolderPlus className="size-3.5" />}
                label="Add new project"
                trailing={<ChevronRight className="size-3.5" />}
                className="rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() => {
                  onAddRepository();
                  clearSearch();
                  close();
                }}
              />
              <PopoverMenuItem
                icon={<X className="size-3.5" />}
                label="Don't work in a project"
                trailing={destination === "cowork" ? <Check className="size-3.5" /> : null}
                className="rounded-lg px-2.5 py-1.5 text-sm"
                onClick={() => {
                  onSelectCowork();
                  clearSearch();
                  close();
                }}
              />
            </div>
          </div>
        )}
      </PopoverButton>

      {selectedRepository && destination === "repository" ? (
        <PopoverButton
          trigger={runtimeButton}
          side="top"
          className="w-[22rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <PickerPopoverContent>
              <TargetSection label="Run in" />
              {(["worktree", "local", "cloud"] as const).map((launchKind) => {
                const isSelected = repoLaunchKind === launchKind;
                const cloudConfigure =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "configure";
                const cloudLoading =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "loading";
                const cloudHidden =
                  launchKind === "cloud" && selectedRepositoryCloudAction.kind === "hidden";
                return (
                  <PopoverMenuItem
                    key={launchKind}
                    icon={launchKindIcon(launchKind)}
                    label={runtimeOptionLabel({
                      launchKind,
                      cloudAction: selectedRepositoryCloudAction,
                    })}
                    disabled={cloudLoading || cloudHidden}
                    trailing={isSelected ? <Check className="size-3.5" /> : null}
                    onClick={() => {
                      if (cloudConfigure) {
                        onConfigureCloud(selectedRepository);
                        clearSearch();
                        close();
                        return;
                      }
                      onSelectRuntime(launchKind);
                      clearSearch();
                      close();
                    }}
                  >
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                      {targetRowSubtext({
                        repository: selectedRepository,
                        launchKind,
                        selectedBranchName,
                      })}
                    </span>
                  </PopoverMenuItem>
                );
              })}
            </PickerPopoverContent>
          )}
        </PopoverButton>
      ) : null}

      {selectedRepository && destination === "repository" && canShowBranchChoices ? (
        <PopoverButton
          trigger={(
            <PillControlButton
              icon={<GitBranchIcon className="size-3.5" />}
              label={selectedBranchName ?? "Base branch"}
              disclosure
              aria-label={`Branch: ${selectedBranchName ?? "base branch"}`}
              className="max-w-[15rem]"
            />
          )}
          side="top"
          className="w-[22rem] rounded-xl border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <PickerPopoverContent>
              <TargetSection label="Base branch" />
              <BranchSearchField
                value={runtimeSearchValue}
                onChange={setRuntimeSearchValue}
              />
              {branchLoading ? (
                <PickerEmptyRow label="Loading branches" />
              ) : filteredBranches.length > 0 ? (
                filteredBranches.map((branch) => (
                  <PopoverMenuItem
                    key={branch}
                    icon={<GitBranchIcon className="size-3.5" />}
                    label={branch}
                    trailing={selectedBranchName === branch ? <Check className="size-3.5" /> : null}
                    onClick={() => {
                      onSelectBranch(branch);
                      clearSearch();
                      close();
                    }}
                  />
                ))
              ) : (
                <PickerEmptyRow label="No branches found" />
              )}
            </PickerPopoverContent>
          )}
        </PopoverButton>
      ) : null}
      {!selectedRepository && destination === "repository" ? runtimeButton : null}
    </>
  );
}

````

### desktop/src/components/automations/editor/AutomationEditorModal.tsx

_Size: 15,368 bytes_

````tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { useAutomationTargetSelection } from "@/hooks/automations/derived/use-automation-target-selection";
import type { AutomationTargetSelection } from "@/lib/domain/automations/target/selection";
import type {
  AutomationRecord,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/domain/automations/run/ui-records";
import type {
  AutomationOwnerScope,
  AutomationTargetMode,
} from "@/lib/domain/automations/run/types";
import { useAgentRunConfigs } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-configs";
import {
  defaultAutomationTimezone,
  presetForRrule,
  rruleForPresetAtTime,
  validateAutomationRrule,
  validateAutomationTimezone,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule/schedule";
import {
  AutomationSchedulePopover,
  AutomationTemplatePopover,
} from "./AutomationEditorControls";
import { AutomationAgentRunConfigPicker } from "@/components/automations/controls/AutomationAgentRunConfigPicker";
import { AutomationRunLocationSelector } from "@/components/automations/controls/AutomationRunLocationSelector";

type SchedulePresetValue = AutomationSchedulePresetOrCustom;

interface AutomationEditorModalProps {
  open: boolean;
  automation: AutomationRecord | null;
  busy: boolean;
  initialOwnerScope: AutomationOwnerScope;
  organizationId: string | null;
  organizationName?: string | null;
  canManageTeamAutomations: boolean;
  onClose: () => void;
  onConfigureCloudTarget: (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => void;
  onCreate: (body: CreateAutomationInput) => Promise<void>;
  onUpdate: (automationId: string, body: UpdateAutomationInput) => Promise<void>;
}

export function AutomationEditorModal({
  open,
  automation,
  busy,
  initialOwnerScope,
  organizationId,
  organizationName = null,
  canManageTeamAutomations,
  onClose,
  onConfigureCloudTarget,
  onCreate,
  onUpdate,
}: AutomationEditorModalProps) {
  const [title, setTitle] = useState(automation?.title ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [targetOverride, setTargetOverride] = useState<AutomationTargetSelection | null>(null);
  const [draftOwnerScope, setDraftOwnerScope] = useState<AutomationOwnerScope>(
    automation?.ownerScope ?? initialOwnerScope,
  );
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetValue>(
    automation ? presetForRrule(automation.schedule.rrule) : "daily",
  );
  const [rrule, setRrule] = useState(
    automation?.schedule.rrule ?? rruleForPresetAtTime("daily"),
  );
  const [timezone, setTimezone] = useState(
    automation?.schedule.timezone ?? defaultAutomationTimezone(),
  );
  const [cloudAgentRunConfigId, setCloudAgentRunConfigId] = useState<string | null>(
    automation?.cloudAgentRunConfigId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingConfigureTarget, setPendingConfigureTarget] = useState<{
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  } | null>(null);

  const ownerScope = automation?.ownerScope ?? draftOwnerScope;
  const isTeamAutomation = ownerScope === "organization";
  const personalTargetSelection = useAutomationTargetSelection({
    automation: automation?.ownerScope === "personal" ? automation : null,
    selectedTarget: ownerScope === "personal" ? targetOverride : null,
    ownerScope: "personal",
    enabled: open && (!automation || automation.ownerScope === "personal"),
  });
  const teamTargetSelection = useAutomationTargetSelection({
    automation: automation?.ownerScope === "organization" ? automation : null,
    selectedTarget: ownerScope === "organization" ? targetOverride : null,
    ownerScope: "organization",
    organizationId,
    enabled: open
      && canManageTeamAutomations
      && organizationId !== null
      && (!automation || automation.ownerScope === "organization"),
  });
  const activeTargetSelection = isTeamAutomation ? teamTargetSelection : personalTargetSelection;
  const effectiveOrganizationId = isTeamAutomation ? organizationId : null;
  const selectedTarget = activeTargetSelection.selectedTarget;
  const targetMode: AutomationTargetMode = isTeamAutomation
    ? "shared_cloud"
    : selectedTarget?.executionTarget === "local"
      ? "local"
      : "personal_cloud";
  const runConfigsQuery = useAgentRunConfigs({
    ownerScope: isTeamAutomation ? undefined : ownerScope,
    organizationId: effectiveOrganizationId,
    usableIn: isTeamAutomation ? "shared_sandboxes" : "personal_sandboxes",
    status: "active",
  }, open && (!isTeamAutomation || effectiveOrganizationId !== null));
  const runConfigs = (runConfigsQuery.data?.configs ?? []).filter((config) =>
    !isTeamAutomation || config.ownerScope !== "personal"
  );
  const ownerOptions = useMemo(() => [
    {
      value: "personal" as const,
      label: "Personal",
      description: "Run with your local or personal cloud setup.",
    },
    {
      value: "organization" as const,
      label: "Team",
      description: organizationName
        ? `Run in ${organizationName}'s shared cloud sandbox.`
        : "Run in the shared cloud sandbox.",
      disabledReason: !organizationId
        ? "Select an organization first."
        : !canManageTeamAutomations
          ? "Only organization admins can create team automations."
          : null,
    },
  ], [canManageTeamAutomations, organizationId, organizationName]);
  const teamTargetGroups = useMemo(() => teamTargetSelection.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        row.kind === "configureCloud" || row.target.executionTarget === "cloud"
      ),
    }))
    .filter((group) => group.rows.length > 0), [teamTargetSelection.groups]);
  const targetDisabledReason = isTeamAutomation
    ? "Select a configured cloud workspace for team automation."
    : activeTargetSelection.disabledReason;
  const canSubmitTarget = activeTargetSelection.canSubmit
    && (!isTeamAutomation || selectedTarget?.executionTarget === "cloud");
  const targetSelectionLoading = personalTargetSelection.isLoading
    || teamTargetSelection.isLoading;

  useEffect(() => {
    if (!cloudAgentRunConfigId || runConfigsQuery.isLoading) {
      return;
    }
    if (!runConfigs.some((config) => config.id === cloudAgentRunConfigId)) {
      setCloudAgentRunConfigId(null);
    }
  }, [cloudAgentRunConfigId, runConfigs, runConfigsQuery.isLoading]);

  const submit = async () => {
    setError(null);
    if (!title.trim() || !prompt.trim()) {
      setError("Add a title and prompt before saving.");
      return;
    }
    if (isTeamAutomation && !effectiveOrganizationId) {
      setError("Select an organization before creating a team automation.");
      return;
    }
    if (isTeamAutomation && !canManageTeamAutomations) {
      setError("Only organization admins can create team automations.");
      return;
    }
    if (!canSubmitTarget || !selectedTarget) {
      setError(targetDisabledReason ?? "Select a target before saving.");
      return;
    }
    if (!cloudAgentRunConfigId) {
      setError("Choose an agent run config before saving.");
      return;
    }
    const timezoneError = validateAutomationTimezone(timezone);
    if (timezoneError) {
      setError(timezoneError);
      return;
    }
    const rruleError = validateAutomationRrule(rrule);
    if (rruleError) {
      setError(rruleError);
      return;
    }
    const schedule = { rrule: rrule.trim(), timezone: timezone.trim() };
    try {
      if (automation) {
        await onUpdate(automation.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          schedule,
          targetMode,
          cloudAgentRunConfigId,
        });
      } else {
        await onCreate({
          title: title.trim(),
          prompt: prompt.trim(),
          gitOwner: selectedTarget.gitOwner,
          gitRepoName: selectedTarget.gitRepoName,
          schedule,
          ownerScope,
          organizationId: effectiveOrganizationId,
          targetMode,
          cloudAgentRunConfigId,
        });
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save automation.");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleRruleChange = (nextRrule: string) => {
    setRrule(nextRrule);
    setSchedulePreset(presetForRrule(nextRrule));
  };

  const hasDraftChanges = () => {
    const initialRrule = automation?.schedule.rrule ?? rruleForPresetAtTime("daily");
    const initialTimezone = automation?.schedule.timezone ?? defaultAutomationTimezone();
    return title.trim() !== (automation?.title ?? "").trim()
      || prompt.trim() !== (automation?.prompt ?? "").trim()
      || rrule.trim() !== initialRrule.trim()
      || timezone.trim() !== initialTimezone.trim()
      || targetOverride !== null
      || draftOwnerScope !== (automation?.ownerScope ?? initialOwnerScope)
      || cloudAgentRunConfigId !== (automation?.cloudAgentRunConfigId ?? null);
  };

  const handleConfigureCloudTarget = (target: {
    gitOwner: string;
    gitRepoName: string;
    ownerScope: AutomationOwnerScope;
  }) => {
    if (hasDraftChanges()) {
      setPendingConfigureTarget(target);
      return;
    }
    onConfigureCloudTarget(target);
  };

  const handleConfirmConfigureCloudTarget = () => {
    const target = pendingConfigureTarget;
    if (!target) {
      return;
    }
    setPendingConfigureTarget(null);
    onConfigureCloudTarget(target);
  };

  const handleOwnerScopeSelect = (nextOwnerScope: AutomationOwnerScope) => {
    if (nextOwnerScope === ownerScope) {
      return;
    }
    setDraftOwnerScope(nextOwnerScope);
    setCloudAgentRunConfigId(null);
    setError(null);
    if (nextOwnerScope === "organization" && targetOverride?.executionTarget === "local") {
      setTargetOverride(null);
    }
  };

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        disableClose={busy || pendingConfigureTarget !== null}
        title={automation ? "Edit automation" : "Create automation"}
        description="Create a scheduled automation."
        sizeClassName="max-h-[95vh] max-w-[800px]"
        bodyClassName="flex min-h-[24rem] flex-col px-5 pb-5 pt-0"
        panelClassName="border-border bg-background/95 shadow-lg backdrop-blur-xl"
        headerContent={(
          <div className="flex min-w-0 items-center justify-between gap-4 pt-2">
            <Input
              id="automation-title"
              data-testid="automation-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Automation title"
              placeholder="Automation title"
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 pr-2 text-lg leading-tight shadow-none outline-none placeholder:text-muted-foreground focus:ring-0"
            />
            <AutomationTemplatePopover
              onSelectTemplate={(template) => {
                if (!title.trim()) {
                  setTitle(template.title);
                }
                setPrompt(template.prompt);
              }}
            />
          </div>
        )}
      >
        <form
          id="automation-form"
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {error && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3">
            <AutomationRunLocationSelector
              ownerScope={ownerScope}
              canChangeOwner={!automation}
              ownerOptions={ownerOptions}
              personalGroups={personalTargetSelection.groups}
              teamGroups={teamTargetGroups}
              isLoading={targetSelectionLoading}
              disabledReason={activeTargetSelection.disabledReason}
              onSelectOwner={handleOwnerScopeSelect}
              onSelectTarget={setTargetOverride}
              onConfigureCloud={handleConfigureCloudTarget}
            />
            <Textarea
              id="automation-prompt"
              variant="ghost"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Prompt"
              placeholder="Add prompt e.g. look for crashes in $sentry"
              className="min-h-[12rem] px-0 text-base leading-relaxed placeholder:text-muted-foreground"
            />
          </div>
          <div className="shrink-0 pt-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <AutomationSchedulePopover
                  schedulePreset={schedulePreset}
                  rrule={rrule}
                  timezone={timezone}
                  onSchedulePresetChange={setSchedulePreset}
                  onRruleChange={handleRruleChange}
                  onTimezoneChange={setTimezone}
                  onRruleBlur={() => setError(validateAutomationRrule(rrule))}
                />
                <AutomationAgentRunConfigPicker
                  configs={runConfigs}
                  selectedConfigId={cloudAgentRunConfigId}
                  isLoading={runConfigsQuery.isLoading}
                  disabledReason={isTeamAutomation
                    ? "No shared team agent configs"
                    : "No agent run configs"}
                  onSelect={(config) => setCloudAgentRunConfigId(config?.id ?? null)}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={
                    (!automation && (runConfigsQuery.isLoading || targetSelectionLoading))
                    || !cloudAgentRunConfigId
                    || !canSubmitTarget
                  }
                >
                  {automation ? "Save" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </ModalShell>
      <ConfirmationDialog
        open={pendingConfigureTarget !== null}
        onClose={() => setPendingConfigureTarget(null)}
        onConfirm={handleConfirmConfigureCloudTarget}
        title="Discard automation draft?"
        description="Opening cloud repo settings will close this automation draft."
        confirmLabel="Open settings"
      />
    </>
  );
}

````

### desktop/src/components/automations/editor/AutomationEditorControls.tsx

_Size: 8,267 bytes_

````tsx
import type { ReactNode } from "react";
import { AUTOMATION_TEMPLATE_OPTIONS } from "@/copy/automations/automation-copy";
import {
  automationTimezoneOptions,
  rruleForPresetAtTime,
  schedulePresetAcceptsTime,
  timeForRrule,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule/schedule";
import {
  AUTOMATION_SCHEDULE_PRESET_OPTIONS,
  formatScheduleControlLabel,
} from "@/lib/domain/automations/schedule/presentation";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  Brain,
  Check,
  Clock,
  Sparkles,
} from "@/components/ui/icons";

interface AutomationControlOption {
  value: string;
  label: string;
  description?: string;
}

interface AutomationSelectPopoverProps {
  label: string;
  value: string;
  options: readonly AutomationControlOption[];
  onChange: (value: string) => void;
  icon: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface AutomationSchedulePopoverProps {
  schedulePreset: AutomationSchedulePresetOrCustom;
  rrule: string;
  timezone: string;
  onSchedulePresetChange: (value: AutomationSchedulePresetOrCustom) => void;
  onRruleChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onRruleBlur: () => void;
}

interface AutomationTemplatePopoverProps {
  onSelectTemplate: (template: { title: string; prompt: string }) => void;
}

const POPOVER_CLASS = "w-72 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationSelectPopover({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = "Default",
  disabled = false,
  className = "",
}: AutomationSelectPopoverProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  const displayLabel = selected?.label ?? placeholder;

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          disabled={disabled}
          aria-label={label}
          icon={icon}
          label={displayLabel}
          disclosure
          className={`max-w-[14rem] ${className}`}
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <>
          {options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              label={option.label}
              onClick={() => {
                onChange(option.value);
                close();
              }}
              trailing={option.value === value ? <Check className="size-3.5 text-foreground/70" /> : null}
            >
              {option.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </PopoverMenuItem>
          ))}
        </>
      )}
    </PopoverButton>
  );
}

export function AutomationSchedulePopover({
  schedulePreset,
  rrule,
  timezone,
  onSchedulePresetChange,
  onRruleChange,
  onTimezoneChange,
  onRruleBlur,
}: AutomationSchedulePopoverProps) {
  const scheduleLabel = formatScheduleControlLabel(schedulePreset, rrule);
  const timeValue = timeForRrule(rrule);
  const timezoneOptions = automationTimezoneOptions(timezone);

  const selectPreset = (preset: AutomationSchedulePresetOrCustom) => {
    onSchedulePresetChange(preset);
    if (preset !== "custom") {
      onRruleChange(rruleForPresetAtTime(preset, timeValue));
    }
  };

  const updateTime = (nextTime: string) => {
    if (!schedulePresetAcceptsTime(schedulePreset)) return;
    onRruleChange(rruleForPresetAtTime(schedulePreset, nextTime));
  };

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Schedule"
          icon={<Clock className="size-3.5 shrink-0 text-muted-foreground" />}
          label={scheduleLabel}
          disclosure
          className="max-w-[15rem]"
        />
      )}
      side="top"
      className="w-80 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {() => (
        <div className="space-y-2">
          <div>
            {AUTOMATION_SCHEDULE_PRESET_OPTIONS.map((option) => (
              <PopoverMenuItem
                key={option.value}
                label={option.label}
                onClick={() => selectPreset(option.value)}
                trailing={schedulePreset === option.value ? <Check className="size-3.5 text-foreground/70" /> : null}
              />
            ))}
            <PopoverMenuItem
              label="Custom"
              onClick={() => selectPreset("custom")}
              trailing={schedulePreset === "custom" ? <Check className="size-3.5 text-foreground/70" /> : null}
            >
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                Edit the RRULE directly
              </span>
            </PopoverMenuItem>
          </div>

          <div className="border-t border-border/60 px-2.5 pb-2 pt-3">
            {schedulePresetAcceptsTime(schedulePreset) && (
              <div className="grid gap-1.5">
                <Label htmlFor="automation-schedule-time">Time</Label>
                <Input
                  id="automation-schedule-time"
                  type="time"
                  value={timeValue}
                  onChange={(event) => updateTime(event.target.value)}
                />
              </div>
            )}
            {schedulePreset === "custom" && (
              <div className="grid gap-1.5">
                <Label htmlFor="automation-rrule">RRULE</Label>
                <Textarea
                  id="automation-rrule"
                  value={rrule}
                  onChange={(event) => onRruleChange(event.target.value)}
                  onBlur={onRruleBlur}
                  rows={3}
                  className="font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
                />
              </div>
            )}
            <div className="mt-3 grid gap-1.5">
              <Label htmlFor="automation-timezone">Timezone</Label>
              <Select
                id="automation-timezone"
                value={timezone}
                onChange={(event) => onTimezoneChange(event.target.value)}
              >
                {timezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

export function AutomationTemplatePopover({ onSelectTemplate }: AutomationTemplatePopoverProps) {
  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 bg-card/80"
        >
          <Sparkles className="size-3.5" />
          Use template
        </Button>
      )}
      side="bottom"
      align="end"
      className="w-96 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          {AUTOMATION_TEMPLATE_OPTIONS.map((template) => (
            <PopoverMenuItem
              key={template.title}
              label={template.title}
              icon={<Sparkles className="size-3.5 text-muted-foreground" />}
              onClick={() => {
                onSelectTemplate(template);
                close();
              }}
            >
              <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {template.prompt}
              </span>
            </PopoverMenuItem>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

export function reasoningIcon() {
  return <Brain className="size-3.5" />;
}

````

### desktop/src/hooks/automations/derived/use-automation-target-selection.ts

_Size: 3,285 bytes_

````tsx
import { useMemo } from "react";
import {
  useCloudRepoConfigs,
  useOrganizationCloudRepoConfigs,
} from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useSettingsRepositories } from "@/hooks/settings/derived/use-settings-repositories";
import { useStandardRepoProjection } from "@/hooks/workspaces/derived/use-standard-repo-projection";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "@/lib/domain/automations/target/selection";
import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";

const EMPTY_REPO_CONFIGS: CloudRepoConfigSummary[] = [];
const EMPTY_CLOUD_WORKSPACES: ReturnType<typeof useStandardRepoProjection>["cloudWorkspaces"] = [];

type AutomationTargetOwnerScope = "personal" | "organization";

interface UseAutomationTargetSelectionInput {
  automation: {
    executionTarget?: AutomationTargetSelection["executionTarget"];
    targetMode?: "local" | "personal_cloud" | "shared_cloud";
    gitOwner: string;
    gitRepoName: string;
  } | null;
  selectedTarget: AutomationTargetSelection | null;
  ownerScope?: AutomationTargetOwnerScope;
  organizationId?: string | null;
  enabled?: boolean;
}

export function useAutomationTargetSelection({
  automation,
  selectedTarget,
  ownerScope = "personal",
  organizationId = null,
  enabled = true,
}: UseAutomationTargetSelectionInput) {
  const isOrganization = ownerScope === "organization";
  const { data: personalRepoConfigsData, isLoading: personalRepoConfigsLoading } =
    useCloudRepoConfigs(enabled && !isOrganization);
  const { data: organizationRepoConfigsData, isLoading: organizationRepoConfigsLoading } =
    useOrganizationCloudRepoConfigs(
      organizationId,
      enabled && isOrganization && organizationId !== null,
    );
  const { repositories } = useSettingsRepositories();
  const { cloudWorkspaces, isLoading: repoProjectionLoading } =
    useStandardRepoProjection();
  const repoConfigs = isOrganization
    ? organizationRepoConfigsData?.configs
    : personalRepoConfigsData?.configs;
  const scopedCloudWorkspaces = isOrganization ? EMPTY_CLOUD_WORKSPACES : cloudWorkspaces;
  const repoConfigsLoading = isOrganization
    ? organizationRepoConfigsLoading
    : personalRepoConfigsLoading;

  const targetState = useMemo(() => buildAutomationTargetState({
    repoConfigs: repoConfigs ?? EMPTY_REPO_CONFIGS,
    cloudWorkspaces: scopedCloudWorkspaces,
    repositories,
    selectedTarget,
    savedTarget: automation
      ? {
        executionTarget: automation.executionTarget
          ?? (automation.targetMode === "local" ? "local" : "cloud"),
        gitOwner: automation.gitOwner,
        gitRepoName: automation.gitRepoName,
      }
      : null,
    editRepoIdentity: automation
      ? {
        gitOwner: automation.gitOwner,
        gitRepoName: automation.gitRepoName,
      }
      : null,
    cloudAvailable: !isOrganization || organizationId !== null,
  }), [
    automation?.executionTarget,
    automation?.targetMode,
    automation?.gitOwner,
    automation?.gitRepoName,
    isOrganization,
    organizationId,
    repoConfigs,
    repositories,
    scopedCloudWorkspaces,
    selectedTarget,
  ]);

  return {
    ...targetState,
    isLoading: repoConfigsLoading || repoProjectionLoading,
  };
}

````

### desktop/src/lib/domain/automations/target/selection.ts

_Size: 11,330 bytes_

````tsx
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type {
  AutomationExecutionTarget,
  AutomationTargetCloudWorkspaceRecord,
  AutomationTargetRepoConfigRecord,
} from "@/lib/domain/automations/target/records";

export type { AutomationExecutionTarget };

export interface AutomationTargetSelection {
  executionTarget: AutomationExecutionTarget;
  gitOwner: string;
  gitRepoName: string;
}

export interface AutomationTargetRepoIdentity {
  gitOwner: string;
  gitRepoName: string;
}

export type AutomationTargetRow =
  | {
    kind: "target";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    target: AutomationTargetSelection;
    disabledReason: string | null;
    selected: boolean;
  }
  | {
    kind: "configureCloud";
    id: string;
    repoKey: string;
    repoLabel: string;
    label: string;
    description: string | null;
    gitOwner: string;
    gitRepoName: string;
  };

export interface AutomationTargetGroup {
  repoKey: string;
  repoLabel: string;
  gitOwner: string;
  gitRepoName: string;
  rows: AutomationTargetRow[];
}

export interface AutomationTargetState {
  groups: AutomationTargetGroup[];
  selectedTarget: AutomationTargetSelection | null;
  selectedRow: Extract<AutomationTargetRow, { kind: "target" }> | null;
  canSubmit: boolean;
  disabledReason: string | null;
}

interface BuildAutomationTargetStateInput {
  repoConfigs: readonly AutomationTargetRepoConfigRecord[] | null | undefined;
  cloudWorkspaces?: readonly AutomationTargetCloudWorkspaceRecord[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
  selectedTarget: AutomationTargetSelection | null;
  savedTarget?: AutomationTargetSelection | null;
  editRepoIdentity?: AutomationTargetRepoIdentity | null;
  cloudAvailable?: boolean;
}

interface TargetRepoDraft {
  repoKey: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  hasLocalRepository: boolean;
  hasConfiguredCloud: boolean;
  hasCloudWorkspace: boolean;
  hasCloudConfig: boolean;
  hasSavedCloudTarget: boolean;
  hasSavedLocalTarget: boolean;
}

export function buildAutomationTargetState({
  repoConfigs,
  cloudWorkspaces,
  repositories,
  selectedTarget,
  savedTarget = null,
  editRepoIdentity = null,
  cloudAvailable = true,
}: BuildAutomationTargetStateInput): AutomationTargetState {
  const repoDrafts = buildTargetRepoDrafts({
    repoConfigs,
    cloudWorkspaces,
    repositories,
    savedTarget,
    editRepoIdentity,
  });
  const defaultTarget = editRepoIdentity
    ? savedTarget
    : firstDefaultTarget(repoDrafts, cloudAvailable);
  const requestedTarget = selectedTarget ?? defaultTarget;
  const constrainedTarget = constrainTargetToRows(
    requestedTarget,
    repoDrafts,
    cloudAvailable,
  );
  const effectiveTarget = constrainedTarget ?? constrainTargetToRows(
    defaultTarget,
    repoDrafts,
    cloudAvailable,
  );
  const groups = repoDrafts.map((draft) =>
    buildTargetGroup(draft, effectiveTarget, cloudAvailable)
  );
  const selectedRow = findSelectedTargetRow(groups, effectiveTarget);
  const disabledReason = effectiveTarget
    ? selectedRow?.disabledReason ?? null
    : "Select a local worktree or configured cloud workspace.";

  return {
    groups,
    selectedTarget: effectiveTarget,
    selectedRow,
    canSubmit: Boolean(effectiveTarget && selectedRow && !selectedRow.disabledReason),
    disabledReason,
  };
}

export function isSameAutomationRepo(
  left: AutomationTargetRepoIdentity | null | undefined,
  right: AutomationTargetRepoIdentity | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && repoKey(left.gitOwner, left.gitRepoName) === repoKey(right.gitOwner, right.gitRepoName),
  );
}

export function automationTargetId(target: AutomationTargetSelection): string {
  return `${repoKey(target.gitOwner, target.gitRepoName)}:${target.executionTarget}`;
}

function buildTargetRepoDrafts(input: {
  repoConfigs: readonly AutomationTargetRepoConfigRecord[] | null | undefined;
  cloudWorkspaces?: readonly AutomationTargetCloudWorkspaceRecord[] | null | undefined;
  repositories: readonly SettingsRepositoryEntry[] | null | undefined;
  savedTarget?: AutomationTargetSelection | null;
  editRepoIdentity?: AutomationTargetRepoIdentity | null;
}): TargetRepoDraft[] {
  const draftsByKey = new Map<string, TargetRepoDraft>();

  const ensureDraft = (
    gitOwner: string | null | undefined,
    gitRepoName: string | null | undefined,
  ): TargetRepoDraft | null => {
    const owner = gitOwner?.trim();
    const name = gitRepoName?.trim();
    if (!owner || !name) {
      return null;
    }
    if (input.editRepoIdentity && !isSameAutomationRepo(input.editRepoIdentity, {
      gitOwner: owner,
      gitRepoName: name,
    })) {
      return null;
    }

    const key = repoKey(owner, name);
    const existing = draftsByKey.get(key);
    if (existing) {
      return existing;
    }

    const draft: TargetRepoDraft = {
      repoKey: key,
      gitOwner: owner,
      gitRepoName: name,
      label: `${owner}/${name}`,
      hasLocalRepository: false,
      hasConfiguredCloud: false,
      hasCloudWorkspace: false,
      hasCloudConfig: false,
      hasSavedCloudTarget: false,
      hasSavedLocalTarget: false,
    };
    draftsByKey.set(key, draft);
    return draft;
  };

  for (const repository of input.repositories ?? []) {
    if (repository.gitProvider && repository.gitProvider !== "github") {
      continue;
    }
    const draft = ensureDraft(repository.gitOwner, repository.gitRepoName);
    if (draft) {
      draft.hasLocalRepository = true;
      draft.label = repository.name || draft.label;
    }
  }

  for (const repoConfig of input.repoConfigs ?? []) {
    const draft = ensureDraft(repoConfig.gitOwner, repoConfig.gitRepoName);
    if (draft) {
      draft.hasCloudConfig = true;
      draft.hasConfiguredCloud = draft.hasConfiguredCloud || repoConfig.configured;
    }
  }

  for (const workspace of input.cloudWorkspaces ?? []) {
    if (workspace.repo.provider !== "github") {
      continue;
    }
    const draft = ensureDraft(workspace.repo.owner, workspace.repo.name);
    if (draft) {
      draft.hasCloudWorkspace = true;
    }
  }

  if (input.savedTarget) {
    const draft = ensureDraft(input.savedTarget.gitOwner, input.savedTarget.gitRepoName);
    if (draft) {
      if (input.savedTarget.executionTarget === "cloud") {
        draft.hasSavedCloudTarget = true;
      } else {
        draft.hasSavedLocalTarget = true;
      }
    }
  }

  return Array.from(draftsByKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function buildTargetGroup(
  draft: TargetRepoDraft,
  selectedTarget: AutomationTargetSelection | null,
  cloudAvailable: boolean,
): AutomationTargetGroup {
  const rows: AutomationTargetRow[] = [];
  const hasCloudTargetRow =
    draft.hasConfiguredCloud || draft.hasCloudWorkspace || draft.hasSavedCloudTarget;

  if (hasCloudTargetRow) {
    const target = {
      executionTarget: "cloud",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
    } satisfies AutomationTargetSelection;
    rows.push({
      kind: "target",
      id: automationTargetId(target),
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Cloud workspace",
      description: "Run in cloud with saved repo files and setup.",
      target,
      disabledReason: !cloudAvailable
        ? "Cloud is unavailable."
        : draft.hasConfiguredCloud || draft.hasCloudWorkspace
          ? null
          : "Cloud workspace is not configured.",
      selected: isSameAutomationTarget(selectedTarget, target),
    });
  }

  if (!draft.hasConfiguredCloud && !draft.hasCloudWorkspace
    && (draft.hasCloudConfig || draft.hasLocalRepository)) {
    rows.push({
      kind: "configureCloud",
      id: `${draft.repoKey}:configure-cloud`,
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Configure cloud workspace",
      description: "Set tracked files before running this automation in cloud.",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
    });
  }

  if (draft.hasLocalRepository || draft.hasSavedLocalTarget) {
    const target = {
      executionTarget: "local",
      gitOwner: draft.gitOwner,
      gitRepoName: draft.gitRepoName,
    } satisfies AutomationTargetSelection;
    rows.push({
      kind: "target",
      id: automationTargetId(target),
      repoKey: draft.repoKey,
      repoLabel: draft.label,
      label: "Local worktree",
      description: "Run on this device in a local AnyHarness worktree.",
      target,
      disabledReason: draft.hasLocalRepository ? null : "Local repository is unavailable.",
      selected: isSameAutomationTarget(selectedTarget, target),
    });
  }

  return {
    repoKey: draft.repoKey,
    repoLabel: draft.label,
    gitOwner: draft.gitOwner,
    gitRepoName: draft.gitRepoName,
    rows,
  };
}

function firstDefaultTarget(
  repoDrafts: TargetRepoDraft[],
  cloudAvailable: boolean,
): AutomationTargetSelection | null {
  if (cloudAvailable) {
    const cloudDraft = repoDrafts.find((draft) =>
      draft.hasConfiguredCloud || draft.hasCloudWorkspace
    );
    if (cloudDraft) {
      return {
        executionTarget: "cloud",
        gitOwner: cloudDraft.gitOwner,
        gitRepoName: cloudDraft.gitRepoName,
      };
    }
  }

  const localDraft = repoDrafts.find((draft) => draft.hasLocalRepository);
  return localDraft
    ? {
      executionTarget: "local",
      gitOwner: localDraft.gitOwner,
      gitRepoName: localDraft.gitRepoName,
    }
    : null;
}

function constrainTargetToRows(
  target: AutomationTargetSelection | null,
  repoDrafts: TargetRepoDraft[],
  cloudAvailable: boolean,
): AutomationTargetSelection | null {
  if (!target) {
    return null;
  }

  const draft = repoDrafts.find((candidate) =>
    candidate.repoKey === repoKey(target.gitOwner, target.gitRepoName)
  );
  if (!draft) {
    return null;
  }

  if (target.executionTarget === "cloud") {
    return draft.hasConfiguredCloud || draft.hasCloudWorkspace || draft.hasSavedCloudTarget
      ? target
      : firstDefaultTarget([draft], cloudAvailable);
  }

  return draft.hasLocalRepository || draft.hasSavedLocalTarget
    ? target
    : firstDefaultTarget([draft], cloudAvailable);
}

function findSelectedTargetRow(
  groups: AutomationTargetGroup[],
  selectedTarget: AutomationTargetSelection | null,
): Extract<AutomationTargetRow, { kind: "target" }> | null {
  if (!selectedTarget) {
    return null;
  }

  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "target" && isSameAutomationTarget(row.target, selectedTarget)) {
        return row;
      }
    }
  }

  return null;
}

function isSameAutomationTarget(
  left: AutomationTargetSelection | null | undefined,
  right: AutomationTargetSelection | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.executionTarget === right.executionTarget
    && isSameAutomationRepo(left, right),
  );
}

function repoKey(gitOwner: string, gitRepoName: string): string {
  return `${gitOwner.trim().toLowerCase()}/${gitRepoName.trim().toLowerCase()}`;
}

````

### desktop/src/lib/domain/automations/target/presentation.ts

_Size: 242 bytes_

````tsx
import { AUTOMATION_EXECUTION_TARGET_VALUES } from "@/config/automations";

export const AUTOMATION_EXECUTION_TARGET_OPTIONS = AUTOMATION_EXECUTION_TARGET_VALUES.map((value) => ({
  value,
  label: value === "cloud" ? "Cloud" : "Local",
}));

````

### desktop/src/lib/domain/automations/target/records.ts

_Size: 313 bytes_

````tsx
export type AutomationExecutionTarget = "cloud" | "local";

export interface AutomationTargetRepoConfigRecord {
  gitOwner: string;
  gitRepoName: string;
  configured: boolean;
}

export interface AutomationTargetCloudWorkspaceRecord {
  repo: {
    provider: string;
    owner: string;
    name: string;
  };
}

````
