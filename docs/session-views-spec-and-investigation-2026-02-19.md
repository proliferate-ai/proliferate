# Individual Session Views — Full Spec + Deep Investigation

Date: 2026-02-19  
Scope: `/workspace/[sessionId]` session UI (chat + panel system) including layout, panel routing, and each panel's job-to-be-done.

---

## 1) Your Goals (Rewritten Clearly)

These are the goals you requested, translated into explicit product requirements:

1. I can choose where the panel sidebar lives.
2. I can resize panes easily and reliably.
3. VS Code opens fast, and when it fails, I see exactly why.
4. Services panel is actually readable and useful, not cramped/confusing.
5. Every panel feels intentional and consistent.
6. Each panel has a clear job and succeeds at that job.

---

## 2) Current Panel System: Architecture and Wiring

### 2.1 Session page composition

Current page composition is:

```tsx
// apps/web/src/app/(workspace)/workspace/[id]/page.tsx
<CodingSession sessionId={id} ... />
```

`CodingSession` then renders:

```tsx
// apps/web/src/components/coding-session/coding-session.tsx
<ResizablePanelGroup orientation="horizontal">
	<ResizablePanel>{/* Chat */}</ResizablePanel>
	<ResizableHandle withHandle />
	<ResizablePanel>{/* RightPanel */}</ResizablePanel>
</ResizablePanelGroup>
```

The right side is a mode-switching container:

```tsx
// apps/web/src/components/coding-session/right-panel.tsx
if (mode.type === "vscode") return <VscodePanel ... />;
if (mode.type === "services") return <ServicesPanel ... />;
if (mode.type === "terminal") return <TerminalPanel ... />;
...
```

### 2.2 Panel mode state

All panel mode, tab pinning, and split percentages are in one store:

```ts
// apps/web/src/stores/preview-panel.ts
type PreviewMode =
	| { type: "none" }
	| { type: "url"; url: string | null }
	| { type: "vscode" }
	| { type: "terminal" }
	| { type: "git" }
	| { type: "services" }
	| { type: "environment" }
	| { type: "settings" }
	| { type: "artifacts" }
	| { type: "investigation" }
	| { type: "file"; file: VerificationFile }
	| { type: "gallery"; files: VerificationFile[] };
```

Persisted state includes:
- `pinnedTabs`
- `panelSizes`

Not persisted:
- panel side (left/right) because side selection does not exist yet.

### 2.3 Shared panel chrome

Most panels use the same shell:

```tsx
// apps/web/src/components/coding-session/panel-shell.tsx
<div className="h-10 px-3 border-b ...">
	<span>{title}</span>
	{actions}
	<Button onClick={closePanel}><X /></Button>
</div>
```

This gives baseline structural consistency, but panel internals still vary heavily.

---

## 3) Goal-by-Goal Investigation

## 3.1 Goal: "I can drag/resize and choose where the panel sidebar is"

### Intended capability
- Resize chat vs tool-pane width.
- Optionally dock the panel side on left or right (user preference).
- Make the drag affordance obvious.

### Current implementation

```tsx
// apps/web/src/components/coding-session/coding-session.tsx
<ResizablePanel defaultSize={panelSizes[0] || 35} minSize={25} maxSize={65} />
<ResizableHandle withHandle />
<ResizablePanel defaultSize={panelSizes[1] || 65} minSize={35} maxSize={75} />
```

```ts
// apps/web/src/stores/preview-panel.ts
panelSizes: [35, 65];
setPanelSizes: (sizes) => set({ panelSizes: sizes });
```

### What works
- Split resizing exists.
- Size persists.

### What is missing / broken
- No side swap feature (`left|right`).
- Handle is visually thin and easy to miss:

```tsx
// apps/web/src/components/ui/resizable.tsx
className="... flex w-px ... after:w-1 ..."
```

This makes users perceive "can't drag" even though resize technically exists.

### Verdict
- Functional: partially working.
- Product goal fit: incomplete.

---

## 3.2 Goal: "VS Code should start reliably and tell me exactly why if it fails"

### Intended capability
- Start editor fast.
- Show true readiness status.
- Show real error data when startup fails.
- Route editor traffic securely.

### Current startup flow

```tsx
// apps/web/src/components/coding-session/vscode-panel.tsx
GET  /proxy/:session/:token/devtools/mcp/api/services
if openvscode-server running -> status = ready
else
POST /proxy/:session/:token/devtools/mcp/api/services { name, command }
poll /api/services every 1s up to MAX_POLL_ATTEMPTS
if never running -> status = error ("Failed to start VS Code server")
```

The command launched:

```bash
openvscode-server \
  --port 3901 \
  --without-connection-token \
  --host 127.0.0.1 \
  --server-base-path=/proxy/<session>/<token>/devtools/vscode \
  --default-folder /home/user/workspace
```

### Proxy chain

```txt
Browser iframe
  -> Gateway /proxy/:session/:token/devtools/vscode/*
  -> previewUrl/_proliferate/vscode/*
  -> Caddy forward_auth /api/auth/check
  -> reverse_proxy localhost:3901 (openvscode-server)
```

### What works
- The full proxy architecture is in place (`HTTP + WS`).
- Auth boundary is handled.
- Retry button exists.

### What is broken / weak
- Progress is synthetic (attempt count), not actual readiness.
- Generic error message hides root cause.
- No inline surfaced service stderr.
- In many failure cases user sees:
  - "Launching server" -> timeout -> "Failed to start VS Code server"
  - with no actionable diagnosis.

### Secondary risk: stale base snapshots

Base snapshot version key hashes only:

```ts
// packages/shared/src/sandbox/version-key.ts
hash(PLUGIN_MJS + DEFAULT_CADDYFILE + getOpencodeConfig(defaultModel))
```

It does not include package/image layer versioning inputs, so stale runtime behavior can persist if snapshot rebuild cadence is not explicit.

### Verdict
- Functional: partially broken in practice.
- UX/diagnostics: materially broken.

---

## 3.3 Goal: "Services panel should be clean and useful"

### Intended capability
- Clear at-a-glance service health.
- Easy start/stop/restart and logs.
- Clear preview-port routing model.

### Current behavior model

Service list and actions call sandbox-mcp:

```ts
// apps/web/src/components/coding-session/runtime/use-services.ts
GET    /api/services
POST   /api/services
DELETE /api/services/:name
POST   /api/expose
GET    /api/logs/:name
```

Service manager stores one global exposed port:

```ts
// packages/sandbox-mcp/src/service-manager.ts
state.exposedPort = port;
```

UI row is dense and icon-heavy:

```tsx
// apps/web/src/components/coding-session/services-panel.tsx
<StatusDot />
<service name clickable to logs />
<small uptime text />
<icon buttons: stop/start/restart />
<tiny command text>
<Preview button shown per row>
```

### What works
- Core controls work.
- Logs streaming works.
- Expose-port API works.

### What is weak/broken
- Density and hierarchy are hard to scan quickly.
- "Preview" appears per-service, but route is based on one global `exposedPort`.
- Error triage requires manual logs open every time; no concise inline failure reason.

### Verdict
- Functional: mostly working.
- UX/product fit: below target.

---

## 3.4 Goal: "All panels should look/feel coherent"

### Existing panel catalog

From current mode system:

```ts
// apps/web/src/components/coding-session/coding-session.tsx
Preview, Code(VS Code), Terminal, Git, Services,
Workspace(Artifacts), Env, Settings, Investigation
```

### Panel-level jobs and current fit

