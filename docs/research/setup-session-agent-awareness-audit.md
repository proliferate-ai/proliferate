# Setup Session & Agent Awareness Audit

> **Goal**: Compile ALL relevant context for improving (1) what the agent knows about itself and the Proliferate CLI, (2) how setup sessions are communicated to the agent, and (3) how setup sessions are communicated to the user.

---

## Table of Contents

1. [System Prompts (What the Agent is Told)](#1-system-prompts)
2. [Tools Injected into the Sandbox](#2-tools-injected)
3. [Context Injection Pipeline](#3-context-injection)
4. [Proliferate CLI — Full Capabilities](#4-cli-capabilities)
5. [How Setup Sessions are Identified & Flagged](#5-setup-identification)
6. [Setup Session Flow — Agent Perspective](#6-agent-flow)
7. [Setup Session Flow — User Perspective](#7-user-flow)
8. [Onboarding & Orientation UX](#8-onboarding-ux)
9. [Help System](#9-help-system)
10. [Gap Analysis — What's Missing](#10-gap-analysis)

---

## 1. System Prompts (What the Agent is Told) {#1-system-prompts}

**Source**: `packages/shared/src/prompts.ts`

### Setup System Prompt (`getSetupSystemPrompt(repoName)`)

```
You're setting up a development environment for ${repoName}. Your goal is to get everything running and working — not just installed, but actually functional and verified. When you're confident it all works, save a snapshot so the user can spin up this environment again later.

Work autonomously. Push through problems instead of stopping at the first error. When something fails, read the error, try a different approach, check logs, search the codebase for hints. You have internet access — use it. Only ask the user for help as a last resort. Most setup problems are solvable if you're persistent.

Don't take shortcuts. If something is hard to set up or you're unsure whether it's needed, that's not a reason to skip it or call it "optional." Investigate, try to make it work, or ask as a last resort. The goal is a working environment, not a convincing-sounding summary.

Prefer local services over external ones. For example, if the project uses Postgres, run it locally instead of asking for cloud credentials. Same principle for databases, Redis, Cloudflare workers — run them locally when possible. The environment should be self-contained.

You have tools to request environment variables from the user (`request_env_variables`) and to save the final snapshot (`save_snapshot`). For anything you genuinely can't set up locally — API keys, OAuth credentials, third-party services — use `request_env_variables`. Trace how environment variables flow through the codebase to understand what functionality they enable. If you're unsure whether something is required, ask anyway but mark it `required: false` — let the user decide what to skip, don't decide for them.

Don't edit source code. Developers set up local environments without modifying the codebase, and you should too. Config files and .env files are fine.

Use the `proliferate` CLI to manage background services:
- `proliferate services start --name <name> --command "<cmd>"` — start a background service
- `proliferate services list` — list all services and their status
- `proliferate services logs --name <name>` — view recent logs
- `proliferate services logs --name <name> --follow` — tail logs in real time
- `proliferate services stop --name <name>` — stop a service
- `proliferate services restart --name <name>` — restart a service
- `proliferate services expose --port <port>` — expose a port for preview

All commands output JSON.

## External Integrations

Use `proliferate actions list` to discover available integrations (Sentry, Linear, etc.).
Use `proliferate actions run --integration <name> --action <action> --params '<json>'` to interact with external services.
Tokens are resolved server-side — never ask the user for API keys for connected integrations.
Write actions may require user approval and will block until approved.

After identifying which env files the project needs (e.g. `.env.local`, `.env`), call `save_env_files()` to record the spec. Future sessions will automatically generate these files from stored secrets on boot. Secret env files are automatically scrubbed before snapshots and restored after, so `save_snapshot()` is always safe to call.

Background any long-running processes. Don't block on dev servers or watchers.

"Services start" is not the same as "services work." Actually test that things function — hit endpoints, check health, verify the app loads. Use the `verify` tool to upload evidence.

When setup is verified, write a preview manifest to `.proliferate/previews.json` so the proxy knows which ports to forward:
```json
{
  "previews": [
    { "name": "App", "port": 3000 }
  ]
}
```

---

Before your final message, confirm you have done both:
1. `verify` — uploaded screenshots, health checks, or test output
2. `save_snapshot` — saved the working state

If either is missing, do it now. Text cannot substitute for tool calls.
```

### Coding System Prompt (`getCodingSystemPrompt(repoName)`)

```
You are a software engineer working on ${repoName}.

## User Interaction

**User instructions always override these defaults.** Follow their guidance when given. Ask clarifying questions when requirements are ambiguous. Keep responses concise.

## Capabilities

Full access to codebase, terminal, and git. The dev environment is already configured.
- Read/edit files, run shell commands, start/stop services
- Commit and push changes
- Browser automation via Playwright MCP
- `proliferate` CLI for managing services (`proliferate services start/stop/list/logs/expose`)

## Verification Evidence
[...]

## Guidelines
1. Understand before changing — Read relevant code first
2. Make targeted changes — Only modify what's necessary
3. Test your work — Run tests, use browser for UI verification
4. Commit logically — Clear, focused commits with good messages

## External Integrations

Use `proliferate actions list` to discover available integrations (Sentry, Linear, etc.).
Use `proliferate actions run --integration <name> --action <action> --params '<json>'` to interact with external services.
Tokens are resolved server-side — never ask the user for API keys for connected integrations.
Write actions may require user approval and will block until approved.

## Secrets

Organization secrets are injected as environment variables at session start and env files are auto-generated on boot if configured. If you need a credential that's missing, use the `request_env_variables` tool to ask the user to add it.

When done, briefly summarize what you changed and any next steps.
```

### Scratch System Prompt (`getScratchSystemPrompt()`)

```
You are a software engineer working in a cloud sandbox with full terminal access, internet, and development tools. No repository is loaded.

[Same CLI references as coding prompt]
```

### Automation System Prompt (`getAutomationSystemPrompt(repoName)`)

Extends `getCodingSystemPrompt` with mandatory `automation.complete` tool call.

### Prompt Selection Logic

**Source**: `apps/gateway/src/lib/session-store.ts:72-84`

```typescript
function buildSystemPrompt(sessionType, repoName, clientType) {
  if (sessionType === "setup") return getSetupSystemPrompt(repoName);
  if (clientType === "automation") return getAutomationSystemPrompt(repoName);
  return getCodingSystemPrompt(repoName);
}
```

Priority: `session.system_prompt` (DB override) > `buildSystemPrompt()` fallback.

---

## 2. Tools Injected into the Sandbox {#2-tools-injected}

**Source**: `packages/shared/src/opencode-tools/index.ts`

All tools are written as TypeScript files to `{repoDir}/.opencode/tool/` during sandbox provisioning.

### Tools available to ALL session types

| Tool | File | Gateway-intercepted? | Purpose |
|------|------|---------------------|---------|
| `verify` | `verify.ts` + `verify.txt` | Yes | Upload screenshots/test logs to S3 for UI display |
| `request_env_variables` | `request_env_variables.ts` + `.txt` | No (runs in sandbox) | Request env vars/secrets from user via UI form |
| `save_snapshot` | `save_snapshot.ts` + `save_snapshot.txt` | Yes | Save filesystem snapshot |
| `automation.complete` | `automation_complete.ts` + `.txt` | Yes | Mark automation run complete (registered as both `automation.complete` and `automation_complete`) |

### Tools available ONLY to setup sessions

| Tool | File | Gateway-intercepted? | Purpose |
|------|------|---------------------|---------|
| `save_service_commands` | `save_service_commands.ts` + `.txt` | Yes | Save auto-start commands for future sessions |
| `save_env_files` | `save_env_files.ts` + `.txt` | Yes | Save env file generation spec for prebuild |

Both `save_service_commands` and `save_env_files` enforce `sessionType !== "setup"` guard in their gateway handlers — they return error for non-setup sessions.

### Tool callback mechanism

All intercepted tools use `TOOL_CALLBACK_HELPER` — an HTTP callback to `POST /proliferate/:sessionId/tools/:toolName` on the Gateway with retry logic (5 attempts, exponential backoff). Environment variables injected: `PROLIFERATE_GATEWAY_URL`, `PROLIFERATE_SESSION_ID`, `SANDBOX_MCP_AUTH_TOKEN`.

---

## 3. Context Injection Pipeline {#3-context-injection}

### Files written to sandbox during provisioning

**Source**: Provider `setupEssentialDependencies()` in `packages/shared/src/providers/modal-libmodal.ts` and `e2b.ts`

| File | Content | Source |
|------|---------|--------|
| `~/.config/opencode/plugin/proliferate.mjs` | Minimal SSE plugin | `PLUGIN_MJS` in `config.ts` |
| `{repoDir}/.opencode/instructions.md` | System prompt + `ENV_INSTRUCTIONS` | `prompts.ts` + `config.ts` |
| `{repoDir}/opencode.json` | OpenCode config (model, provider, permissions, MCP) | `getOpencodeConfig()` in `opencode.ts` |
| `~/.config/opencode/opencode.json` | Same global config | Same |
| `{repoDir}/.proliferate/actions-guide.md` | CLI actions quick-start | `ACTIONS_BOOTSTRAP` in `config.ts` |
| `{repoDir}/.opencode/tool/*.ts` | Tool implementations | `opencode-tools/index.ts` |
| `{repoDir}/.opencode/tool/*.txt` | Tool descriptions | Same |
| `{repoDir}/.opencode/tool/package.json` | Pre-installed tool deps | Copied from `/home/user/.opencode-tools/` |

### Environment variables injected

**Source**: `packages/services/src/sessions/sandbox-env.ts`

- `ANTHROPIC_API_KEY` or `LLM_PROXY_API_KEY` + `ANTHROPIC_BASE_URL`
- `GIT_TOKEN` / `GH_TOKEN` (from GitHub integration)
- All org/repo secrets (decrypted)
- `SESSION_ID`, `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`

### ENV_INSTRUCTIONS appended to system prompt

**Source**: `packages/shared/src/sandbox/config.ts:84-116`

```
## Environment Information

**This is a cloud sandbox environment with full Docker support.**

### Available Tools
- **Node.js 20** with `pnpm` (preferred) and `yarn`
- **Python 3.11** with `uv` (preferred) and `pip`
- **Docker & Docker Compose**

### How to Set Up Projects

**Option 1: Use Docker Compose (recommended for complex setups)**
docker compose up -d

**Option 2: Run services directly**
1. For Python/FastAPI backends: cd backend && uv sync && uv run uvicorn...
2. For Node.js/React frontends: cd frontend && pnpm install && pnpm dev...
```

### ACTIONS_BOOTSTRAP written to `.proliferate/actions-guide.md`

**Source**: `packages/shared/src/sandbox/config.ts:122-150`

```markdown
# Proliferate Actions

External integrations (Sentry, Linear, etc.) are available via the `proliferate` CLI.

## Quick Start

proliferate actions list
proliferate actions guide --integration <name>
proliferate actions run --integration <name> --action <action> --params '<json>'

## How It Works

- Read actions: auto-approved, return immediately
- Write actions: require user approval, block until approved/denied
- Danger actions: denied by default
- Authentication tokens: resolved server-side — never ask for API keys
```

---

## 4. Proliferate CLI — Full Capabilities {#4-cli-capabilities}

### Client-side CLI (`packages/cli/`)

Used by developers to start sessions from their local machine.

```bash
proliferate          # Start a coding session (auth → config → session → sync → opencode)
proliferate reset    # Clear all state and credentials
proliferate --version, -v
proliferate --help, -h
```

**Flow**: Device auth → Config → Create session via gateway → Rsync workspace → Launch OpenCode attach

**Entry**: `packages/cli/src/index.ts` → `packages/cli/src/main.ts`

### Sandbox-side CLI (available to agents inside sandbox)

#### Service management
```bash
proliferate services start --name <name> --command "<cmd>"  # Start background service
proliferate services list                                     # List services + status
proliferate services logs --name <name>                       # View recent logs
proliferate services logs --name <name> --follow             # Tail logs
proliferate services stop --name <name>                      # Stop service
proliferate services restart --name <name>                   # Restart service
proliferate services expose --port <port>                    # Expose port for preview
```

#### Environment management
```bash
proliferate env apply --spec <json>  # Apply env vars from spec (used at boot)
```

#### External integrations/actions
```bash
proliferate actions list                                      # Discover integrations
proliferate actions guide --integration <name>               # Get usage guide
proliferate actions run --integration <name> --action <action> --params '<json>'
```

### Where system prompts mention the CLI

| Prompt | CLI references |
|--------|---------------|
| Setup | Full `proliferate services` listing (7 commands) + `proliferate actions` (3 commands) |
| Coding | Brief `proliferate services start/stop/list/logs/expose` + `proliferate actions` |
| Scratch | Brief `proliferate services start/stop/list/logs/expose` + `proliferate actions` |
| Automation | Inherits from Coding |

### What the agent DOES NOT know about the CLI

The agent has no awareness that:
- **The `proliferate` CLI exists as a user-facing tool** (it only knows about sandbox-side commands)
- **It can be installed via `npx proliferate`** or the install script
- **It has device auth, SSH key management, file sync capabilities**
- **It creates sessions from local repos** (the agent doesn't know how sessions are initiated)
- **There's a broader Proliferate platform** beyond the sandbox it runs in

---

## 5. How Setup Sessions are Identified & Flagged {#5-setup-identification}

### Database

**Source**: `packages/db/src/schema/sessions.ts`

```typescript
sessionType: text("session_type").default("coding") // 'setup', 'coding', 'terminal', 'cli'
```

### Contract/validation

**Source**: `packages/shared/src/contracts/sessions.ts`

```typescript
const CreateSessionInputSchema = z.object({
  prebuildId: z.string().uuid().optional(),
  sessionType: z.enum(["setup", "coding"]).optional(),
  modelId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.sessionType === "setup" && !data.prebuildId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Setup sessions require a prebuildId",
      path: ["prebuildId"],
    });
  }
});
```

### Session creation paths

1. **User-initiated (web)**: `apps/web/src/server/routers/sessions-create.ts` — accepts `sessionType: "setup" | "coding"` from the frontend.

2. **Auto-created for managed prebuilds (gateway)**: `apps/gateway/src/api/proliferate/http/sessions.ts` — when a new managed prebuild is created, `startSetupSession()` fires. It creates a session with `sessionType: "setup"` and auto-posts the prompt `"Set up ${repoNames} for development. Get everything running and working."`.

3. **CLI sessions**: `packages/cli/src/main.ts` — always creates with `sessionType: "cli"`.

### How the agent knows it's in a setup session

The ONLY signal is the **system prompt**. The setup prompt says:
> "You're setting up a development environment for ${repoName}."

There is:
- **No explicit flag** like "You are in a SETUP SESSION"
- **No session type metadata** passed to the agent
- **No awareness of the broader session lifecycle** (what happens after setup, what snapshots are for from the platform perspective)

### How setup sessions differ technically

1. **Extra tools**: `save_service_commands` and `save_env_files` only injected for setup sessions
2. **Different system prompt**: Setup-focused vs coding-focused
3. **Initial prompt auto-sent**: `"Set up this repository for development. Get everything running and working."`
4. **Hidden from main session list**: Filtered out in `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
5. **Finalization flow**: Dedicated `finalizeSetupHandler` that creates/updates prebuild + snapshot

---

## 6. Setup Session Flow — Agent Perspective {#6-agent-flow}

1. **Sandbox boots** with repo cloned to `/home/user/workspace/{repoName}`
2. **System prompt loaded**: `getSetupSystemPrompt(repoName)` + `ENV_INSTRUCTIONS`
3. **Tools written** to `.opencode/tool/`: all 6 tools including setup-only ones
4. **Actions guide** written to `.proliferate/actions-guide.md`
5. **OpenCode starts**: `opencode serve --port 4096 --hostname 0.0.0.0`
6. **Initial prompt arrives**: `"Set up this repository for development. Get everything running and working."`
7. Agent works autonomously: installs deps, starts services, configures env
8. Agent calls `request_env_variables()` if external credentials needed
9. Agent calls `save_env_files()` to record env file spec
10. Agent calls `save_service_commands()` to save auto-start commands
11. Agent calls `verify()` to upload evidence
12. Agent calls `save_snapshot()` to save working state
13. Agent reports completion in final message

**What the agent does NOT know during this flow:**
- That the user sees a "Setting up your environment" banner
- That there's a "Done — Save Snapshot" button the user can click
- That this session will be finalized into a prebuild
- That future coding sessions will boot from this snapshot
- What Proliferate is as a platform
- That it's running inside a Proliferate sandbox specifically
- That it could tell the user about CLI capabilities for their local workflow

---

## 7. Setup Session Flow — User Perspective {#7-user-flow}

### Entry point 1: From repo card (first setup)

1. User clicks "Set Up" on an unconfigured repo card
2. Navigates to `/workspace/new?repoId=X&type=setup`
3. Redirected to `/workspace/setup/${repoId}` (dedicated setup page)

### Entry point 2: From snapshot selector (edit existing)

1. User clicks pencil icon on a snapshot
2. `openEditSession()` or `openSetupSession()` called
3. Opens coding session modal with `sessionType: "setup"`

### Entry point 3: Auto-created (managed prebuild)

1. When a new managed prebuild is created via gateway API
2. `startSetupSession()` fires automatically
3. User may not even see this — it's fire-and-forget

### Setup page UI

**Source**: `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx`

```tsx
<div className="flex h-full flex-col">
  {/* Setup context banner */}
  <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 shrink-0">
    <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
    <div className="flex-1 min-w-0">
      <span className="text-sm font-medium">Setting up your environment</span>
      <span className="text-xs text-muted-foreground ml-2">
        Install dependencies, configure services, and save when ready
      </span>
    </div>
    <Button onClick={handleFinalize} size="sm">
      <Check /> Done — Save Snapshot
    </Button>
  </div>

  {/* Session (same CodingSession component as regular sessions) */}
  <CodingSession
    sessionId={sessionId}
    title="Set up your Environment"
    description="Configure your cloud environment — install dependencies, start services, set up databases. When you're done, save it as a snapshot. Every future session will start from this exact state."
  />
</div>
```

### What the user sees:
- A thin banner at top: "Setting up your environment" + "Install dependencies, configure services, and save when ready"
- A "Done — Save Snapshot" button
- The same chat interface as coding sessions
- The same right-side panel (Preview, Code, Terminal, etc.)

### What the user does NOT see:
- **No modal/dialog** explaining what a setup session is before it starts
- **No progress indicators** for setup steps (installing deps, starting services, etc.)
- **No question mark / help icon** on the setup banner itself
- **No explanation** of what will happen after they click "Done"
- **No visual distinction** between setup and coding sessions beyond the thin banner
- **No "what is this?" affordance** for first-time users

---

## 8. Onboarding & Orientation UX {#8-onboarding-ux}

### Onboarding flow

**Source**: `apps/web/src/app/onboarding/page.tsx`, `apps/web/src/stores/onboarding.ts`

**Steps**: path choice → create org → questionnaire → tools → invite → billing → complete

| Step | Component | What it tells the user |
|------|-----------|----------------------|
| Path choice | `step-path-choice.tsx` | Developer vs Company — "AI agents that code in cloud environments" |
| Create org | `step-create-org.tsx` | "Give your team a name" |
| Questionnaire | `step-questionnaire.tsx` | "Tell us about your team" |
| Tool selection | `step-tool-selection.tsx` | "Which tools do you use?" (GitHub, Slack, Linear, Sentry, PostHog) |
| Invite | `step-invite-members.tsx` | "Add team members to collaborate on projects" |
| Billing | `step-billing.tsx` | "Start your free trial — No credit card required" |
| Complete | `step-complete.tsx` | "You're all set! Head to the dashboard to start a session" |

### Post-onboarding dashboard cards

**Source**: `apps/web/src/components/dashboard/onboarding-cards.tsx`

Cards shown based on user state:

1. "Connect your first repo" (no repos)
2. "Set up your first repo" (repos but none configured)
3. "Link your GitHub" (no GitHub connection)
4. "Link your Slack" (if selected during onboarding)
5. "Connect Linear" (if selected)
6. "Connect Sentry" (if selected)
7. "Connect PostHog" (if selected)
8. "Create an automation" (after repos configured)

Each card is dismissible with an X button.

### Dashboard empty state

**Source**: `apps/web/src/components/dashboard/empty-state.tsx`

- Greeting: "Good morning/afternoon/evening, [Name]"
- Prompt input with model/environment pickers
- "Needs Attention" section (agent runs requiring input)
- "Recent Activity" section (last 5 sessions)

### What's missing from onboarding:
- **No explanation of what sessions are** (setup vs coding)
- **No explanation of what the agent can do**
- **No explanation of snapshots** before they encounter one
- **No walkthrough/tour** of the main interface
- **No "what to expect" modal** before first setup session starts

---

## 9. Help System {#9-help-system}

### Architecture

**Source**: `apps/web/src/stores/help.ts`, `apps/web/src/content/help/index.ts`, `apps/web/src/components/help/`

- **Zustand store**: `useHelpStore` — `isOpen`, `topic`, `openHelp(topic)`, `closeHelp()`
- **Trigger**: `<HelpLink topic="..." />` — icon-only (question mark) or text link ("Learn more")
- **Display**: `<HelpSheet />` — dialog with markdown-rendered content

### Help topics

| Topic ID | Title | Description |
|----------|-------|-------------|
| `getting-started` | Getting Started | Learn the basics of cloud development |
| `snapshots` | Snapshots | Save and restore your development environment |
| `setup-sessions` | Setup Sessions | Configure your environment with AI assistance |
| `coding-sessions` | Coding Sessions | Build and debug with an AI coding agent |

### Help content summary

**getting-started**: Basic flow (connect repo → setup → snapshot → code). ~70 lines.

**snapshots**: What gets saved, why use them, creating/using them. ~35 lines.

**setup-sessions**: Configured vs not, what happens, how it works, tips. ~40 lines.

**coding-sessions**: What you can do (write code, debug, explore, run commands), preview panel, pausing. ~35 lines.

### Where help links appear in the UI

Based on codebase search — help links are available but **not prominently placed in the setup session flow**. There's no help icon on the setup banner, no "what is this?" affordance.

---

## 10. Gap Analysis — What's Missing {#10-gap-analysis}

### Agent awareness gaps

| Gap | Current state | Impact |
|-----|--------------|--------|
| **Agent doesn't know it's "in a setup session"** | System prompt says "You're setting up..." but never uses the phrase "setup session" or explains the concept | Agent can't orient the user about what's happening or what comes next |
| **Agent doesn't know about the Proliferate platform** | No mention of "Proliferate" as a product in any system prompt | Agent can't explain itself or the platform to confused users |
| **Agent doesn't know the CLI exists as a user tool** | System prompts only mention sandbox-side `proliferate services/actions` | Agent can't recommend `npx proliferate` for local-first workflow |
| **Agent doesn't know about session lifecycle** | No mention of what happens after setup (snapshot → prebuild → coding sessions) | Agent can't explain the purpose of what it's doing in context |
| **Agent doesn't know it has a UI counterpart** | No mention of the Proliferate web UI, the "Done" button, the preview panel, etc. | Agent may duplicate UX or confuse users about where to look |
| **Agent doesn't know about other session types** | Setup prompt doesn't mention coding/automation sessions exist | Agent can't guide users to next steps after setup |
| **Agent doesn't know about the actions system scope** | Agent knows `proliferate actions` commands but not what integrations are connected or how to discover them contextually | Agent may try to use integrations that aren't connected |

### User experience gaps

| Gap | Current state | Impact |
|-----|--------------|--------|
| **No pre-session explanation** | User clicks "Set Up" and immediately enters a chat session | First-time users don't know what's happening or what to expect |
| **Thin setup banner is easy to miss** | Only signal is a small banner: "Setting up your environment" | Users may think they're in a regular coding session |
| **No help icon on setup banner** | No `?` or "Learn more" on the setup-specific UI | Users can't get contextual help about setup |
| **No progress/stage indicators** | No visual feedback on setup progress (deps → services → env → verify → snapshot) | Users can't tell if setup is stuck or how far along it is |
| **No explanation of "Done — Save Snapshot"** | Button has no tooltip/explanation of what it does | Users may click prematurely or not understand the consequence |
| **No post-setup guidance** | After finalization, user is just redirected to `/dashboard` | Users don't know what to do next (start a coding session) |
| **Setup sessions hidden from session list** | `sessionType !== "setup"` filter in sessions page | Users can't find/revisit their setup sessions from the main list |
| **No modal/dialog explaining setup** | Jump straight from "Set Up" button to the session | Steep learning curve for new users |
| **Onboarding doesn't explain sessions** | Onboarding covers repo connection, integrations, billing — not session concepts | Users enter their first session without understanding the mental model |

### System prompt gaps (detail)

**The setup prompt DOES tell the agent:**
- What repo it's setting up
- To work autonomously, push through problems
- To prefer local services over external ones
- How to use `request_env_variables`, `save_snapshot`, `save_env_files`, `save_service_commands`, `verify`
- How to use `proliferate services` and `proliferate actions`
- To background long-running processes
- To write a preview manifest
- To verify before saving

**The setup prompt DOES NOT tell the agent:**
- "You are in a **setup session** — a specific Proliferate session type"
- "You are running inside **Proliferate**, a cloud development platform"
- "The user can see you working via a web interface"
- "There is a 'Done — Save Snapshot' button in the UI"
- "After setup, the user will use this snapshot to start **coding sessions**"
- "The `proliferate` CLI is also available to the user on their local machine"
- "You can suggest the user install the CLI for local workflow"
- "The user may need help understanding what a setup session is"
- "Connected integrations include: [list from session context]"
- What model it's running as
- What organization/user it's working for

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/shared/src/prompts.ts` | All system prompts |
| `packages/shared/src/opencode-tools/index.ts` | All tool definitions |
| `packages/shared/src/sandbox/config.ts` | Plugin, paths, ENV_INSTRUCTIONS, ACTIONS_BOOTSTRAP |
| `packages/shared/src/sandbox/opencode.ts` | OpenCode config generation |
| `packages/shared/src/agents.ts` | Agent types, models, transforms |
| `apps/gateway/src/lib/session-store.ts` | System prompt selection + context loading |
| `apps/gateway/src/api/proliferate/http/sessions.ts` | Auto setup session creation |
| `apps/gateway/src/hub/capabilities/tools/index.ts` | Intercepted tool registry |
| `apps/gateway/src/hub/capabilities/tools/save-env-files.ts` | Setup-only tool handler |
| `apps/gateway/src/hub/capabilities/tools/save-service-commands.ts` | Setup-only tool handler |
| `packages/services/src/sessions/sandbox-env.ts` | Env var injection |
| `packages/services/src/sessions/db.ts` | `createSetupSession()`, `excludeSetup` filter |
| `packages/shared/src/contracts/sessions.ts` | Session schema + setup validation |
| `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx` | Setup page UI |
| `apps/web/src/stores/coding-session-store.ts` | `openSetupSession()`, `openEditSession()` |
| `apps/web/src/hooks/use-sessions.ts` | `useFinalizeSetup()` hook |
| `apps/web/src/server/routers/repos-finalize.ts` | Setup finalization handler |
| `apps/web/src/components/dashboard/onboarding-cards.tsx` | Dashboard guidance cards |
| `apps/web/src/content/help/index.ts` | Help content (4 topics) |
| `apps/web/src/stores/help.ts` | Help modal state |
| `apps/web/src/components/help/help-link.tsx` | Help trigger component |
| `apps/web/src/components/help/help-sheet.tsx` | Help modal display |
| `apps/web/src/stores/onboarding.ts` | Onboarding flow state |
| `packages/cli/src/index.ts` | CLI entry point |
| `packages/cli/src/main.ts` | CLI main flow |
