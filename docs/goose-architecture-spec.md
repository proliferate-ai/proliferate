# Goose Architecture Spec

> Comprehensive architectural analysis of the [Goose](https://github.com/block/goose) codebase — an open-source, local-first AI agent for automating engineering tasks. Written for the Proliferate engineering team as a reference for architectural comparison and feature inspiration.
>
> **Date**: 2026-02-24

---

## 1. What Goose Is

Goose is a **local-first AI coding agent** built in Rust. It runs on your machine (CLI or Electron desktop app), connects to any LLM provider (40+), and uses MCP (Model Context Protocol) as its universal extension system. It can edit files, run shell commands, control your computer, manage memory, and extend its capabilities through any MCP server.

**Key difference from Proliferate**: Goose runs entirely locally — no cloud control plane, no remote sandboxes, no multi-tenant infrastructure. It's a single-user agent that talks directly to LLM APIs. Proliferate is a cloud-hosted platform that orchestrates remote sandboxes for teams. They share concerns around tool execution, provider abstraction, and security, but the deployment model is fundamentally different.

**Maintained by**: Block (formerly Square)
**License**: Apache 2.0
**Language**: Rust (~127k LOC) + TypeScript (Electron UI)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Core Language | Rust (2021 edition, toolchain 1.82+) |
| Async Runtime | Tokio |
| HTTP Framework | Axum 0.8 |
| MCP Protocol | rmcp 0.16 |
| Database | SQLite (via sqlx) — metadata only |
| Desktop UI | Electron 40 + React 19 + Vite 7 + Tailwind 4 |
| CLI | Clap 4 + rustyline + bat (syntax highlighting) |
| Credential Storage | System keyring (keyring crate) with file fallback |
| Local Inference | llama-cpp-2, Candle (CPU/Metal/CUDA) |
| Audio | Whisper (via Candle) for dictation |
| Observability | OpenTelemetry + tracing crate |
| Build | Cargo workspace, Hermit for reproducible env |
| Packaging | Electron Forge (desktop), cargo (CLI) |

---

## 3. Repository Structure

```
goose/
├── crates/
│   ├── goose/              # Core agent library (73k LOC) — the brain
│   │   ├── src/agents/     # Agent loop, extension manager, tool execution
│   │   ├── src/providers/  # 40+ LLM provider implementations
│   │   ├── src/session/    # Session lifecycle & persistence
│   │   ├── src/conversation/ # Message types & history
│   │   ├── src/permission/ # Permission system & approval flow
│   │   ├── src/security/   # Threat detection (prompt injection, etc.)
│   │   ├── src/config/     # Configuration, paths, secrets
│   │   ├── src/recipe/     # Recipe (workflow) system
│   │   ├── src/context_mgmt/ # Token counting & compaction
│   │   └── src/otel/       # OpenTelemetry integration
│   ├── goose-server/       # HTTP/WS backend for desktop app ("goosed")
│   ├── goose-cli/          # CLI binary ("goose")
│   ├── goose-mcp/          # Built-in MCP servers (Developer, Memory, etc.)
│   ├── goose-acp/          # Agent Communication Protocol support
│   ├── goose-acp-macros/   # Proc macros for ACP
│   ├── goose-test-support/ # Test utilities & fixtures
│   └── goose-test/         # Benchmarking & test capture
├── ui/
│   ├── desktop/            # Electron app (React + TypeScript)
│   └── text/               # Experimental TUI (Node.js)
├── documentation/          # Docusaurus site
├── evals/                  # Evaluation framework
├── examples/               # Example recipes
├── services/               # Optional services (Discord bot, scheduler)
├── scripts/                # Build & utility scripts
├── Cargo.toml              # Workspace root
├── Justfile                # Task runner (like Makefile)
└── Dockerfile              # Multi-stage container build
```

**Notable**: Goose is a Rust workspace with 8 crates. The `goose` crate (73k LOC) contains all core logic. The CLI and server are thin wrappers. The desktop UI is a separate Electron app that communicates with the `goosed` binary via HTTP/WebSocket.

---

## 4. Core Agent Architecture

### 4.1 The Agent Struct

**Location**: `crates/goose/src/agents/agent.rs` (~2200 lines)

The `Agent` is the central orchestrator:

```rust
pub struct Agent {
    pub provider: SharedProvider,                        // Arc<Mutex<Option<Provider>>>
    pub extension_manager: Arc<ExtensionManager>,        // MCP tool registry
    pub prompt_manager: Mutex<PromptManager>,            // System prompt construction
    pub confirmation_tx: mpsc::Sender<Confirmation>,     // Tool approval channel
    pub tool_result_tx: mpsc::Sender<ToolResult>,        // Tool result channel
    pub retry_manager: RetryManager,                     // Error recovery
    pub tool_inspection_manager: ToolInspectionManager,  // Security checks
    pub frontend_tools: Mutex<HashMap<String, FrontendTool>>,
    pub final_output_tool: Arc<Mutex<Option<FinalOutputTool>>>,
    pub container: Mutex<Option<Container>>,             // Docker container for extensions
}
```

### 4.2 The Agent Loop

**Entry point**: `Agent::reply()` → `reply_internal()`

The loop is a **streaming async generator** that yields messages to the client in real-time:

```
User Message
    ↓
Slash Command Check (/clear, /compact, etc.)
    ↓
Session Conversation Retrieval (from SQLite)
    ↓
Auto-Compaction Check (if approaching context limit)
    ↓
┌─── CORE AGENT LOOP (max 1000 turns) ──────────────────┐
│                                                         │
│  Build System Prompt (templates + extensions + hints)   │
│      ↓                                                  │
│  Provider.stream(system, messages, tools)                │
│      ↓                                                  │
│  Process Streaming Response                             │
│      ↓                                                  │
│  Categorize Tool Calls                                  │
│  ├─ Frontend Tools → route to UI                        │
│  └─ Agent Tools → continue                              │
│      ↓                                                  │
│  Tool Inspection Pipeline                               │
│  ├─ SecurityInspector (prompt injection detection)      │
│  ├─ PermissionInspector (user policy checks)            │
│  └─ RepetitionInspector (loop detection)                │
│      ↓                                                  │
│  Permission Routing                                     │
│  ├─ Auto-Approved → execute immediately                 │
│  ├─ Needs Approval → emit ActionRequired, wait on chan  │
│  └─ Denied → return decline message                     │
│      ↓                                                  │
│  Tool Execution (dispatch to MCP servers)               │
│      ↓                                                  │
│  Add Tool Responses to Conversation                     │
│      ↓                                                  │
│  Check Exit Condition (no more tool calls, or final)    │
│      ↓                                                  │
│  Loop or Break                                          │
└─────────────────────────────────────────────────────────┘
    ↓
Persist Session to SQLite
    ↓
Stream Messages to Client (CLI or Desktop)
```

**Key properties**:
- Uses `async_stream::try_stream!` to yield messages as they arrive
- `tokio::select!` for concurrent tool execution
- Max 1000 turns per reply (configurable)
- Auto-compaction when context limit is approached (summarizes earlier messages)
- MOIM (Message-of-Intent-Map) injection for preserving user intent across compactions

### 4.3 Context Management

**Location**: `crates/goose/src/context_mgmt/`

Goose tracks token usage via `tiktoken-rs` and automatically compacts conversations when approaching the model's context limit:

1. Count tokens in system prompt + conversation + tools
2. If approaching limit, summarize earlier messages into a compact form
3. Preserve recent messages and tool results
4. Re-inject MOIM (user's original intent) so the agent doesn't lose track

This is critical because Goose sessions can run for hours with thousands of tool calls.

---

## 5. Provider Abstraction (40+ LLM Providers)

**Location**: `crates/goose/src/providers/`

### 5.1 The Provider Trait

```rust
pub trait Provider: Send + Sync {
    async fn stream(
        &self,
        model_config: &ModelConfig,
        session_id: &str,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError>;

    async fn complete(...) -> Result<(Message, ProviderUsage), ProviderError>;
    async fn complete_fast(...) -> Result<(Message, ProviderUsage), ProviderError>;
}
```

### 5.2 Supported Providers

**Major cloud**:
- Anthropic Claude (including Claude Code)
- OpenAI (GPT-4, o-series)
- Google Gemini
- Azure OpenAI
- AWS Bedrock
- GCP Vertex AI
- GitHub Copilot

**Alternative**:
- Databricks, OpenRouter, xAI, LiteLLM, Snowflake, SageMaker TGI

**Local inference**:
- Ollama (with tool shimming for models without native tool support)
- llama-cpp-2 (direct)
- Candle (CPU/Metal/CUDA)

### 5.3 Tool Shimming (Ollama)

Many local models don't support native tool calling. Goose solves this by converting tool definitions to text descriptions and parsing the model's output for structured tool calls. This "shim" layer makes any model work with tools, even if it doesn't natively support function calling.

### 5.4 Canonical Model Registry

A unified model naming system maps human-readable names to provider-specific model IDs. Users configure `model: "claude-sonnet"` and Goose resolves it to the correct API model ID.

### 5.5 Declarative Providers

Custom providers can be defined via YAML configuration without writing Rust code. This enables pointing Goose at any OpenAI-compatible endpoint.

---

## 6. MCP Extension System

This is Goose's defining architectural choice. **Everything is MCP.** Tools are MCP tools. Extensions are MCP servers. Even built-in capabilities (file editing, shell) are implemented as MCP servers.

### 6.1 Extension Types

| Type | Transport | Lifecycle | Use Case |
|------|-----------|-----------|----------|
| `Stdio` | stdin/stdout | Spawned as child process | External MCP servers (Node, Python, etc.) |
| `StreamableHttp` | HTTP | Connected to remote URL | Remote MCP services |
| `Builtin` | In-process | Bundled with goose-mcp | Developer, Memory, AutoVisualiser, etc. |
| `Platform` | In-process | Direct Rust calls | Todo, Apps, Summon, Code Mode, etc. |
| `Frontend` | IPC to UI | Desktop/CLI provided | UI-specific tools |

### 6.2 Extension Manager

**Location**: `crates/goose/src/agents/extension_manager.rs` (~1800 lines)

The `ExtensionManager` handles the full lifecycle:
1. **Load** extensions from config (`~/.config/goose/config.yaml`)
2. **Spawn/connect** MCP servers (child processes or HTTP)
3. **Aggregate** all tools from all extensions into a unified tool list
4. **Route** tool calls to the correct MCP server
5. **Collect** results and notifications
6. **Enforce** limits (MAX_EXTENSIONS=5, MAX_TOOLS=50)

Tool names are prefixed with the extension name to avoid collisions: `developer__shell`, `memory__store`, etc.

### 6.3 Built-in MCP Servers (goose-mcp crate)

**Location**: `crates/goose-mcp/`

| Server | Tools | Purpose |
|--------|-------|---------|
| **Developer** | `shell`, `text_editor` (view/write/str_replace/insert/undo), `screen_capture`, `image_processor`, `list_windows` | Core coding tools — file editing, shell commands, screenshots |
| **Memory** | `store`, `retrieve`, `search` | Persistent memory across sessions |
| **ComputerController** | Platform-specific automation | macOS/Windows/Linux GUI control |
| **AutoVisualiser** | HTML/CSS template rendering | Visual debugging |
| **Tutorial** | Interactive guided learning | Onboarding |
| **PeekABOO** | Monitoring & observation | Basic monitoring |

The Developer server is the primary tool surface — its `text_editor` tool (view/write/str_replace/insert/undo_edit) and `shell` tool handle the vast majority of coding tasks.

### 6.4 Built-in Platform Extensions

**Location**: `crates/goose/src/agents/platform_extensions/`

These run in-process (not via MCP protocol) for lower latency:

| Extension | Default | Purpose |
|-----------|---------|---------|
| **Todo** | Enabled | Task tracking during sessions |
| **Apps** | Enabled | Create sandboxed HTML/CSS/JS apps |
| **Summon** | Enabled | Load knowledge, delegate to subagents |
| **Top of Mind (TOM)** | Enabled | Inject custom context via env vars |
| **Chat Recall** | Disabled | Search past conversation history |
| **Extension Manager** | Enabled | Discover/enable/disable extensions at runtime |
| **Code Mode** | Disabled | Execute extension calls via code (token-saving) |

### 6.5 Adding a New Extension

External extensions are just MCP servers. Any process that speaks MCP over stdio or HTTP can be a Goose extension:

```yaml
# ~/.config/goose/config.yaml
extensions:
  my-tool:
    enabled: true
    type: stdio
    cmd: npx
    args: ["-y", "@myorg/my-mcp-server"]
```

No Rust code needed. This is Goose's killer extensibility story.

---

## 7. Permission & Security System

### 7.1 Tool Inspection Pipeline

**Location**: `crates/goose/src/tool_inspection.rs`, `crates/goose/src/permission/`

Every tool call passes through a three-stage inspection pipeline:

```
Tool Call Request
    ↓
SecurityInspector
  - Detects prompt injection patterns
  - Scans for command injection
  - Flags suspicious payloads
    ↓
PermissionInspector
  - Checks user-configured policies
  - Checks pre-approved tool patterns
  - Evaluates read-only classification
    ↓
RepetitionInspector
  - Detects tool call loops
  - Prevents infinite retry spirals
    ↓
Result: Allow | NeedsApproval(reason) | Deny
```

### 7.2 Read-Only Detection

Goose uses an **LLM-based classifier** to determine if a tool call is read-only (safe to auto-approve):

```rust
async fn detect_read_only_tools(
    provider: Arc<dyn Provider>,
    session_id: &str,
    tool_requests: Vec<&ToolRequest>,
) -> Vec<String>  // IDs of read-only tools
```

This is a notable design choice — rather than manually tagging every tool as read/write, Goose asks the LLM to classify at runtime. Pragmatic but adds latency and LLM cost to the approval flow.

### 7.3 User Approval Flow

When a tool needs approval:
1. Agent emits `ActionRequired` message to the client (CLI prompt or desktop dialog)
2. Agent blocks on `confirmation_rx` channel
3. User approves or declines
4. Agent continues or returns decline message to LLM

### 7.4 Sandbox (macOS)

**Location**: `documentation/docs/guides/sandbox.md`

Optional sandboxing via Apple's `sandbox-exec` (seatbelt):
- **File protection**: Blocks writes to `~/.ssh`, shell configs, goose config
- **Network filtering**: HTTP CONNECT proxy blocks raw IPs, tunneling tools
- **Domain blocklist**: `~/.config/goose/sandbox/blocked.txt`
- Enabled via `GOOSE_SANDBOX=true`

### 7.5 Environment Variable Security

The extension system blocks 31 dangerous environment variables from being set by extensions:
- `PATH`, `LD_PRELOAD`, `PYTHONPATH`, `NODE_OPTIONS`, `DYLD_*`, etc.
- Prevents command hijacking and DLL injection attacks

---

## 8. Message & Conversation Model

### 8.1 Message Types

**Location**: `crates/goose/src/conversation/message.rs`

```rust
pub enum MessageContent {
    Text(TextContent),
    Image(ImageContent),
    ToolRequest(ToolRequest),                          // LLM wants to call a tool
    ToolResponse(ToolResponse),                        // Tool result
    ToolConfirmationRequest(ToolConfirmationRequest),   // Permission prompt
    ActionRequired(ActionRequired),                     // Needs user input
    FrontendToolRequest(FrontendToolRequest),           // UI-specific tool
    Thinking(ThinkingContent),                         // Model's chain-of-thought
    RedactedThinking(RedactedThinkingContent),         // Redacted thinking
    SystemNotification(SystemNotificationContent),
    Reasoning(ReasoningContent),                       // Extended thinking
}
```

Messages are multi-content — a single message can contain text, images, tool calls, and thinking blocks simultaneously. This mirrors the Anthropic API's content block model.

### 8.2 Conversation Persistence

Conversations are stored in **SQLite** (file-based, local). Session state includes:
- Full message history (serialized to JSON)
- Token usage metrics (input/output/total)
- Session metadata (ID, timestamps, schedule ID)

### 8.3 Conversation Fixing

Goose includes logic to repair malformed conversation history — handling edge cases like orphaned tool responses, missing tool requests, or corrupted message sequences. This is necessary because long-running sessions with many tool calls can occasionally produce inconsistent state.

---

## 9. Recipe System (Workflow Automation)

**Location**: `crates/goose/src/recipe/`

Recipes are YAML-defined workflows that automate multi-step agent tasks:

```yaml
version: "1.0"
title: "Setup Development Environment"
description: "Configure a new project"
extensions:
  - type: builtin
    name: developer
parameters:
  - name: project_name
    type: string
    required: true
activities:
  - "Create a new directory called {{project_name}}"
  - "Initialize a git repository"
  - "Create a README.md"
settings:
  provider: anthropic
  model: claude-sonnet
  max_turns: 50
response:
  type: object
  properties:
    status: { type: string }
```

**Features**:
- Parameter templating with `{{param}}` substitution
- Extension binding (override default extensions per recipe)
- Sub-recipes (nested workflows with value passing)
- JSON schema response validation
- Retry configuration
- Provider/model overrides per recipe

Recipes can be run via CLI (`goose run --recipe file.yaml`) or programmatically.

---

## 10. Session & Server Architecture

### 10.1 Session Management

**Location**: `crates/goose/src/session/`

Sessions track:
- Conversation history
- Active extensions
- Token usage metrics
- Session configuration (max turns, schedule ID)

Sessions are persisted to SQLite and can be resumed. The session manager coordinates multiple concurrent sessions (relevant for the server mode).

### 10.2 The Server ("goosed")

**Location**: `crates/goose-server/`

The `goosed` binary is an Axum HTTP server that exposes the agent via REST API + WebSocket:

- **REST API**: Session CRUD, recipe execution, configuration management
- **WebSocket**: Real-time agent communication (streaming messages, tool approvals)
- **OpenAPI**: Auto-generated schema (via `utoipa`)
- **Auth**: Token-based authentication

The Electron desktop app spawns `goosed` as a child process and communicates via HTTP/WS. The CLI can also use the server for headless operation.

### 10.3 The CLI ("goose")

**Location**: `crates/goose-cli/`

Interactive terminal interface with:
- `goose session` — Start/resume interactive sessions
- `goose run --recipe` — Execute recipes
- `goose configure` — Setup wizard
- `goose schedule` — Cron scheduling
- Syntax highlighting (bat), REPL editing (rustyline), progress bars (indicatif)

---

## 11. System Prompt Construction

**Location**: `crates/goose/src/agents/prompt_manager.rs`

System prompts are built using a **builder pattern** with Tera templates:

```rust
prompt_manager
    .builder()
    .with_extensions(extensions_info)        // List available tools
    .with_frontend_instructions(...)         // UI-specific guidance
    .with_extension_and_tool_counts(5, 50)   // Limits
    .with_code_execution_mode(false)         // Code mode toggle
    .with_hints(working_dir)                 // .goosehints file content
    .build()
```

**Inputs to the system prompt**:
- Base template (`system.md`, Jinja2/Tera syntax)
- Extension descriptions and tool lists
- `.goosehints` or `.agents.md` from the working directory
- Goose mode (Auto vs. Chat)
- Subagent enablement flag
- Frontend-specific instructions

The prompt dynamically adapts based on which extensions are loaded and what mode Goose is in.

---

## 12. Desktop UI (Electron)

**Location**: `ui/desktop/`

### 12.1 Architecture

```
Electron Main Process (main.ts)
    ├─ Spawns goosed binary (Rust backend)
    ├─ Manages window lifecycle
    └─ Handles system tray, auto-update

Electron Renderer (React)
    ├─ App.tsx (root)
    ├─ components/ (67 component directories)
    ├─ hooks/ (React hooks)
    ├─ contexts/ (React context providers)
    ├─ store/ (Zustand state management)
    ├─ api/ (generated from OpenAPI spec)
    └─ styles/ (Tailwind CSS)
```

### 12.2 Key Features

- Chat interface with streaming messages
- Tool approval dialogs
- Extension management UI (enable/disable/configure)
- Recipe browser and executor
- Settings panel (provider, model, permissions)
- Session history
- Markdown rendering with syntax highlighting
- Auto-update via `electron-updater`

### 12.3 API Client Generation

The desktop app generates its API client from the `goosed` OpenAPI spec:
```
goosed binary → generates OpenAPI JSON → openapi-ts generates TypeScript client → React app imports
```

This ensures the UI and backend stay in sync.

---

## 13. Key Architectural Decisions

### 13.1 Rust for the Core

Goose chose Rust over TypeScript/Python for the agent core. This gives:
- **Performance**: Native speed, low memory, efficient async (Tokio)
- **Safety**: No null pointer exceptions, no data races
- **Single binary**: CLI and server compile to one binary, no runtime needed
- **Trade-off**: Higher development friction, smaller contributor pool, harder to prototype

### 13.2 MCP as the Universal Extension Protocol

Everything is MCP. Built-in tools, external extensions, and remote services all use the same protocol. This means:
- **Any MCP server works with Goose** — instant ecosystem access
- **Extensions are language-agnostic** — write in Node, Python, Go, anything
- **Clean boundary** — extensions are processes with well-defined I/O
- **Trade-off**: MCP overhead for simple operations (file read = IPC round trip)

### 13.3 Local-First, No Cloud Infrastructure

Goose runs entirely on the user's machine. No server to deploy, no database to manage, no multi-tenant concerns.
- **Simplicity**: SQLite for persistence, keyring for secrets, filesystem for state
- **Privacy**: Code never leaves the machine (except to LLM providers)
- **Trade-off**: No collaboration, no persistent agents, no trigger/webhook system, no remote sandboxes

### 13.4 Provider Agnostic with Tool Shimming

40+ providers, including local inference. The tool shimming layer for Ollama means even models without native function calling work with tools.
- **Freedom**: Users pick any model, including private/local ones
- **Trade-off**: Tool shimming is fragile — models may produce malformed tool calls

### 13.5 Permission System with LLM Classification

Rather than manually tagging tools as read/write, Goose asks the LLM to classify tool calls at runtime.
- **Pragmatic**: No maintenance burden for tool authors
- **Trade-off**: Adds latency and cost, classification may be wrong

### 13.6 SQLite Instead of PostgreSQL

Local agent = local database. SQLite is zero-config, embedded, and perfect for single-user.
- **Simplicity**: No database server to run
- **Trade-off**: No concurrent access, no full-text search (for large histories), no migration tooling comparable to Drizzle

### 13.7 Electron for Desktop

Cross-platform GUI via Electron + React, communicating with the Rust backend via HTTP/WS.
- **Ecosystem**: Full web tech stack for UI
- **Trade-off**: Memory overhead (~200MB+ for Electron), not as native as Tauri

---

## 14. Patterns Worth Noting

### 14.1 Streaming Async Generators

The agent loop uses `async_stream::try_stream!` to yield messages as they're produced. This is elegant — the caller gets a `Stream<Item = Result<Message>>` that they can consume incrementally. No callbacks, no channels for the consumer side.

### 14.2 Channel-Based Tool Approval

Tool approval uses `mpsc` channels — the agent sends an `ActionRequired` message and blocks on a confirmation channel. The UI (CLI prompt or desktop dialog) sends back the user's decision. Clean separation of agent logic from UI.

### 14.3 Multi-Inspector Pipeline

Security, permissions, and repetition detection are separate inspectors that run in sequence. Each returns `Allow | NeedsApproval | Deny`. If any inspector denies, the tool is blocked. Composable and testable.

### 14.4 Tool Name Prefixing

MCP tools are prefixed with their extension name (`developer__shell`, `memory__store`) to prevent collisions. Platform extensions can opt out of prefixing for first-class tools (`summon__delegate` → `delegate`).

### 14.5 Conversation Fixing

Long sessions with many tool calls can produce inconsistent message history. Goose includes repair logic to fix orphaned tool responses, missing requests, and other edge cases. Pragmatic resilience for long-running agents.

### 14.6 MOIM (Message of Intent Map)

When compacting conversations (summarizing to fit context), Goose re-injects the user's original intent as a special message. This prevents the agent from losing track of what it was doing after compaction — a subtle but important detail for long sessions.

### 14.7 Declarative Providers via YAML

Custom LLM providers can be defined in YAML without writing code. Any OpenAI-compatible endpoint can be added as a provider through configuration alone.

### 14.8 Recipe System for Reproducible Workflows

Recipes are YAML-defined, parameterized, version-controlled workflows. They bridge the gap between "interactive agent" and "automated pipeline" — you can develop a recipe interactively, then run it headlessly via CLI or schedule.

---

## 15. What Proliferate Can Learn From Goose

### Things Goose Does Well

1. **MCP as the universal extension protocol** — Goose's commitment to "everything is MCP" creates instant access to the entire MCP ecosystem. Proliferate's MCP proxy approach (control plane intercepts `mcp.call`) is architecturally different but the ecosystem access argument applies equally.

2. **Multi-inspector security pipeline** — The composable SecurityInspector → PermissionInspector → RepetitionInspector chain is clean and testable. Proliferate's action system has risk classification but could benefit from a similar pipeline.

3. **Context management (compaction + MOIM)** — Automatic conversation compaction with intent preservation is essential for long-running agents. Proliferate's session_events system provides similar durability but the MOIM pattern for summarization is worth stealing.

4. **Provider diversity** — 40+ providers including local inference via Ollama/llama.cpp. Proliferate routes through LiteLLM which covers many providers, but Goose's tool shimming for non-native-tool-calling models is clever.

5. **Recipe system** — YAML-defined, parameterized, reproducible workflows. Proliferate's automation system serves a similar purpose but recipes are more accessible for end users.

6. **Streaming async generators** — The `async_stream::try_stream!` pattern for the agent loop is elegant and worth understanding for any streaming agent architecture.

7. **Declarative provider configuration** — Adding new LLM endpoints via YAML config is great for self-hosters who run private models.

### Things Goose Does Differently (Not Necessarily Better)

1. **Local-only** — No cloud infrastructure, no collaboration, no persistent agents. This is a conscious choice for the local-first audience but means no webhook triggers, no team features, no remote sandboxes.

2. **Rust over TypeScript** — Higher performance and safety but smaller contributor pool and harder to extend. Proliferate's TypeScript stack is more accessible for the open-source community.

3. **SQLite over PostgreSQL** — Perfect for single-user but can't support multi-tenant, concurrent access, or advanced queries.

4. **LLM-based permission classification** — Clever but adds latency and cost. Proliferate's static risk classification (`read`/`write`/`danger`) is more deterministic.

5. **No sandbox isolation** — Tools run directly on the user's machine. The macOS sandbox is optional and limited. Proliferate's remote sandbox model provides stronger isolation.

6. **Electron over web** — Desktop-native experience but heavy memory footprint. Proliferate's web-first approach is more accessible.

7. **No trigger/webhook system** — Goose is reactive (user-initiated) only. No external event sources. Proliferate's trigger system (webhooks, polling, schedules) enables autonomous operation.