| Panel | Job-to-be-done | Current fit |
|---|---|---|
| Preview | Render app/web service output quickly | Good baseline; readiness polling exists |
| VS Code | Full in-session editor | Functionally fragile; diagnostics weak |
| Terminal | Fast shell with reconnect | Good baseline |
| Git | Branch/commit/push/PR + changes | Feature-rich, but dense |
| Services | Run/inspect background processes | Core works, UX weak |
| Workspace/Artifacts | Show outputs/files/evidence | Good baseline |
| Environment | Manage env/secret values + missing required keys | Strong functionality |
| Settings | Session info + snapshots + auto-start | Good baseline |
| Investigation | Run triage and resolution | Good baseline |

### Shared shell is good but insufficient

```tsx
// apps/web/src/components/coding-session/panel-shell.tsx
title + actions + close + content area
```

The shell is consistent; internal density, status language, and error affordances are not.

---

## 4) Feature Deep-Dive by Panel (Exists vs Should Fit)

## 4.1 Preview panel

### What exists
- URL polling with fallback handling for CORS/no-cors.
- Fullscreen toggle.
- Retry flow.

```tsx
// apps/web/src/components/coding-session/preview-panel.tsx
status: "checking" | "ready" | "unavailable"
```

### Should fit
- Must always make "server not running" distinct from "network/proxy failure".
- Should expose active port context when relevant (especially after `services expose`).

## 4.2 Terminal panel

### What exists
- WS terminal to gateway proxy.
- Resize events.
- Auto-reconnect after close.

```tsx
// apps/web/src/components/coding-session/terminal-panel.tsx
ws.send(JSON.stringify({ type: "resize", cols, rows }))
```

### Should fit
- Keep reconnect predictable.
- Add clearer reconnection attempt visibility for reliability debugging.

## 4.3 Git panel

### What exists
- Poll status.
- Create branch, commit, push, create PR.
- Toasts for success/failure.

```tsx
// apps/web/src/components/coding-session/git-panel.tsx
sendGitCreateBranch / sendGitCommit / sendGitPush / sendGitCreatePr
```

### Should fit
- Better prioritize "what to do next" states when repo is busy/conflicted.
- Keep advanced controls but reduce visual overload.

## 4.4 Environment panel

### What exists
- Add variable (ephemeral or persisted).
- Paste `.env` bulk import.
- Missing required key detection from configuration env spec.
- Search/filter and delete.

```tsx
// apps/web/src/components/coding-session/environment-panel.tsx
missingRequired = specKeys.filter(required && !existingSpecKeys.has(key))
setMissingEnvKeyCount(missingRequired.length)
```

### Should fit
- Continue being the source of truth for required env readiness.
- Better tie warning badge to actionable missing-key UX.

## 4.5 Settings panel

### What exists
- Info / Snapshots / Auto-start tabs.
- Session info status summary.

### Should fit
- Keep this as "control plane" panel.
- Standardize language between Session Info and other status surfaces.

## 4.6 Workspace (artifacts) panel

### What exists
- File viewer, verification gallery, actions list.

### Should fit
- Continue as "evidence/output" surface.
- Improve transition cues between action outputs and files.

## 4.7 Investigation panel

### What exists
- Run status, trigger context, timeline, claim/resolve controls.

### Should fit
- Keep as operational triage surface.
- Ensure actionability remains high during failures.

---

## 5) Broken vs Not Broken Right Now

1. Pane resize: works.
2. Pane side docking selection: not implemented.
3. Drag affordance discoverability: weak.
4. VS Code proxy stack: implemented.
5. VS Code startup UX and diagnostics: broken/insufficient.
6. Services backend controls: working.
7. Services UX clarity: weak.
8. Cross-panel visual consistency: partial/inconsistent.

---

## 6) Detailed Acceptance Criteria (Per Goal)

## 6.1 Layout goal acceptance

1. Add panel docking preference: `panelSide: "left" | "right"` in store.
2. Render pane order from `panelSide`.
3. Expand resize handle hit area and contrast.
4. Keep persisted `panelSizes` behavior.

## 6.2 VS Code goal acceptance

1. Replace attempt-progress with readiness-stage model:
   - service start requested
   - process seen in service list
   - HTTP health response from VS Code route
   - iframe loaded
2. On failure, show concise root cause extracted from service log tail.
3. Add "Open VS Code logs" action directly from failure view.
4. Emit structured frontend telemetry for each startup stage.

## 6.3 Services goal acceptance

1. Clarify global port exposure model in UI copy.
2. Improve row hierarchy and control size.
3. Show inline status reason for `error` services.
4. Keep logs one click away with clear back path.

## 6.4 Cross-panel consistency acceptance

1. Define a panel UX spec with explicit standards:
   - header density
   - typography scales
   - loading states
   - empty states
   - failure states
   - action button hierarchy
2. Apply standards to VS Code, Services, Terminal, Git, and Settings.

---

## 7) Priority Order to Fix

1. VS Code diagnostics and stage-based startup UI.
2. Pane side docking + resize affordance improvements.
3. Services panel hierarchy and global-port clarity.
4. Cross-panel visual pass (consistency spec + implementation).

---

## 8) Key Files Referenced

- `apps/web/src/components/coding-session/coding-session.tsx`
- `apps/web/src/components/coding-session/right-panel.tsx`
- `apps/web/src/components/coding-session/panel-shell.tsx`
- `apps/web/src/components/coding-session/vscode-panel.tsx`
- `apps/web/src/components/coding-session/services-panel.tsx`
- `apps/web/src/components/coding-session/preview-panel.tsx`
- `apps/web/src/components/coding-session/terminal-panel.tsx`
- `apps/web/src/components/coding-session/git-panel.tsx`
- `apps/web/src/components/coding-session/environment-panel.tsx`
- `apps/web/src/components/coding-session/settings-panel.tsx`
- `apps/web/src/components/coding-session/artifacts-panel.tsx`
- `apps/web/src/components/coding-session/investigation-panel.tsx`
- `apps/web/src/stores/preview-panel.ts`
- `apps/web/src/components/ui/resizable.tsx`
- `apps/gateway/src/api/proxy/vscode.ts`
- `packages/sandbox-mcp/src/api-server.ts`
- `packages/sandbox-mcp/src/service-manager.ts`
- `packages/shared/src/sandbox/config.ts`
- `packages/shared/src/sandbox/version-key.ts`

---

## 9) Advisor Deep Context Dump (Raw Code + Traces)

This section is intentionally verbose for external technical review. It includes large, line-numbered excerpts so an advisor can reason directly from implementation without cloning context mentally from summaries.

### 9.1 High-Signal Navigation Index

- Session shell and split pane orchestration:
  - `apps/web/src/components/coding-session/coding-session.tsx`
  - `apps/web/src/components/coding-session/right-panel.tsx`
  - `apps/web/src/components/ui/resizable.tsx`
  - `apps/web/src/stores/preview-panel.ts`
- Panel chrome and panel internals:
  - `apps/web/src/components/coding-session/panel-shell.tsx`
  - `apps/web/src/components/coding-session/vscode-panel.tsx`
  - `apps/web/src/components/coding-session/services-panel.tsx`
  - `apps/web/src/components/coding-session/preview-panel.tsx`
  - `apps/web/src/components/coding-session/terminal-panel.tsx`
  - `apps/web/src/components/coding-session/git-panel.tsx`
  - `apps/web/src/components/coding-session/environment-panel.tsx`
  - `apps/web/src/components/coding-session/settings-panel.tsx`
  - `apps/web/src/components/coding-session/artifacts-panel.tsx`
  - `apps/web/src/components/coding-session/investigation-panel.tsx`
