Here is the completely rewritten, State-of-the-Art **Streaming & Preview Transport — System Spec**.

It has been rebuilt from the ground up to incorporate the **Cursor "AnyRun" Architecture**, stripping out sluggish web-app anti-patterns (HTTP polling, heavy VS Code Server iframes, static port guessing) and replacing them with native, event-driven, stateful daemon protocols.

---

# Streaming & Preview Transport — System Spec (V2: "AnyRun" Architecture)

## 1. Scope & Purpose

### The Paradigm Shift: "The Daemon of the DevBox"

To achieve the "magical," zero-latency feel of a local IDE, we completely reject the model of embedding heavy web-IDEs inside the container. Instead, we run a unified, lightweight Node.js/Rust process inside the sandbox called the **`sandbox-daemon`** (mirroring Cursor's `pod-daemon` + `exec-daemon`).

This daemon acts as the omniscient bridge to the OS. It manages pseudo-terminals (PTYs) with ring-buffers, watches the OS for dynamic port allocations, and streams file-system events instantly over WebSockets.

### In Scope

* Real-time transport path from the Browser/Client ↔ Gateway ↔ Sandbox.
* **Terminal Replay:** Process and terminal multiplexing with ring-buffered PTY streams and `last_event_id` replay semantics.
* **Native Monaco Bridge:** A lightweight File System RPC API to power a native React `<MonacoEditor />` (replacing `openvscode-server`).
* **Dynamic Port Leasing:** OS-level port watching to dynamically expose and route Preview URLs.
* **Event-Driven UI:** Real-time `chokidar`/`inotify` WebSocket events that trigger instant UI updates for Git and file trees.
* Gateway Zero-Trust proxy surfaces and session-scoped auth injection.

### Out of Scope

* Session lifecycle orchestration (create/pause/resume/delete) — see `sessions-gateway.md`.
* Provider boot internals (E2B / Kubernetes) — see `sandbox-providers.md`.
* `openvscode-server` (Explicitly deprecated and removed in favor of the native React Monaco component + FS API).

---

## 2. Core Transport Topology

### 2.1 The Two-Hop Trust Boundary

The Browser **never** connects directly to the Sandbox tunnel. The Sandbox **never** holds long-lived enterprise tokens.

1. **Hop 1 (Client ↔ Gateway):** Authenticated via JWT. A multiplexed WebSocket connection at `wss://api.proliferate.dev/v1/sessions/:sessionId/stream`.
2. **Hop 2 (Gateway ↔ Sandbox):** Authenticated via short-lived, Gateway-injected Bearer tokens. The Gateway multiplexes connections to the `sandbox-daemon` running inside the E2B microVM/Docker container.

### 2.2 The Internal Sandbox Architecture

Inside the E2B Sandbox, PID 1 initializes two primary infrastructure components:

1. **`sandbox-daemon`:** The bridging engine. It manages child processes, intercepts `stdout`/`stderr`, watches the filesystem, exposes a basic FileSystem CRUD API, and monitors Linux network namespaces.
2. **Caddy (Dynamic Reverse Proxy):** Listens on the public tunnel port and routes traffic to either the `sandbox-daemon` APIs or the dynamically discovered user application ports (Previews).

---

## 3. The Sandbox Daemon (The "AnyRun" Upgrades)

To provide a native IDE experience in the browser, the `sandbox-daemon` implements four critical subsystems:

### 3.1 Terminal Ring Buffer (Solving "Terminal Amnesia")

Standard WebSockets drop data when network connections flicker. To prevent users from seeing a blank terminal when they refresh the page:

* When a PTY process (like a bash shell or a test runner) is spawned, the daemon stores the last `10,000` lines of `stdout`/`stderr` in an **in-memory Ring Buffer**.
* Every emitted chunk is tagged with an incrementing `event_id`.
* **The Attach Contract:** When the React UI's `xterm.js` connects, the Gateway sends an `AttachProcess(last_event_id=500)` request.
* The daemon instantly replays lines `501-CURRENT` from the buffer before streaming live bytes. The user never loses their build logs.

### 3.2 Native Monaco FS Bridge (Killing VS Code Server)

Running `openvscode-server` inside every container burns 200MB+ of RAM and forces sluggish `iframes` in the UI.

* The daemon exposes blazing-fast HTTP RPCs: `GET /api/fs/read?path=...` and `POST /api/fs/write`.
* The Next.js frontend renders Microsoft's `<MonacoEditor />` natively.
* The UI fetches the raw string via the Gateway, feeds it to Monaco, and saves it back via POST. Memory usage in the sandbox remains effectively zero, and the editor loads instantly.

### 3.3 Event-Driven File Watcher (Killing Git Polling)

HTTP polling for `git diff` creates a laggy, disconnected experience. We use event-driven reactivity.

* The daemon runs `chokidar` (or native `inotify`) over the `/workspace` directory.
* When the Agent modifies `src/auth.ts`, the daemon immediately pushes a JSON WebSocket event: `{"type": "fs_change", "path": "src/auth.ts", "action": "modify"}`.
* The React UI catches this event and instantly invalidates its TanStack Query cache. This triggers an invisible background fetch to update the Git Changes sidebar and the active Monaco tab.

### 3.4 Dynamic Port Leasing (Zero-Config Previews)

Hardcoding Caddy to guess ports `3000` or `5173` breaks when agents use arbitrary ports (e.g., Python on `8080`).

* The daemon continuously polls the OS network namespace (`ss -tln` or `/proc/net/tcp`) looking for newly bound `LISTEN` sockets on `0.0.0.0` or `127.0.0.1`.
* When the Agent runs `python -m http.server 8080`, the daemon detects port `8080`, dynamically rewrites `/home/user/.proliferate/caddy/dynamic.caddy`, and executes `caddy reload` (zero downtime).
* It then pushes a WS event to the UI: `{"type": "port_opened", "port": 8080}`. The Preview URL updates instantly without user intervention.

---

## 4. Right Sidebar Coverage Matrix

This architecture allows the Next.js UI to render all components natively, drastically improving performance.

| Right Sidebar Surface | UI Implementation | Backing Transport (Gateway Proxy) |
| --- | --- | --- |
| **Preview** | `<iframe />` | HTTP proxy routing via dynamic Caddy discovery. |
| **Terminal** | `xterm.js` | WebSocket to daemon `AttachProcess` with ring-buffer replay. |
| **Code Editor** | Native `<MonacoEditor />` | HTTP `GET/POST /daemon/fs/*` (No VS Code iframe). |
| **Git / Changes** | Native React Tree | HTTP `/daemon/git/*`, triggered instantly by `fs_change` WS events. |
| **Services / Logs** | Native React List | HTTP `/daemon/services`, logs via SSE or WS. |

---

## 5. Protocol Contracts & Proxy Endpoints

The Gateway maintains strict separation of concerns, mapping Client routes to Sandbox routes while enforcing RBAC.

### 5.1 Client ↔ Gateway (The Unified Control WebSocket)

* **Endpoint:** `WS /proliferate/ws/:sessionId?token=<jwt>`
* **Downstream (Gateway → Browser):**
* `agent_event`: LLM reasoning streams (parsed from OpenCode SSE).
* `terminal_out`: PTY bytes + `event_id`.
* `fs_event`: Real-time file change notifications.
* `preview_ready`: Fired when dynamic port discovery updates Caddy.


* **Upstream (Browser → Gateway):**
* `prompt`: User chat input.
* `terminal_in`: User keystrokes sent to the PTY.



### 5.2 Gateway ↔ Sandbox (Injected Auth)

The Gateway derives a short-lived, session-scoped HMAC token and injects it as an `Authorization: Bearer <token>` header into all proxy requests. The `sandbox-daemon` rejects any request lacking this token.

* **PTY Proxy:** `WS ${tunnelUrl}/_proliferate/pty?last_event_id=X`
* **FS Proxy:** `GET/POST ${tunnelUrl}/_proliferate/fs/*`
* **Control WS:** `WS ${tunnelUrl}/_proliferate/control` (Carries FS events and Port events)
* **Agent SSE:** `GET ${tunnelUrl}/_proliferate/agent/events`

---

## 6. Streaming Resilience & Reconnect

Network unreliability between the Browser and the Control Plane is a certainty. The system uses a **Crash-Only / Replay State Model**:

1. **The Gateway acts as a shock absorber.** If the Browser disconnects, the Gateway maintains the active WebSocket/SSE connections to the Sandbox. The Agent continues coding uninterrupted.
2. **Deterministic Re-attachment:** When the Browser reconnects, the Next.js client sends its highest known `last_event_id` for both the Agent stream and the Terminal stream.
3. **State Hydration:**
* The Gateway fetches missing Agent messages from Postgres.
* The Gateway requests the missing Terminal lines from the `sandbox-daemon`'s in-memory ring buffer.


4. **Result:** The UI repaints perfectly. No dropped terminal logs, no missing code edits.

---

## 7. Security & Trust Boundaries

1. **The "No-Pass-Through" Rule:** The Browser is **never** given the E2B Sandbox URL or the Sandbox authentication token. All requests (Preview, Terminal, FS) are routed through `api.proliferate.dev/proxy/:sessionId/...`.
2. **Server-Side Token Derivation:** The Gateway intercepts the proxy request, validates the user's JWT, and verifies the user has DB-level access to the `sessionId`. Only then does it derive the `SANDBOX_HMAC_TOKEN` and forward the packets.
3. **Network Isolation:** The `sandbox-daemon` RPC server binds explicitly to `127.0.0.1` inside the sandbox, exposed to the outside world *only* through Caddy, which enforces the HMAC token check on all `/_proliferate/*` routes.

---

## 8. Acceptance Gates for V1 Launch

* [ ] **Monaco FS Integration:** Remove VS Code Server completely. Ensure Monaco loads files natively via `GET /fs/read` in under 200ms.
* [ ] **Terminal Replay:** Killing and refreshing the browser tab must successfully restore the active `bash` terminal output history without dropping lines.
* [ ] **Event-Driven UI:** Modifying a file via the terminal inside the sandbox must instantly ( < 100ms ) highlight the file in the React Git Sidebar without UI polling.
* [ ] **Dynamic Port Leasing:** Running `python -m http.server 8080` in the sandbox terminal must automatically update Caddy and trigger a `preview_ready` event to the frontend.