- Devtools backend path:
  - `apps/gateway/src/api/proxy/vscode.ts`
  - `apps/gateway/src/api/proxy/devtools.ts`
  - `packages/sandbox-mcp/src/api-server.ts`
  - `packages/sandbox-mcp/src/service-manager.ts`
- Snapshot/versioning context:
  - `packages/shared/src/sandbox/version-key.ts`
  - `packages/shared/src/sandbox/config.ts`

### 9.2 Quick Call Graph (Right Panel System)

```text
/workspace/[id]/page.tsx
  -> <CodingSession sessionId=...>
     -> usePreviewPanelStore(mode, pinnedTabs, panelSizes)
     -> ResizablePanelGroup(left chat, right tool pane)
     -> <RightPanel mode=...>
        -> mode router:
           - url -> PreviewPanel
           - vscode -> VscodePanel
           - terminal -> TerminalPanel
           - services -> ServicesPanel
           - git -> GitPanel
           - environment -> EnvironmentPanel
           - settings -> SettingsPanel
           - artifacts/file/gallery -> ArtifactsPanel/FileViewer/VerificationGallery
           - investigation -> InvestigationPanel
```

### 9.3 Runtime/Gateway path for VS Code

```text
VscodePanel (web)
  -> POST /proxy/:sid/:token/devtools/mcp/api/services (start openvscode-server)
  -> poll GET /proxy/:sid/:token/devtools/mcp/api/services
  -> iframe src /proxy/:sid/:token/devtools/vscode/

Gateway /proxy/.../devtools/vscode
  -> createVscodeProxyRoutes (HTTP)
  -> createVscodeWsProxy (WS)
  -> upstream previewUrl/_proliferate/vscode/*

Sandbox Caddy
  handle_path /_proliferate/vscode/*
    -> forward_auth /api/auth/check (sandbox-mcp)
    -> reverse_proxy localhost:3901 (openvscode-server)
```


### Right Panel Mode Router
File: `apps/web/src/components/coding-session/right-panel.tsx`
Lines: 1-240

```text
     1	"use client";
     2	
     3	import { usePreviewPanelStore } from "@/stores/preview-panel";
     4	import type {
     5		ActionApprovalRequestMessage,
     6		AutoStartOutputMessage,
     7		GitResultMessage,
     8		GitState,
     9	} from "@proliferate/shared";
    10	import { AnimatePresence, motion } from "framer-motion";
    11	import { Loader2, MousePointerClick } from "lucide-react";
    12	import dynamic from "next/dynamic";
    13	import { ArtifactsPanel } from "./artifacts-panel";
    14	import { EnvironmentPanel } from "./environment-panel";
    15	import { GitPanel } from "./git-panel";
    16	import { InvestigationPanel } from "./investigation-panel";
    17	import { PreviewPanel } from "./preview-panel";
    18	import { SettingsPanel } from "./settings-panel";
    19	import { VscodePanel } from "./vscode-panel";
    20	
    21	const TerminalPanel = dynamic(() => import("./terminal-panel").then((m) => m.TerminalPanel), {
    22		ssr: false,
    23	});
    24	
    25	const ServicesPanel = dynamic(() => import("./services-panel").then((m) => m.ServicesPanel), {
    26		ssr: false,
    27	});
    28	
    29	export interface SessionPanelProps {
    30		sessionId?: string;
    31		activityTick?: number;
    32		sessionStatus?: string;
    33		repoId?: string | null;
    34		configurationId?: string | null;
    35		repoName?: string | null;
    36		branchName?: string | null;
    37		snapshotId?: string | null;
    38		startedAt?: string | null;
    39		concurrentUsers?: number;
    40		isModal?: boolean;
    41		isMigrating?: boolean;
    42		canSnapshot?: boolean;
    43		isSnapshotting?: boolean;
    44		onSnapshot?: () => void;
    45		autoStartOutput?: AutoStartOutputMessage["payload"] | null;
    46		sendRunAutoStart?: (
    47			runId: string,
    48			mode?: "test" | "start",
    49			commands?: import("@proliferate/shared").ConfigurationServiceCommand[],
    50		) => void;
    51		gitState?: GitState | null;
    52		gitResult?: GitResultMessage["payload"] | null;
    53		sendGetGitStatus?: (workspacePath?: string) => void;
    54		sendGitCreateBranch?: (branchName: string, workspacePath?: string) => void;
    55		sendGitCommit?: (
    56			message: string,
    57			opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
    58		) => void;
    59		sendGitPush?: (workspacePath?: string) => void;
    60		sendGitCreatePr?: (
    61			title: string,
    62			body?: string,
    63			baseBranch?: string,
    64			workspacePath?: string,
    65		) => void;
    66		clearGitResult?: () => void;
    67		pendingApprovals?: ActionApprovalRequestMessage["payload"][];
    68	}
    69	
    70	interface RightPanelProps {
    71		isMobileFullScreen?: boolean;
    72		sessionProps?: SessionPanelProps;
    73		previewUrl?: string | null;
    74		runId?: string;
    75	}
    76	
    77	export function RightPanel({
    78		isMobileFullScreen,
    79		sessionProps,
    80		previewUrl,
    81		runId,
    82	}: RightPanelProps) {
    83		const { mode, close, setMobileView } = usePreviewPanelStore();
    84	
    85		const handleClose = () => {
    86			close();
    87			setMobileView("chat");
    88		};
    89	
    90		// If session isn't ready, show loading placeholder
    91		if (!sessionProps?.sessionId && mode.type !== "url") {
    92			return (
    93				<div className="flex flex-col h-full">
    94					<div className="flex-1 flex items-center justify-center">
    95						<div className="flex flex-col items-center gap-3">
    96							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    97							<p className="text-sm text-muted-foreground">Waiting for session...</p>
    98						</div>
    99					</div>
   100				</div>
   101			);
   102		}
   103	
   104		// Empty state when no panel is selected, or investigation mode without a runId
   105		if (mode.type === "none" || (mode.type === "investigation" && !runId)) {
   106			return (
   107				<div className="flex flex-col h-full items-center justify-center text-muted-foreground">
   108					<MousePointerClick className="h-8 w-8 mb-3 opacity-40" />
   109					<p className="text-sm">Select a tool from the top bar</p>
   110				</div>
   111			);
   112		}
   113	
   114		const panelContent = (() => {
   115			// Settings panel
   116			if (mode.type === "settings" && sessionProps) {
   117				return (
   118					<SettingsPanel
   119						panelMode={mode}
   120						sessionStatus={sessionProps.sessionStatus}
   121						repoName={sessionProps.repoName}
   122						branchName={sessionProps.branchName}
   123						snapshotId={sessionProps.snapshotId}
   124						startedAt={sessionProps.startedAt}
   125						concurrentUsers={sessionProps.concurrentUsers}
   126						isModal={sessionProps.isModal}
   127						isMigrating={sessionProps.isMigrating}
   128						canSnapshot={sessionProps.canSnapshot}
   129						isSnapshotting={sessionProps.isSnapshotting}
   130						onSnapshot={sessionProps.onSnapshot}
   131						repoId={sessionProps.repoId}
   132						configurationId={sessionProps.configurationId}
   133						autoStartOutput={sessionProps.autoStartOutput}
   134						sendRunAutoStart={sessionProps.sendRunAutoStart}
   135					/>
   136				);
   137			}
   138	
   139			// Environment panel
   140			if (mode.type === "environment" && sessionProps?.sessionId) {
   141				return (
   142					<EnvironmentPanel
   143						sessionId={sessionProps.sessionId}
   144						configurationId={sessionProps.configurationId}
   145						repoId={sessionProps.repoId}
   146					/>
   147				);
   148			}
   149	
   150			// Git panel
   151			if (mode.type === "git" && sessionProps) {
   152				return (
   153					<GitPanel
   154						panelMode={mode}
   155						sessionId={sessionProps.sessionId}
   156						activityTick={sessionProps.activityTick}
   157						gitState={sessionProps.gitState ?? null}
   158						gitResult={sessionProps.gitResult ?? null}
   159						sendGetGitStatus={sessionProps.sendGetGitStatus}
   160						sendGitCreateBranch={sessionProps.sendGitCreateBranch}
   161						sendGitCommit={sessionProps.sendGitCommit}
   162						sendGitPush={sessionProps.sendGitPush}
   163						sendGitCreatePr={sessionProps.sendGitCreatePr}
   164						clearGitResult={sessionProps.clearGitResult}
   165					/>
   166				);
   167			}
   168	
   169			// Terminal panel
   170			if (mode.type === "terminal" && sessionProps?.sessionId) {
   171				return <TerminalPanel sessionId={sessionProps.sessionId} />;
   172			}
   173	
   174			// Services panel
   175			if (mode.type === "services" && sessionProps?.sessionId) {
   176				return <ServicesPanel sessionId={sessionProps.sessionId} previewUrl={previewUrl} />;
   177			}
   178	
   179			// VS Code panel
   180			if (mode.type === "vscode" && sessionProps?.sessionId) {
   181				return <VscodePanel sessionId={sessionProps.sessionId} />;
   182			}
   183	
   184			// Artifacts panel
   185			if (
   186				(mode.type === "artifacts" || mode.type === "file" || mode.type === "gallery") &&
   187				sessionProps?.sessionId
   188			) {
   189				return (
   190					<ArtifactsPanel
   191						sessionId={sessionProps.sessionId}
   192						activityTick={sessionProps.activityTick ?? 0}
   193					/>
   194				);
   195			}
   196	
   197			// Investigation panel
   198			if (mode.type === "investigation" && runId) {
   199				return <InvestigationPanel runId={runId} />;
   200			}
   201	
   202			// URL preview
   203			if (mode.type === "url") {
   204				return <PreviewPanel url={mode.url || previewUrl || null} className="h-full" />;
   205			}
   206	
   207			return null;
   208		})();
   209	
   210		return (
   211			<AnimatePresence mode="wait">
   212				<motion.div
   213					key={mode.type}
   214					initial={{ opacity: 0, y: 4 }}
   215					animate={{ opacity: 1, y: 0 }}
   216					exit={{ opacity: 0, y: -4 }}
   217					transition={{ duration: 0.15 }}
   218					className="h-full w-full"
   219				>
   220					{panelContent}
   221				</motion.div>
   222			</AnimatePresence>
   223		);
   224	}
```

### Panel Mode Store + Persisted Layout State
File: `apps/web/src/stores/preview-panel.ts`
Lines: 1-170

```text
     1	import type { VerificationFile } from "@proliferate/shared";
     2	import { create } from "zustand";
     3	import { persist } from "zustand/middleware";
     4	
     5	export type PreviewMode =
     6		| { type: "none" }
     7		| { type: "url"; url: string | null }
     8		| { type: "file"; file: VerificationFile }
     9		| { type: "gallery"; files: VerificationFile[] }
    10		| { type: "settings"; tab?: "info" | "snapshots" | "auto-start" }
    11		| { type: "git"; tab?: "git" | "changes" }
    12		| { type: "terminal" }
    13		| { type: "vscode" }
    14		| { type: "artifacts" }
    15		| { type: "services" }
    16		| { type: "environment" }
    17		| { type: "investigation" };
    18	
    19	// Mobile view state - on mobile we either show chat or preview (full screen)
    20	export type MobileView = "chat" | "preview";
    21	
    22	interface PreviewPanelState {
    23		mode: PreviewMode;
    24		mobileView: MobileView;
    25		pinnedTabs: string[];
    26		panelSizes: number[];
    27		missingEnvKeyCount: number;
    28	
    29		// Actions
    30		openUrl: (url: string) => void;
    31		openFile: (file: VerificationFile) => void;
    32		openGallery: (files: VerificationFile[]) => void;
    33		close: () => void;
    34		closePanel: () => void;
    35	
    36		// Toggle helpers (for header buttons — toggles open/close)
    37		toggleUrlPreview: (url: string | null) => void;
    38		togglePanel: (
    39			type:
    40				| "settings"
    41				| "git"
    42				| "terminal"
    43				| "vscode"
    44				| "artifacts"
    45				| "services"
    46				| "environment"
    47				| "investigation",
    48		) => void;
    49	
    50		// Pin/unpin tabs in header
    51		pinTab: (type: string) => void;
    52		unpinTab: (type: string) => void;
    53	
    54		// Panel sizes (persisted)
    55		setPanelSizes: (sizes: number[]) => void;
    56	
    57		// Missing env key count
    58		setMissingEnvKeyCount: (count: number) => void;
    59	
    60		// Mobile view toggle
    61		setMobileView: (view: MobileView) => void;
    62		toggleMobileView: () => void;
    63	}
    64	
    65	const DEFAULT_MODE: PreviewMode = { type: "none" };
    66	const NONE_MODE: PreviewMode = { type: "none" };
    67	
    68	export const usePreviewPanelStore = create<PreviewPanelState>()(
    69		persist(
    70			(set, get) => ({
    71				mode: DEFAULT_MODE,
    72				mobileView: "chat",
    73				pinnedTabs: ["url", "vscode"],
    74				panelSizes: [35, 65],
    75				missingEnvKeyCount: 0,
    76	
    77				openUrl: (url: string) => set({ mode: { type: "url", url } }),
    78	
    79				openFile: (file: VerificationFile) => set({ mode: { type: "file", file } }),
    80	
    81				openGallery: (files: VerificationFile[]) => set({ mode: { type: "gallery", files } }),
    82	
    83				close: () => set({ mode: DEFAULT_MODE, mobileView: "chat" }),
    84	
    85				// Close panel to empty state (used by PanelShell close button)
    86				closePanel: () => set({ mode: NONE_MODE }),
    87	
    88				// Toggle URL preview — switches between url and none
    89				toggleUrlPreview: (url: string | null) => {
    90					const { mode } = get();
    91					if (mode.type === "url") {
    92						set({ mode: NONE_MODE });
    93					} else {
    94						set({ mode: { type: "url", url } });
    95					}
    96				},
    97	
    98				// Switch panel view — clicking active tab closes to none
    99				togglePanel: (
   100					type:
   101						| "settings"
   102						| "git"
   103						| "terminal"
   104						| "vscode"
   105						| "artifacts"
   106						| "services"
   107						| "environment"
   108						| "investigation",
   109				) => {
   110					const { mode } = get();
   111					if (mode.type === type) {
   112						set({ mode: NONE_MODE });
   113					} else {
   114						set({ mode: { type } });
   115					}
   116				},
   117	
   118				pinTab: (type) =>
   119					set((state) => ({
   120						pinnedTabs: state.pinnedTabs.includes(type)
   121							? state.pinnedTabs
   122							: [...state.pinnedTabs, type],
   123					})),
   124	
   125				unpinTab: (type) =>
   126					set((state) => ({
   127						pinnedTabs: state.pinnedTabs.filter((t) => t !== type),
   128					})),
   129	
   130				setPanelSizes: (sizes: number[]) => set({ panelSizes: sizes }),
   131	
   132				setMissingEnvKeyCount: (count: number) => set({ missingEnvKeyCount: count }),
   133	
   134				setMobileView: (view: MobileView) => set({ mobileView: view }),
   135	
   136				toggleMobileView: () => {
   137					const { mobileView } = get();
   138					set({ mobileView: mobileView === "chat" ? "preview" : "chat" });
   139				},
   140			}),
   141			{
   142				name: "preview-panel-storage",
   143				partialize: (state) => ({
   144					pinnedTabs: state.pinnedTabs,
   145					panelSizes: state.panelSizes,
   146				}),
   147			},
   148		),
   149	);
   150	
   151	// Helper to check if panel is open
   152	export const isPanelOpen = (mode: PreviewMode) => mode.type !== "none";
```

### Resizable Handle Implementation
File: `apps/web/src/components/ui/resizable.tsx`
Lines: 1-120

```text
     1	"use client";
     2	
     3	import { cn } from "@/lib/utils";
     4	import { GripVertical } from "lucide-react";
     5	import {
     6		Group,
     7		type GroupProps,
     8		Panel,
     9		Separator,
    10		type SeparatorProps,
    11	} from "react-resizable-panels";
    12	
    13	function ResizablePanelGroup({ className, ...props }: GroupProps) {
    14		return (
    15			<Group
    16				className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)}
    17				{...props}
    18			/>
    19		);
    20	}
    21	
    22	const ResizablePanel = Panel;
    23	
    24	function ResizableHandle({
    25		withHandle,
    26		className,
    27		...props
    28	}: SeparatorProps & {
    29		withHandle?: boolean;
    30	}) {
    31		return (
    32			<Separator
    33				className={cn(
    34					"relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0 [&[data-orientation=vertical]>div]:rotate-90",
    35					className,
    36				)}
    37				{...props}
    38			>
    39				{withHandle && (
    40					<div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
    41						<GripVertical className="h-2.5 w-2.5" />
    42					</div>
    43				)}
    44			</Separator>
    45		);
    46	}
    47	
    48	export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
```

### Shared Panel Chrome
File: `apps/web/src/components/coding-session/panel-shell.tsx`
Lines: 1-120

```text
     1	"use client";
     2	
     3	import { Button } from "@/components/ui/button";
     4	import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
     5	import { cn } from "@/lib/utils";
     6	import { usePreviewPanelStore } from "@/stores/preview-panel";
     7	import { X } from "lucide-react";
     8	
     9	interface PanelShellProps {
    10		title: string;
    11		icon?: React.ReactNode;
    12		/** Toolbar actions rendered before the close button */
    13		actions?: React.ReactNode;
    14		/** Disable default body padding (for edge-to-edge iframes, terminals) */
    15		noPadding?: boolean;
    16		children: React.ReactNode;
    17	}
    18	
    19	export function PanelShell({ title, icon, actions, noPadding, children }: PanelShellProps) {
    20		const closePanel = usePreviewPanelStore((s) => s.closePanel);
    21	
    22		return (
    23			<TooltipProvider delayDuration={150}>
    24				<div className="flex flex-col h-full w-full bg-background overflow-hidden">
    25					{/* Standardized header */}
    26					<div className="h-10 px-3 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
    27						<div className="flex items-center gap-2 min-w-0">
    28							{icon && (
    29								<span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
    30							)}
    31							<span className="text-sm font-medium truncate">{title}</span>
    32						</div>
    33						<div className="flex items-center gap-1 shrink-0">
    34							{actions}
    35							{actions && <div className="w-px h-4 bg-border mx-0.5" />}
    36							<Tooltip>
    37								<TooltipTrigger asChild>
    38									<Button variant="ghost" size="icon" className="h-7 w-7" onClick={closePanel}>
    39										<X className="h-4 w-4" />
    40									</Button>
    41								</TooltipTrigger>
    42								<TooltipContent>Close panel</TooltipContent>
    43							</Tooltip>
    44						</div>
    45					</div>
    46	
    47					{/* Content */}
    48					<div className={cn("flex-1 min-h-0 overflow-hidden", !noPadding && "overflow-y-auto")}>
    49						{children}
    50					</div>
    51				</div>
    52			</TooltipProvider>
    53		);
    54	}
```

### VS Code Startup UI + Polling Logic
File: `apps/web/src/components/coding-session/vscode-panel.tsx`
Lines: 1-220

```text
     1	"use client";
     2	
     3	import { Button } from "@/components/ui/button";
     4	import { Progress } from "@/components/ui/progress";
     5	import { GATEWAY_URL } from "@/lib/gateway";
     6	import { useCallback, useEffect, useRef, useState } from "react";
     7	import { PanelShell } from "./panel-shell";
     8	import { useWsToken } from "./runtime/use-ws-token";
     9	
    10	interface VscodePanelProps {
    11		sessionId: string;
    12	}
    13	
    14	function devtoolsUrl(sessionId: string, token: string, path: string): string {
    15		return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
    16	}
    17	
    18	function vscodeUrl(sessionId: string, token: string): string {
    19		return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/vscode/`;
    20	}
    21	
    22	type PanelStatus = "starting" | "ready" | "error";
    23	
    24	const MAX_POLL_ATTEMPTS = 30;
    25	
    26	export function VscodePanel({ sessionId }: VscodePanelProps) {
    27		const { token } = useWsToken();
    28		const [status, setStatus] = useState<PanelStatus>("starting");
    29		const [pollProgress, setPollProgress] = useState(0);
    30		const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    31	
    32		const startVscodeServer = useCallback(async () => {
    33			if (!token || !GATEWAY_URL) return;
    34	
    35			if (pollingRef.current) {
    36				clearInterval(pollingRef.current);
    37				pollingRef.current = null;
    38			}
    39	
    40			setStatus("starting");
    41			setPollProgress(0);
    42	
    43			try {
    44				// Check if openvscode-server is already running
    45				const servicesRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
    46				if (servicesRes.ok) {
    47					const data = await servicesRes.json();
    48					const vscodeService = data.services?.find(
    49						(s: { name: string; status: string }) =>
    50							s.name === "openvscode-server" && s.status === "running",
    51					);
    52					if (vscodeService) {
    53						setStatus("ready");
    54						return;
    55					}
    56				}
    57	
    58				// Start openvscode-server via service manager
    59				const basePath = `/proxy/${sessionId}/${token}/devtools/vscode`;
    60				const startRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
    61					method: "POST",
    62					headers: { "Content-Type": "application/json" },
    63					body: JSON.stringify({
    64						name: "openvscode-server",
    65						command: `openvscode-server --port 3901 --without-connection-token --host 127.0.0.1 --server-base-path=${basePath} --default-folder /home/user/workspace`,
    66					}),
    67				});
    68	
    69				if (!startRes.ok) {
    70					const err = await startRes.json().catch(() => ({ error: "Unknown error" }));
    71					throw new Error(err.error || `HTTP ${startRes.status}`);
    72				}
    73	
    74				// Poll until ready with progress tracking
    75				let attempts = 0;
    76				pollingRef.current = setInterval(async () => {
    77					attempts++;
    78					setPollProgress(Math.min((attempts / MAX_POLL_ATTEMPTS) * 100, 100));
    79	
    80					if (attempts > MAX_POLL_ATTEMPTS) {
    81						if (pollingRef.current) {
    82							clearInterval(pollingRef.current);
    83							pollingRef.current = null;
    84						}
    85						setStatus("error");
    86						return;
    87					}
    88					try {
    89						const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
    90						if (res.ok) {
    91							const data = await res.json();
    92							const svc = data.services?.find(
    93								(s: { name: string; status: string }) =>
    94									s.name === "openvscode-server" && s.status === "running",
    95							);
    96							if (svc) {
    97								if (pollingRef.current) {
    98									clearInterval(pollingRef.current);
    99									pollingRef.current = null;
   100								}
   101								setStatus("ready");
   102							}
   103						}
   104					} catch {
   105						// Keep polling
   106					}
   107				}, 1000);
   108			} catch {
   109				setStatus("error");
   110			}
   111		}, [sessionId, token]);
   112	
   113		useEffect(() => {
   114			startVscodeServer();
   115	
   116			return () => {
   117				if (pollingRef.current) {
   118					clearInterval(pollingRef.current);
   119					pollingRef.current = null;
   120				}
   121			};
   122		}, [startVscodeServer]);
   123	
   124		const iframeSrc = token ? vscodeUrl(sessionId, token) : "";
   125	
   126		return (
   127			<PanelShell title="Code Editor" noPadding>
   128				<div className="flex-1 min-h-0 h-full">
   129					{status === "starting" && (
   130						<div className="flex flex-col items-center justify-center h-full gap-4 px-8">
   131							<p className="text-sm text-muted-foreground">Starting VS Code...</p>
   132							<Progress value={pollProgress} className="w-full max-w-xs" />
   133							<p className="text-[11px] text-muted-foreground/60">
   134								{pollProgress < 30
   135									? "Launching server"
   136									: pollProgress < 70
   137										? "Waiting for response"
   138										: "Almost ready"}
   139							</p>
   140						</div>
   141					)}
   142					{status === "error" && (
   143						<div className="flex flex-col items-center justify-center h-full gap-3">
   144							<p className="text-sm text-destructive">Failed to start VS Code server</p>
   145							<Button variant="outline" size="sm" onClick={startVscodeServer}>
   146								Retry
   147							</Button>
   148						</div>
   149					)}
   150					{status === "ready" && iframeSrc && (
   151						<iframe
   152							src={iframeSrc}
   153							title="VS Code"
   154							className="w-full h-full border-0"
   155							sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
   156						/>
   157					)}
   158				</div>
   159			</PanelShell>
   160		);
   161	}
```

### Services Panel UX + Actions
File: `apps/web/src/components/coding-session/services-panel.tsx`
Lines: 1-340

```text
     1	"use client";
     2	
     3	import { Button } from "@/components/ui/button";
     4	import { Input } from "@/components/ui/input";
     5	import { StatusDot } from "@/components/ui/status-dot";
     6	import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
     7	import { usePreviewPanelStore } from "@/stores/preview-panel";
     8	import { formatDistanceToNow } from "date-fns";
     9	import {
    10		ChevronLeft,
    11		ExternalLink,
    12		Loader2,
    13		Play,
    14		RefreshCw,
    15		RotateCw,
    16		Square,
    17	} from "lucide-react";
    18	import dynamic from "next/dynamic";
    19	import { useState } from "react";
    20	import { toast } from "sonner";
    21	import { PanelShell } from "./panel-shell";
    22	import type { ServiceInfo } from "./runtime/use-services";
    23	import {
    24		useExposePort,
    25		useRestartService,
    26		useServiceList,
    27		useStopService,
    28	} from "./runtime/use-services";
    29	
    30	const ServiceLogViewer = dynamic(
    31		() => import("./service-log-viewer").then((m) => m.ServiceLogViewer),
    32		{ ssr: false },
    33	);
    34	
    35	// ---------------------------------------------------------------------------
    36	// Helpers
    37	// ---------------------------------------------------------------------------
    38	
    39	function serviceStatusToDot(status: ServiceInfo["status"]): "active" | "stopped" | "error" {
    40		if (status === "running") return "active";
    41		if (status === "error") return "error";
    42		return "stopped";
    43	}
    44	
    45	function formatUptime(service: ServiceInfo): string {
    46		if (service.status === "running" && service.startedAt) {
    47			const ts = service.startedAt < 1e12 ? service.startedAt * 1000 : service.startedAt;
    48			return `Uptime: ${formatDistanceToNow(new Date(ts))}`;
    49		}
    50		if (service.status === "error" && service.startedAt) {
    51			const ts = service.startedAt < 1e12 ? service.startedAt * 1000 : service.startedAt;
    52			return `Crashed ${formatDistanceToNow(new Date(ts), { addSuffix: true })}`;
    53		}
    54		return "Stopped";
    55	}
    56	
    57	// ---------------------------------------------------------------------------
    58	// ServiceRow
    59	// ---------------------------------------------------------------------------
    60	
    61	function ServiceRow({
    62		service,
    63		isActionLoading,
    64		exposedPort,
    65		previewUrl,
    66		onViewLogs,
    67		onStop,
    68		onRestart,
    69	}: {
    70		service: ServiceInfo;
    71		isActionLoading: boolean;
    72		exposedPort: number | null;
    73		previewUrl?: string | null;
    74		onViewLogs: () => void;
    75		onStop: () => void;
    76		onRestart: () => void;
    77	}) {
    78		const openUrl = usePreviewPanelStore((s) => s.openUrl);
    79	
    80		return (
    81			<div className="px-3 py-2.5 hover:bg-muted/50 transition-colors">
    82				{/* Row 1: status dot + name + uptime + actions */}
    83				<div className="flex items-center gap-2">
    84					<StatusDot status={serviceStatusToDot(service.status)} size="sm" />
    85					<Button
    86						variant="ghost"
    87						size="sm"
    88						className="h-auto p-0 text-sm font-medium justify-start min-w-0 truncate hover:underline hover:bg-transparent"
    89						onClick={onViewLogs}
    90					>
    91						{service.name}
    92					</Button>
    93					<span className="text-xs text-muted-foreground ml-auto shrink-0">
    94						{formatUptime(service)}
    95					</span>
    96					<div className="flex items-center gap-0.5 shrink-0">
    97						{isActionLoading ? (
    98							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
    99						) : (
   100							<>
   101								{service.status === "running" ? (
   102									<Tooltip>
   103										<TooltipTrigger asChild>
   104											<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onStop}>
   105												<Square className="h-3 w-3" />
   106											</Button>
   107										</TooltipTrigger>
   108										<TooltipContent>Stop</TooltipContent>
   109									</Tooltip>
   110								) : (
   111									<Tooltip>
   112										<TooltipTrigger asChild>
   113											<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRestart}>
   114												<Play className="h-3 w-3" />
   115											</Button>
   116										</TooltipTrigger>
   117										<TooltipContent>Start</TooltipContent>
   118									</Tooltip>
   119								)}
   120								<Tooltip>
   121									<TooltipTrigger asChild>
   122										<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRestart}>
   123											<RotateCw className="h-3 w-3" />
   124										</Button>
   125									</TooltipTrigger>
   126									<TooltipContent>Restart</TooltipContent>
   127								</Tooltip>
   128							</>
   129						)}
   130					</div>
   131				</div>
   132				{/* Row 2: command + port / preview link */}
   133				<div className="flex items-center gap-2 mt-0.5 pl-4">
   134					<span className="text-xs text-muted-foreground truncate">{service.command}</span>
   135					{exposedPort && previewUrl && service.status === "running" && (
   136						<>
   137							<span className="text-xs text-muted-foreground shrink-0">port {exposedPort}</span>
   138							<Button
   139								variant="ghost"
   140								size="sm"
   141								className="h-5 text-[11px] gap-1 px-1.5 text-muted-foreground hover:text-foreground shrink-0"
   142								onClick={() => openUrl(previewUrl)}
   143							>
   144								<ExternalLink className="h-3 w-3" />
   145								Preview
   146							</Button>
   147						</>
   148					)}
   149				</div>
   150			</div>
   151		);
   152	}
   153	
   154	// ---------------------------------------------------------------------------
   155	// ServicesPanel
   156	// ---------------------------------------------------------------------------
   157	
   158	interface ServicesPanelProps {
   159		sessionId: string;
   160		previewUrl?: string | null;
   161	}
   162	
   163	export function ServicesPanel({ sessionId, previewUrl }: ServicesPanelProps) {
   164		const { data, isLoading, error, refetch } = useServiceList(sessionId);
   165		const stopService = useStopService(sessionId);
   166		const restartService = useRestartService(sessionId);
   167		const exposePort = useExposePort(sessionId);
   168	
   169		const [selectedService, setSelectedService] = useState<string | null>(null);
   170		const [portInput, setPortInput] = useState("");
   171	
   172		const services = data?.services ?? [];
   173		const exposedPort = data?.exposedPort ?? null;
   174	
   175		const actionLoadingName = stopService.isPending
   176			? (stopService.variables as string | undefined)
   177			: restartService.isPending
   178				? (restartService.variables as Pick<ServiceInfo, "name" | "command" | "cwd"> | undefined)
   179						?.name
   180				: null;
   181	
   182		const handleStop = (name: string) => {
   183			stopService.mutate(name, {
   184				onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to stop service"),
   185			});
   186		};
   187	
   188		const handleRestart = (service: ServiceInfo) => {
   189			restartService.mutate(service, {
   190				onError: (err) =>
   191					toast.error(err instanceof Error ? err.message : "Failed to restart service"),
   192			});
   193		};
   194	
   195		const handleExpose = () => {
   196			const port = Number.parseInt(portInput, 10);
   197			if (Number.isNaN(port) || port < 1 || port > 65535) return;
   198			exposePort.mutate(port, {
   199				onSuccess: () => setPortInput(""),
   200				onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to expose port"),
   201			});
   202		};
   203	
   204		const panelIcon = selectedService ? (
   205			<>
   206				<Tooltip>
   207					<TooltipTrigger asChild>
   208						<Button
   209							variant="ghost"
   210							size="icon"
   211							className="h-7 w-7 shrink-0"
   212							onClick={() => setSelectedService(null)}
   213						>
   214							<ChevronLeft className="h-4 w-4" />
   215						</Button>
   216					</TooltipTrigger>
   217					<TooltipContent>Back to services</TooltipContent>
   218				</Tooltip>
   219				<StatusDot
   220					status={serviceStatusToDot(
   221						services.find((s) => s.name === selectedService)?.status ?? "stopped",
   222					)}
   223					size="sm"
   224				/>
   225			</>
   226		) : undefined;
   227	
   228		const panelActions = !selectedService ? (
   229			<Tooltip>
   230				<TooltipTrigger asChild>
   231					<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
   232						<RefreshCw className="h-3.5 w-3.5" />
   233					</Button>
   234				</TooltipTrigger>
   235				<TooltipContent>Refresh</TooltipContent>
   236			</Tooltip>
   237		) : undefined;
   238	
   239		const exposePortBar = !selectedService && (
   240			<div className="border-b shrink-0">
   241				<div className="flex items-center gap-2 px-3 py-2">
   242					<Input
   243						type="number"
   244						value={portInput}
   245						onChange={(e) => setPortInput(e.target.value)}
   246						placeholder={exposedPort ? `port ${exposedPort}` : "Port (e.g. 3000)"}
   247						className="h-7 text-xs flex-1"
   248						min={1}
   249						max={65535}
   250						onKeyDown={(e) => e.key === "Enter" && handleExpose()}
   251					/>
   252					<Button
   253						size="sm"
   254						className="h-7 text-xs"
   255						onClick={handleExpose}
   256						disabled={exposePort.isPending || !portInput}
   257					>
   258						{exposePort.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Expose"}
   259					</Button>
   260				</div>
   261			</div>
   262		);
   263	
   264		return (
   265			<PanelShell
   266				title={selectedService ? `${selectedService} logs` : "Services"}
   267				icon={panelIcon}
   268				actions={panelActions}
   269				noPadding
   270			>
   271				<div className="flex flex-col h-full">
   272					{/* Expose port bar — always visible at top when on list view */}
   273					{exposePortBar}
   274	
   275					{/* Content */}
   276					<div className="flex-1 min-h-0">
   277						{selectedService ? (
   278							<ServiceLogViewer sessionId={sessionId} serviceName={selectedService} />
   279						) : isLoading ? (
   280							<div className="flex items-center justify-center py-8">
   281								<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
   282							</div>
   283						) : error ? (
   284							<div className="px-3 py-4 text-sm text-destructive">
   285								{error instanceof Error ? error.message : "Failed to load services"}
   286							</div>
   287						) : services.length === 0 ? (
   288							<div className="px-3 py-8 text-center text-sm text-muted-foreground">
   289								No services running
   290							</div>
   291						) : (
   292							<div className="overflow-y-auto h-full divide-y divide-border/50">
   293								{services.map((svc) => (
   294									<ServiceRow
   295										key={svc.name}
   296										service={svc}
   297										isActionLoading={actionLoadingName === svc.name}
   298										exposedPort={exposedPort}
   299										previewUrl={previewUrl}
   300										onViewLogs={() => setSelectedService(svc.name)}
   301										onStop={() => handleStop(svc.name)}
   302										onRestart={() => handleRestart(svc)}
   303									/>
   304								))}
   305							</div>
   306						)}
   307					</div>
   308	
   309					{/* Footer — service count + exposed port info */}
   310					{!selectedService && services.length > 0 && (
   311						<div className="border-t shrink-0 px-3 py-1 text-xs text-muted-foreground">
   312							{services.length} service{services.length !== 1 ? "s" : ""}
   313							{exposedPort !== null && ` \u00B7 port ${exposedPort}`}
   314						</div>
   315					)}
   316				</div>
   317			</PanelShell>
   318		);
   319	}
```

### Services API Hooks
File: `apps/web/src/components/coding-session/runtime/use-services.ts`
Lines: 1-220

```text
     1	"use client";
     2	
     3	import { GATEWAY_URL } from "@/lib/gateway";
     4	import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
     5	import { type RefObject, useEffect } from "react";
     6	import type { Terminal } from "xterm";
     7	import { useWsToken } from "./use-ws-token";
     8	
     9	export interface ServiceInfo {
    10		name: string;
    11		command: string;
    12		cwd: string;
    13		pid: number;
    14		status: "running" | "stopped" | "error";
    15		startedAt: number;
    16		logFile: string;
    17	}
    18	
    19	interface ServiceListData {
    20		services: ServiceInfo[];
    21		exposedPort: number | null;
    22	}
    23	
    24	function devtoolsUrl(sessionId: string, token: string, path: string): string {
    25		return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
    26	}
    27	
    28	/**
    29	 * Fetch the service list via TanStack Query.
    30	 */
    31	export function useServiceList(sessionId: string) {
    32		const { token } = useWsToken();
    33	
    34		return useQuery<ServiceListData>({
    35			queryKey: ["services", sessionId],
    36			queryFn: async () => {
    37				if (!token || !GATEWAY_URL) throw new Error("Not ready");
    38				const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
    39				if (!res.ok) throw new Error(`HTTP ${res.status}`);
    40				return res.json();
    41			},
    42			enabled: !!token && !!GATEWAY_URL,
    43			refetchInterval: 5000,
    44		});
    45	}
    46	
    47	/**
    48	 * Mutation: stop a service by name.
    49	 */
    50	export function useStopService(sessionId: string) {
    51		const { token } = useWsToken();
    52		const qc = useQueryClient();
    53	
    54		return useMutation<void, Error, string>({
    55			mutationFn: async (name: string) => {
    56				if (!token || !GATEWAY_URL) throw new Error("Not ready");
    57				const res = await fetch(
    58					devtoolsUrl(sessionId, token, `/api/services/${encodeURIComponent(name)}`),
    59					{ method: "DELETE" },
    60				);
    61				if (!res.ok) throw new Error(`HTTP ${res.status}`);
    62			},
    63			onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
    64		});
    65	}
    66	
    67	/**
    68	 * Mutation: restart (or start) a service.
    69	 */
    70	export function useRestartService(sessionId: string) {
    71		const { token } = useWsToken();
    72		const qc = useQueryClient();
    73	
    74		return useMutation<void, Error, Pick<ServiceInfo, "name" | "command" | "cwd">>({
    75			mutationFn: async (service) => {
    76				if (!token || !GATEWAY_URL) throw new Error("Not ready");
    77				const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
    78					method: "POST",
    79					headers: { "Content-Type": "application/json" },
    80					body: JSON.stringify({
    81						name: service.name,
    82						command: service.command,
    83						cwd: service.cwd,
    84					}),
    85				});
    86				if (!res.ok) throw new Error(`HTTP ${res.status}`);
    87			},
    88			onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
    89		});
    90	}
    91	
    92	/**
    93	 * Mutation: expose a port.
    94	 */
    95	export function useExposePort(sessionId: string) {
    96		const { token } = useWsToken();
    97		const qc = useQueryClient();
    98	
    99		return useMutation<void, Error, number>({
   100			mutationFn: async (port: number) => {
   101				if (!token || !GATEWAY_URL) throw new Error("Not ready");
   102				const res = await fetch(devtoolsUrl(sessionId, token, "/api/expose"), {
   103					method: "POST",
   104					headers: { "Content-Type": "application/json" },
   105					body: JSON.stringify({ port }),
   106				});
   107				if (!res.ok) throw new Error(`HTTP ${res.status}`);
   108			},
   109			onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
   110		});
   111	}
   112	
   113	/**
   114	 * SSE log streaming into an xterm Terminal ref.
   115	 */
   116	export function useServiceLogs(
   117		sessionId: string,
   118		serviceName: string,
   119		termRef: RefObject<Terminal | null>,
   120	): void {
   121		const { token } = useWsToken();
   122	
   123		useEffect(() => {
   124			if (!serviceName || !token || !GATEWAY_URL) return;
   125	
   126			const url = devtoolsUrl(sessionId, token, `/api/logs/${encodeURIComponent(serviceName)}`);
   127			const es = new EventSource(url);
   128	
   129			es.onmessage = (event) => {
   130				try {
   131					const data = JSON.parse(event.data);
   132					const term = termRef.current;
   133					if (!term) return;
   134	
   135					if (data.type === "initial") {
   136						term.clear();
   137						term.write(data.content);
   138					} else if (data.type === "append") {
   139						term.write(data.content);
   140					}
   141				} catch {
   142					// Ignore parse errors
   143				}
   144			};
   145	
   146			return () => {
   147				es.close();
   148			};
   149		}, [sessionId, serviceName, token, termRef]);
   150	}
```

### Gateway Devtools MCP Proxy
File: `apps/gateway/src/api/proxy/devtools.ts`
Lines: 1-220

```text
     1	/**
     2	 * Devtools Proxy Route
     3	 *
     4	 * /proxy/:proliferateSessionId/:token/devtools/mcp[/*]
     5	 *
     6	 * Proxies devtools requests through Gateway to sandbox-mcp API.
     7	 * Auth is handled via token in the URL path (same as opencode proxy).
     8	 * Injects HMAC-derived Bearer token for sandbox-mcp authentication.
     9	 */
    10	
    11	import type { ServerResponse } from "node:http";
    12	import { createLogger } from "@proliferate/logger";
    13	import type { Request, Response } from "express";
    14	import { Router, type Router as RouterType } from "express";
    15	import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
    16	import type { HubManager } from "../../hub";
    17	import type { GatewayEnv } from "../../lib/env";
    18	import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
    19	import { ApiError, createEnsureSessionReady, createRequireProxyAuth } from "../../middleware";
    20	
    21	const logger = createLogger({ service: "gateway" }).child({ module: "devtools-proxy" });
    22	
    23	export function createDevtoolsProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
    24		const router: RouterType = Router();
    25		const requireProxyAuth = createRequireProxyAuth(env);
    26		const ensureSessionReady = createEnsureSessionReady(hubManager);
    27	
    28		const proxy = createProxyMiddleware<Request, Response>({
    29			router: (req: Request) => {
    30				const previewUrl = req.hub?.getPreviewUrl();
    31				if (!previewUrl) {
    32					logger.warn(
    33						{ sessionId: (req as Request).proliferateSessionId },
    34						"No preview URL for devtools proxy",
    35					);
    36					throw new ApiError(503, "Sandbox not ready");
    37				}
    38				return previewUrl;
    39			},
    40			changeOrigin: true,
    41			timeout: 15_000, // 15s upstream socket timeout
    42			proxyTimeout: 15_000,
    43			pathRewrite: (path: string) => {
    44				// Express already strips the matched route prefix, so path is just the tail
    45				// (e.g., "/api/git/repos"). Prepend the Caddy internal route.
    46				return `/_proliferate/mcp${path || "/"}`;
    47			},
    48			on: {
    49				proxyReq: (proxyReq, req) => {
    50					// Set headers before fixRequestBody — it may flush headers on POST
    51					proxyReq.removeHeader("origin");
    52					proxyReq.removeHeader("referer");
    53					const sessionId = (req as Request).proliferateSessionId;
    54					if (sessionId) {
    55						const token = deriveSandboxMcpToken(env.serviceToken, sessionId);
    56						proxyReq.setHeader("Authorization", `Bearer ${token}`);
    57					}
    58					fixRequestBody(proxyReq, req as Request);
    59				},
    60				proxyRes: (proxyRes, req) => {
    61					if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
    62						logger.warn(
    63							{ status: proxyRes.statusCode, path: (req as Request).originalUrl },
    64							"Devtools proxy upstream error",
    65						);
    66					}
    67				},
    68				error: (err: Error, _req, res) => {
    69					logger.error({ err }, "Devtools proxy error");
    70					if ("headersSent" in res && !res.headersSent && "writeHead" in res) {
    71						(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
    72						(res as ServerResponse).end(
    73							JSON.stringify({ error: "Proxy error", message: err.message }),
    74						);
    75					}
    76				},
    77			},
    78		});
    79	
    80		// Match both /devtools/mcp and /devtools/mcp/*
    81		router.use(
    82			"/:proliferateSessionId/:token/devtools/mcp",
    83			requireProxyAuth,
    84			ensureSessionReady,
    85			proxy,
    86		);
    87	
    88		return router;
    89	}
```


---

## Appendix Trim Notice

This document was reduced to satisfy the `~2k lines` cap while preserving:
- goals and intended behavior per panel
- current behavior and breakage analysis
- acceptance criteria and priority order
- key architecture/code-path context for advisor work

Large raw dumps from deeper gateway/sandbox/component sections were intentionally trimmed.
Use the source files referenced in `## 8) Key Files Referenced` for complete full-file context.
