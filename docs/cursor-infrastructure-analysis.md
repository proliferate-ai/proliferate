# Cursor Background Agents — Infrastructure Analysis

> Reverse-engineered from inside a live Cursor Background Agent sandbox container, February 2025.
> All findings are from publicly observable system state: process lists, environment variables,
> binary strings, filesystem layout, and network configuration. No binaries were decompiled.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Platform Overview — "AnyRun"](#platform-overview--anyrun)
3. [Architecture Diagram](#architecture-diagram)
4. [Layer 1: Control Plane](#layer-1-control-plane)
5. [Layer 2: Node / Host](#layer-2-node--host)
6. [Layer 3: Pod (Container)](#layer-3-pod-container)
7. [Layer 4: Pod-Daemon (Rust Init Process)](#layer-4-pod-daemon-rust-init-process)
8. [Layer 5: Exec-Daemon (Node.js IDE Bridge)](#layer-5-exec-daemon-nodejs-ide-bridge)
9. [Layer 6: Desktop & Browser Stack](#layer-6-desktop--browser-stack)
10. [Layer 7: Docker-in-Docker](#layer-7-docker-in-docker)
11. [Checkpoint / Snapshot System](#checkpoint--snapshot-system)
12. [Networking & Security](#networking--security)
13. [Secret Injection Model](#secret-injection-model)
14. [Protobuf Schema (Reconstructed)](#protobuf-schema-reconstructed)
15. [Technology Stack Summary](#technology-stack-summary)
16. [Agent Execution Flow](#agent-execution-flow)
17. [Why They Built Custom (vs Modal/E2B/Fly)](#why-they-built-custom)
18. [Raw Evidence](#raw-evidence)

---

## Executive Summary

Cursor built a custom container orchestration platform called **AnyRun** (internal codename, visible in gRPC service names and protobuf namespaces). It is purpose-built for interactive dev environment sandboxes with:

- A **Rust-based init process** (`pod-daemon`) that manages process lifecycle via gRPC
- A **Node.js IDE bridge** (`exec-daemon`) that connects the Cursor IDE to the container
- **Checkpoint/restore** for pausing and resuming sandboxes across nodes
- **Multi-node scheduling** with heartbeat-based health checking
- A **full desktop environment** (VNC + XFCE + Chrome) for browser automation
- **Docker-in-Docker** for running user containers (databases, etc.) inside the sandbox
- **Fine-grained network controls** (egress restriction, port leasing)

The platform is NOT built on Kubernetes, Fly Machines, Firecracker, or any public sandbox provider. It runs Docker containers on a managed fleet of VMs (likely AWS EC2).

---

## Platform Overview — "AnyRun"

The internal platform is namespaced under `anyrun.v1` in their gRPC/protobuf definitions. Key evidence:

```
/anyrun.v1.PodDaemonService/CreateProcess
/anyrun.v1.PodDaemonService/AttachProcess
```

Source path references in the binary: `/app/pod-daemon/src/` — suggesting a monorepo structure where `pod-daemon` is an application within a larger `/app/` workspace.

The name "AnyRun" likely refers to running any code, anywhere — consistent with a general-purpose sandbox platform.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     Cursor Cloud                                 │
│                                                                  │
│  ┌─────────────┐         ┌──────────────────┐                    │
│  │ Cursor IDE  │◄───────►│  AnyRun Control  │                    │
│  │ (Electron)  │         │  Plane           │                    │
│  └─────────────┘         └────────┬─────────┘                    │
│                                   │                              │
│              ┌────────────────────┼────────────────────┐         │
│              │                    │                    │         │
│        ┌─────▼──────┐      ┌─────▼──────┐      ┌─────▼──────┐  │
│        │  Node A    │      │  Node B    │      │  Node C    │  │
│        │  (EC2 VM)  │      │  (EC2 VM)  │      │  (EC2 VM)  │  │
│        │            │      │            │      │            │  │
│        │ ┌────────┐ │      │ ┌────────┐ │      │ ┌────────┐ │  │
│        │ │ Pod 1  │ │      │ │ Pod 3  │ │      │ │ Pod 5  │ │  │
│        │ │ Pod 2  │ │      │ │ Pod 4  │ │      │ │ Pod 6  │ │  │
│        │ └────────┘ │      │ └────────┘ │      │ └────────┘ │  │
│        └────────────┘      └────────────┘      └────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Per-Pod Internal Architecture:
┌─────────────────────────────────────────────────────┐
│  Docker Container ("Pod")                           │
│                                                     │
│  PID 1: /pod-daemon (Rust)         :26500 gRPC      │
│    ├── ProcessManager                               │
│    │     ├── CreateProcess (spawn + capture)         │
│    │     └── AttachProcess (stream + replay)         │
│    └── Lifecycle (SIGTERM → graceful → SIGKILL)     │
│                                                     │
│  /exec-daemon/node (Node.js)                        │
│    ├── @anysphere/exec-daemon-runtime               │
│    ├── cursorsandbox (agent tooling binary)          │
│    ├── pty.node (pseudo-terminal)                    │
│    ├── rg (ripgrep)                                  │
│    └── gh (GitHub CLI)                               │
│                                                     │
│  Desktop Stack                                      │
│    ├── Xtigervnc :1 (X11 server)                    │
│    ├── xfce4-session (window manager)                │
│    ├── websockify (WebSocket → VNC)                  │
│    ├── plank (dock)                                  │
│    └── google-chrome + playwright                    │
│                                                     │
│  Docker-in-Docker                                   │
│    ├── dockerd (Docker daemon)                       │
│    ├── containerd                                    │
│    └── fuse-overlayfs (storage driver)               │
│                                                     │
│  /workspace/ (cloned user repository)               │
└─────────────────────────────────────────────────────┘
```

---

## Layer 1: Control Plane

The control plane is not directly observable from inside the container, but its API surface is revealed through protobuf type names embedded in the pod-daemon binary.

### Node Management

The control plane manages a fleet of nodes (VMs) that host pods:

| Protobuf Type | Purpose |
|---|---|
| `ListNodesRequest` | Enumerate available nodes |
| `RegistrationInfo` | Node self-registration with the control plane |
| `DaemonPodClaimNodeRequest` | Schedule a pod onto a specific node |
| `NODE_DELETION_REASON_DEADLINE` | Node removed due to time limit |
| `NODE_DELETION_REASON_HEARTBEAT` | Node removed due to missed heartbeats |
| `REASON_UNSPECIFIED` | Default/unknown deletion reason |

**Observations:**
- Nodes are ephemeral — they have deadlines and heartbeat requirements
- Scheduling is explicit (claim-based), not passive
- The control plane likely maintains a node registry with capacity/health state

### Pod Lifecycle

| Protobuf Type | Purpose |
|---|---|
| `PodEntity` | Core pod data structure |
| `PodStatus` | Current status of a pod |
| `PodRunningStatus` | Sub-states while pod is running |
| `PodHeartbeatInfo` | Health/liveness signal from pod |
| `PodUpdate` | Status change notification |
| `PodFilter` | Query/filter pods |
| `ResumePodRequest` | Resume a paused/checkpointed pod |
| `DeletePodRequest` | Destroy a pod |
| `ForkedPodDeletePodRequest` | Delete a forked pod variant |
| `should_hibernate` | Flag indicating pod should be hibernated |

**Pod state machine (inferred):**
```
Creating → Running → Hibernating → Checkpointed → Resuming → Running
                  │                                            │
                  └──────────── Deleting ◄─────────────────────┘
```

### Build System

| Protobuf Type | Purpose |
|---|---|
| `BuildStepStarted` | Build progress tracking |
| `ImagePullStarted` | Container image pull tracking |
| `DevContainerSpec` | Dev container configuration |
| `prepare_commands` | Commands to run during build |
| `install_commands` | Package installation commands |

The system supports dev container specifications, suggesting compatibility with the devcontainer standard or a proprietary equivalent.

### Resource Management

| Protobuf Type | Purpose |
|---|---|
| `ResourceRequests` | CPU/memory/disk requests per pod |
| `DiskUsage` | Disk consumption tracking |
| `rootfs_file_size` | Root filesystem size |

---

## Layer 2: Node / Host

### Operating System

```
Linux cursor 6.1.147 #1 SMP PREEMPT_DYNAMIC Tue Aug  5 21:01:56 UTC 2025
x86_64 GNU/Linux
```

- **Kernel**: 6.1.147 (LTS, recent patch level)
- **Architecture**: x86_64
- **Preemption**: PREEMPT_DYNAMIC (configurable at runtime — performance flexibility)
- Likely **Amazon Linux 2023** or a custom AMI (6.1 is AL2023's kernel series)

### Cloud Provider Evidence: AWS

- **DNS resolver**: `10.0.0.2` — this is AWS VPC DNS (always at VPC CIDR base + 2)
- **Metadata service blocked**: Both AWS IMDS (`169.254.169.254`) and GCP metadata (`metadata.google.internal`) return empty — intentionally firewalled for security
- **Hostname**: `cursor` (set explicitly, not EC2 default)
- **Docker bridge**: `172.17.0.1` with `host.docker.internal` mapping

### Container Runtime

- **Docker** (not Podman, containerd standalone, or Firecracker)
- **Storage driver**: `fuse-overlayfs` (required because native overlayfs doesn't work nested inside another container or on certain filesystems)
- **iptables**: Set to legacy mode (`iptables-legacy`, `ip6tables-legacy`) — required for Docker networking in some environments

---

## Layer 3: Pod (Container)

### Base Image

```
Ubuntu 24.04.4 LTS (Noble Numbat)
```

The container runs a full Ubuntu userspace with:
- systemd available but NOT used as init (pod-daemon is PID 1 instead)
- D-Bus running (for desktop environment)
- polkit available (for privilege management)
- Rust toolchain installed (`CARGO_HOME=/usr/local/cargo`, `RUSTUP_HOME=/usr/local/rustup`, Rust 1.83.0)
- Node.js 22.22.0 via NVM
- pnpm 8.15.1
- Go installed (`CARGO_HOME`, `.cache/go-build`)
- Python 3 (for websockify)

### Container Properties

```
Container ID: b965d1533983aa547ac6faf1779f2787f203c959ab7869ec42a95a1d987c510b
Hostname: cursor
User: ubuntu (uid likely 1000)
Shell: /bin/bash
Locale: en_US.UTF-8
```

### Filesystem Layout

| Path | Purpose |
|---|---|
| `/pod-daemon` | Rust init binary (PID 1) |
| `/exec-daemon/` | Node.js IDE bridge + bundled tools |
| `/workspace/` | Cloned user repository |
| `/home/ubuntu/` | User home directory |
| `/usr/local/bin/anyos-setup` | Container setup script |
| `/usr/local/bin/set-resolution` | VNC resolution configuration |
| `/usr/local/bin/chrome` | Chrome wrapper script |
| `/usr/local/bin/nvm-init.sh` | NVM initialization |
| `/.dockerenv` | Docker container marker |

### Process Tree (Full)

```
PID 1    root     /pod-daemon                           # Custom Rust init
PID 351  ubuntu   /exec-daemon/node /exec-daemon/...    # Node.js IDE bridge (196MB RSS)
PID 807  ubuntu   /bin/bash /usr/local/...              # Startup script
PID 838  message+ /usr/bin/dbus-daemon                  # D-Bus system bus
PID 928  ubuntu   /usr/bin/perl /usr/...                # Perl helper (likely tigervnc launcher)
PID 929  ubuntu   /usr/bin/Xtigervnc                    # VNC X11 server (75MB RSS)
PID 932  ubuntu   xfce4-session                         # Desktop session manager (84MB RSS)
PID 948  ubuntu   dbus-launch --autolaunch              # Session D-Bus
PID 949  ubuntu   /usr/bin/dbus-daemon                  # Session D-Bus daemon
PID 951  ubuntu   /usr/libexec/at-spi2-registryd        # Accessibility
PID 957  ubuntu   /usr/bin/dbus-daemon                  # Another D-Bus instance
PID 970  ubuntu   /usr/libexec/at-spi2-registryd        # Accessibility
PID 977  ubuntu   /usr/bin/ssh-agent                    # SSH agent
PID 983  ubuntu   /usr/bin/gpg-agent                    # GPG agent
PID 984  ubuntu   xfwm4                                 # XFCE window manager (123MB RSS)
PID 1198 ubuntu   xfsettingsd                           # XFCE settings daemon
PID 1218 ubuntu   xfce4-panel                           # XFCE panel
PID 1224 ubuntu   Thunar --daemon                       # File manager
PID 1230 ubuntu   xfdesktop                             # Desktop manager
PID 1359 ubuntu   /bin/bash                             # User terminal (pts/0)
PID 2041 ubuntu   bash /usr/local/nov...                # noVNC launcher script
PID 2045 ubuntu   /bin/bash /usr/local/...              # Helper script
PID 2068 ubuntu   python3 -m websockify                 # WebSocket→VNC bridge (38MB RSS)
PID 2075 ubuntu   plank                                 # Dock application
PID 2086 ubuntu   tail -f /dev/null                     # Keep-alive process
PID 2096 ubuntu   /bin/bash /usr/lib/...                # polkit helper
PID 2097 ubuntu   /usr/lib/x86_64-lin...                # polkit agent
PID 2113 ubuntu   /usr/libexec/dconf-service            # Settings backend
PID 3181 root     /usr/libexec/packagekitd              # Package manager daemon
PID 3187 polkitd  /usr/lib/polkit-1/polkitd             # Polkit authority
PID 4797 root     sudo dockerd                          # Docker daemon (via sudo)
PID 4799 root     dockerd                               # Docker Engine (89MB RSS)
PID 4808 root     containerd                            # Container runtime (48MB RSS)
PID 6101 root     fuse-overlayfs -o l...                # Overlay filesystem (for inner containers)
PID 6102 root     fuse-overlayfs -o l...                # Overlay filesystem
PID 6123 root     containerd-shim                       # Container shim (postgres)
PID 6130 root     containerd-shim                       # Container shim (redis)
PID 6175 70       postgres                              # PostgreSQL 15 (inner container)
PID 6176 999      redis-server *:6379                   # Redis 7 (inner container)
PID 6219 root     docker-proxy                          # Port forward (postgres 5432)
PID 6225 root     docker-proxy                          # Port forward
PID 6257 root     docker-proxy                          # Port forward (redis 6379)
PID 6264 root     docker-proxy                          # Port forward
```

**Total memory footprint estimate**: ~800MB for the base pod (before user workloads).

---

## Layer 4: Pod-Daemon (Rust Init Process)

### Binary Properties

```
/pod-daemon: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV),
             static-pie linked, BuildID[sha1]=ec34b66bb9b86cec4285a29cc1a869f014b4c6b3,
             not stripped
```

- **Statically linked** (no external .so dependencies — runs on any Linux)
- **PIE** (Position Independent Executable — ASLR compatible)
- **Not stripped** (debug symbols present — function names visible via `nm`/`readelf`)
- Source directory: `/app/pod-daemon/src/`

### Source File References

| File | Purpose |
|---|---|
| `pod-daemon/src/main.rs` | Entry point, config parsing, gRPC server startup |
| `pod-daemon/src/server.rs` | gRPC service implementation |
| `pod-daemon/src/process_manager.rs` | Process lifecycle, spawn, attach, stream, signal handling |
| `pod-daemon/src/config.rs` | CLI argument parsing and configuration |

### Technology Stack

| Crate | Version | Purpose |
|---|---|---|
| `tonic` | 0.13.1 | gRPC framework |
| `axum` | 0.8.8 | HTTP framework (likely for health/metrics endpoints) |
| `tokio` | 1.48.0 | Async runtime |
| `hyper` | 1.8.1 | HTTP/1.1 and HTTP/2 |
| `hyper-util` | 0.1.19 | Hyper utilities |
| `h2` | 0.4.12 | HTTP/2 protocol implementation |
| `rustls` | 0.23.35 | TLS (no OpenSSL dependency) |
| `prost` | 0.13.5 | Protobuf serialization |
| `bytes` | 1.11.0 | Zero-copy byte buffers |
| `mio` | 1.1.1 | Low-level I/O (epoll/kqueue) |
| `tracing` | - | Structured logging/tracing |
| `tracing-subscriber` | 0.3.22 | Log output formatting + filtering |
| `clap` | 3.2.25 | CLI argument parsing |
| `dashmap` | 6.1.0 | Concurrent hash map |
| `indexmap` | 1.9.3 | Ordered hash map |
| `futures-channel` | 0.3.31 | Async channels |
| `async-stream` | 0.3.6 | Async stream helpers |
| `uuid` | 1.19.0 | UUID generation |
| `matchit` | 0.8.4 | URL router (for Axum) |
| `sharded-slab` | 0.1.7 | Concurrent slab allocator |

### gRPC Service Definition

```protobuf
// Reconstructed from binary strings
service PodDaemonService {
  rpc CreateProcess(CreateProcessRequest) returns (CreateProcessResponse);
  rpc AttachProcess(AttachProcessRequest) returns (stream AttachProcessEvent);
}
```

**gRPC endpoint**: `0.0.0.0:26500`

### Configuration (CLI Arguments)

| Argument | Env Var | Default | Description |
|---|---|---|---|
| `--listen-addr` | `LISTEN_ADDR` | `0.0.0.0:26500` | gRPC server listen address |
| `--max-processes` | `MAX_PROCESSES` | `100` | Maximum concurrent processes |
| `--stream-buffer-size` | `STREAM_BUFFER_SIZE` | `8192` | Buffer size for process output streams |
| `--max-events-per-process` | `MAX_EVENTS_PER_PROCESS` | `10000` | Event replay buffer per process |
| `--enable-metrics` | - | (flag) | Enable metrics collection |
| `--log-level` | `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error) |

Also reads `NO_COLOR` env var for disabling colored output.

### Process Manager Behavior

**Creating a process:**
```
CreateProcess(command, working_directory, env, user) → pid
```
- Validates command is not empty
- Resolves user by name (looks up uid/gid)
- Sets `SHELL` env var
- Sets `PATH` to `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
- Spawns process, captures stdout and stderr separately
- Logs: `"Creating process {name} with command {cmd} as user {user} (uid: {uid}, gid: {gid})"`

**Attaching to a process:**
```
AttachProcess(pid, last_event_id) → stream of events
```
- Supports reconnection via `last_event_id` — replays events from the ring buffer
- Each process maintains up to 10,000 events (configurable)
- Events are tagged with sequential IDs
- Streams stdout and stderr as separate event types
- Logs process exit status

**Shutdown sequence:**
1. Receive SIGTERM (or Ctrl+C)
2. Log `"Shutting down ProcessManager, terminating {n} processes"`
3. Send SIGTERM to all child processes
4. Wait up to 5 seconds for graceful exit
5. If timeout: send SIGKILL to remaining processes (`"Force killing process {name} (raw PID {pid})"`)
6. Log `"ProcessManager shutdown complete"`
7. Log `"Pod daemon shutdown complete"`

**Error handling:**
- Failed spawns: `"Failed to spawn process (user: {user}, command: {cmd}): {err}"`
- Failed signal delivery: `"Failed to send SIGTERM/SIGKILL to process: {err}"`
- Stream errors: logged and propagated to gRPC client

### Startup Log Format

```
Starting pod-daemon with config: {config}
Metrics collection enabled
Pod daemon listening on {addr}
Starting gRPC server, press Ctrl+C to stop
```

---

## Layer 5: Exec-Daemon (Node.js IDE Bridge)

### Package Identity

```json
{
  "name": "@anysphere/exec-daemon-runtime",
  "private": true,
  "gitCommit": "5cde7e05b646c0ab462aca8196d689636825cf78",
  "buildTimestamp": "2026-02-25T00:18:44.047Z"
}
```

- **Publisher**: `@anysphere` (Anysphere Inc. — Cursor's parent company)
- **Private package** (not published to npm)
- **Build system**: Webpack (evidenced by numbered chunk files)

### Directory Contents

| File | Size | Purpose |
|---|---|---|
| `node` | 123 MB | Standalone Node.js binary (not system Node) |
| `index.js` | 15 MB | Main webpack bundle |
| `252.index.js` | 4.3 KB | Webpack async chunk |
| `407.index.js` | 4.3 KB | Webpack async chunk |
| `511.index.js` | 4.0 KB | Webpack async chunk |
| `953.index.js` | 1.6 KB | Webpack async chunk |
| `980.index.js` | 2.1 KB | Webpack async chunk |
| `cursorsandbox` | 4.5 MB | Agent tool execution binary |
| `pty.node` | 72 KB | Native Node addon for pseudo-terminal emulation |
| `rg` | 5.4 MB | ripgrep (code search) |
| `gh` | 55 MB | GitHub CLI |
| `97f64a4d8eca9a2e35bb.mp4` | 63 KB | Asset (likely loading animation) |
| `exec_daemon_version` | 165 B | Version/build info |
| `exec-daemon` | 327 B | Shell launcher script |
| `package.json` | 173 B | Package metadata |

**Total size**: ~207 MB

### Key Observations

- Ships its own Node.js binary (123MB) rather than relying on system Node — ensures version consistency
- `pty.node` is a native addon for pseudo-terminal support — this is how the agent gets interactive terminal sessions
- `cursorsandbox` (4.5MB) is a separate compiled binary — likely Go or Rust — that handles sandbox-specific agent tooling (file operations, search integration, etc.)
- `rg` (ripgrep) is bundled for fast code search
- `gh` (GitHub CLI) is bundled and symlinked to `/usr/local/bin/gh` for GitHub operations
- The exec-daemon script at `/exec-daemon/exec-daemon` (327 bytes) is a shell script that launches `node index.js`

### How It Works (Inferred)

1. Exec-daemon starts as a long-running Node.js process (PID 351, 196MB RSS)
2. Connects to the Cursor cloud backend (likely WebSocket or HTTP long-poll)
3. Receives commands from the IDE (terminal input, file operations, agent tool calls)
4. For terminal/process operations: makes gRPC calls to pod-daemon on `:26500`
5. For file operations: uses `cursorsandbox` binary or direct filesystem access
6. For code search: uses bundled `rg`
7. For GitHub operations: uses bundled `gh`
8. Streams results back to the Cursor cloud → IDE

---

## Layer 6: Desktop & Browser Stack

### Purpose

The desktop environment enables the agent to use a web browser — for previewing web apps, interacting with web UIs, taking screenshots, and general browser automation. This is a key differentiator from terminal-only sandboxes.

### Components

| Component | Process | Purpose |
|---|---|---|
| **Xtigervnc** | PID 929, 75MB RSS | Virtual X11 server on display `:1` |
| **xfce4-session** | PID 932, 84MB RSS | Lightweight desktop session manager |
| **xfwm4** | PID 984, 123MB RSS | XFCE window manager |
| **xfce4-panel** | PID 1218 | Desktop panel/taskbar |
| **xfdesktop** | PID 1230 | Desktop background/icons |
| **Thunar** | PID 1224 | File manager (daemon mode) |
| **plank** | PID 2075 | macOS-style dock |
| **xfsettingsd** | PID 1198 | Settings daemon |
| **websockify** | PID 2068, 38MB RSS | WebSocket to VNC protocol bridge |
| **Google Chrome** | (launched on demand) | Web browser with Playwright |

### Configuration

```
VNC_RESOLUTION=1920x1200x24    # 1920x1200, 24-bit color
VNC_DPI=96                      # Standard DPI
DISPLAY=:1                      # X11 display number
```

### VNC Access

- **VNC server**: Xtigervnc on display `:1` (port 5901)
- **WebSocket bridge**: websockify converts WebSocket connections to VNC protocol
- This enables noVNC (browser-based VNC client) for users to view the desktop
- PID file at `~/.vnc/cursor:1.pid`, log at `~/.vnc/cursor:1.log`

### Browser Automation

- **Google Chrome** installed with wrapper scripts at `/usr/local/bin/chrome` and `/usr/local/bin/google-chrome`
- **Playwright** available (`google-chrome-playwright` config directory present)
- Chrome is launched on the VNC display when the agent needs browser access
- The agent can take screenshots, click elements, fill forms, navigate pages

### Helper Scripts

| Script | Size | Purpose |
|---|---|---|
| `/usr/local/bin/anyos-setup` | 3.5 KB | Container initialization and setup |
| `/usr/local/bin/set-resolution` | 822 B | Dynamic VNC resolution changes |
| `/usr/local/bin/chrome` | 675 B | Chrome launch wrapper |
| `/usr/local/bin/google-chrome` | 675 B | Chrome launch wrapper (alias) |
| `/usr/local/bin/nvm-init.sh` | 216 B | NVM initialization script |

---

## Layer 7: Docker-in-Docker

### Why

Many real-world repositories include `docker-compose.yml` files for local development (databases, caches, message queues, etc.). The sandbox must support running Docker containers to properly set up development environments.

### Implementation

```
PID 4797  root  sudo dockerd              # Docker daemon (started via sudo)
PID 4799  root  dockerd                    # Docker Engine (89MB RSS)
PID 4808  root  containerd                 # Container runtime (48MB RSS)
PID 6101  root  fuse-overlayfs             # Overlay storage for inner containers
PID 6102  root  fuse-overlayfs             # Overlay storage for inner containers
```

- **Storage driver**: `fuse-overlayfs` (required for nested Docker — native overlayfs doesn't work inside a Docker container)
- **iptables**: Set to legacy mode (`iptables-legacy`) for Docker networking compatibility
- Docker daemon started with `sudo` by the ubuntu user (not rootless Docker)

### Observed Inner Containers

The Cursor agent (when setting up Proliferate's dev environment) started:

| Container | Image | Ports |
|---|---|---|
| postgres | `postgres:15-alpine` | 5432 |
| redis | `redis:7-alpine` | 6379 |

These were started via `docker compose up -d postgres redis` from the workspace's `docker-compose.yml`.

---

## Checkpoint / Snapshot System

This is arguably the most interesting part of the infrastructure — it's what enables fast pause/resume of dev environments.

### Protobuf Types (from binary strings)

| Type | Purpose |
|---|---|
| `CheckpointEntity` | A checkpoint record |
| `CheckpointFilter` | Query checkpoints |
| `CheckpointOffer` | Offered checkpoint for a pod |
| `ExternalSnapshot` | Snapshot stored externally (object storage) |
| `SnapshotProgress` | Upload/download progress tracking |
| `BlockSnapshot` | Block-level snapshot |
| `UploadTarRequest` | Upload snapshot as tar archive |
| `state_file_chunk` | Chunked state file transfer |
| `rootfs_file_size` | Root filesystem size tracking |
| `allow_cross_node` | Whether snapshot can restore on a different node |
| `persistent_state` | Persistent state across checkpoint/restore cycles |

### Snapshot State Machine (Inferred)

```
SNAPSHOT_STATE_CREATING → SNAPSHOT_STATE_UPLOADING → SNAPSHOT_STATE_COMPLETED
                                                  └→ SNAPSHOT_STATE_FAILED
```

### Transfer States

```
TRANSFER_STATE_TRANSFERRING → TRANSFER_STATE_COMPLETED
                           └→ TRANSFER_STATE_FAILED
```

### How It Likely Works

1. **Checkpoint trigger**: Control plane signals pod to checkpoint (idle timeout, user pause, or cost optimization)
2. **Filesystem snapshot**: Root filesystem is captured (likely via `docker commit` or direct overlayfs snapshotting)
3. **State capture**: Process state may be captured via CRIU (Checkpoint/Restore In Userspace), or they may simply kill processes and rely on the filesystem state
4. **Tar + upload**: Filesystem is tarred and uploaded to object storage (likely S3 given AWS hosting)
5. **Metadata**: Checkpoint entity is stored with pod association, node origin, size, and `allow_cross_node` flag
6. **Resume**: On resume, control plane picks a node (same or different if `allow_cross_node`), pulls the snapshot tar, extracts it, starts a new container with the restored filesystem
7. **Process restart**: Pod-daemon starts fresh, exec-daemon reconnects, user processes are re-launched from saved state or devcontainer commands

### Cross-Node Migration

The `allow_cross_node` flag and `DaemonPodClaimNodeRequest` together enable:
- Checkpointing on Node A
- Restoring on Node B (where resources are available)
- This is critical for cluster utilization — pods don't need sticky node affinity

### Block-Level Snapshots

`BlockSnapshot` and `BlkMnt` types suggest they may also support block-level snapshots (not just filesystem tar) — possibly using device mapper or a block storage backend for faster snapshot/restore of large filesystems.

---

## Networking & Security

### Network Configuration

```
# /etc/hosts
127.0.0.1       localhost
::1             localhost ip6-localhost ip6-loopback
127.0.0.1       cursor
172.17.0.1      host.docker.internal

# /etc/resolv.conf
nameserver 10.0.0.2    # AWS VPC DNS
```

### Security Measures

1. **Cloud metadata blocked**: Both AWS IMDS and GCP metadata endpoints are firewalled — prevents SSRF attacks from extracting instance credentials
2. **Egress restriction**: `EgressRestricted` protobuf type indicates per-pod network policy enforcement
3. **Port leasing**: `PortState` and `PortLease` — dynamic port allocation and exposure control
4. **No raw network access**: Containers are on a Docker bridge network with controlled routing

### Port Management (from protobuf types)

| Type | Purpose |
|---|---|
| `PortState` | Current state of a port (open/closed/leased) |
| `PortLease` | Port allocation record |

This enables:
- Preview URLs for web apps running in the sandbox
- Controlled exposure of development servers
- Port forwarding from the sandbox to the user's browser

---

## Secret Injection Model

### How Secrets Enter the Container

Cursor injects user project secrets as environment variables. Two metadata variables track what was injected:

1. **`CLOUD_AGENT_ALL_SECRET_NAMES`** — Complete list of secret names available for the project
2. **`CLOUD_AGENT_INJECTED_SECRET_NAMES`** — Subset actually injected into this container

The difference between these two lists reveals which secrets exist but were not injected (possibly due to permissions or optional configuration).

### Injection Mechanism

Secrets are set as container environment variables at creation time. They're visible to all processes in the container (via `/proc/1/environ`, `/proc/351/environ`, and `env`). This is a simple but effective approach — no secret mounting, no sidecar, no vault integration.

### Security Concern

All secrets are visible to any process in the container, including user code. There's no isolation between the agent and user-provided code running in the same container. This is a known tradeoff of environment-variable-based secret injection.

---

## Protobuf Schema (Reconstructed)

Based on all strings extracted from the pod-daemon binary, here is the reconstructed protobuf schema:

```protobuf
// Reconstructed — not actual source code
// Namespace: anyrun.v1

syntax = "proto3";
package anyrun.v1;

// === Pod Daemon Service (runs inside each container) ===

service PodDaemonService {
  rpc CreateProcess(CreateProcessRequest) returns (CreateProcessResponse);
  rpc AttachProcess(AttachProcessRequest) returns (stream ProcessEvent);
}

message CreateProcessRequest {
  string command = 1;
  string working_directory = 2;
  map<string, string> env = 3;
  string user = 4;  // username, resolved to uid/gid
}

message AttachProcessRequest {
  string pid = 1;
  string last_event_id = 2;  // for replay
}

message ProcessEvent {
  string message = 1;
  bool is_stdout = 2;  // vs stderr
  // event ID implicit in stream ordering
}

// === Control Plane Types (inferred from embedded strings) ===

message PodEntity {
  PodStatus status = 1;
  PodHeartbeatInfo heartbeat = 2;
  bool should_hibernate = 3;
  string resource_version = 4;
}

message PodStatus {
  PodRunningStatus running_status = 1;
}

enum PodRunningStatus {
  POD_RUNNING_STATUS_UNSPECIFIED = 0;
  // CREATING, RUNNING, PAUSED, STOPPED, FAILED (inferred from
  // CONTAINER_STATE prefixes: CREATING, RUNNING, STOPPED, PAUSED, FAILED)
}

message PodHeartbeatInfo {}

message PodUpdate {
  PodStatus status = 1;
}

message PodFilter {}

message ResumePodRequest {}
message DeletePodRequest {}
message ForkedPodDeletePodRequest {}

message DaemonPodClaimNodeRequest {}
message ListNodesRequest {}
message RegistrationInfo {}

// === Checkpoint / Snapshot ===

message CheckpointEntity {
  // SNAPSHOT_STATE_CREATING, _COMPLETED, _FAILED
}

message CheckpointFilter {}

// "CheckpointOffer" — offered to a pod for restore

message ExternalSnapshot {
  string rootfs_file_size = 1;
}

message SnapshotProgress {}
message BlockSnapshot {}  // BlkMnt

message UploadTarRequest {
  bytes state_file_chunk = 1;
}

// === Build System ===

message DevContainerSpec {
  repeated string prepare_commands = 1;
  repeated string install_commands = 2;
  repeated string command_handlers = 3;
}

message BuildStepStarted {}
message ImagePullStarted {}

// === Resources & Ports ===

message ResourceRequests {}
message DiskUsage {}

message PortState {}
message PortLease {}

message EgressRestricted {}

// === Node Management ===

enum NodeDeletionReason {
  REASON_UNSPECIFIED = 0;
  NODE_DELETION_REASON_DEADLINE = 1;
  NODE_DELETION_REASON_HEARTBEAT = 2;
}
```

---

## Technology Stack Summary

### Pod-Daemon (Rust)

| Component | Choice |
|---|---|
| Language | Rust (1.83.0) |
| Async runtime | Tokio 1.48.0 |
| gRPC | Tonic 0.13.1 |
| HTTP | Axum 0.8.8 + Hyper 1.8.1 |
| Protobuf | Prost 0.13.5 |
| TLS | Rustls 0.23.35 |
| Logging | tracing + tracing-subscriber 0.3.22 |
| CLI | clap 3.2.25 |
| Concurrency | dashmap 6.1.0, sharded-slab 0.1.7 |
| Build target | `x86_64-unknown-linux-musl` (static linking) |

### Exec-Daemon (Node.js)

| Component | Choice |
|---|---|
| Runtime | Node.js 22.22.0 (bundled binary) |
| Package | `@anysphere/exec-daemon-runtime` |
| Bundler | Webpack |
| Terminal | pty.node (native addon) |
| Code search | ripgrep (bundled) |
| GitHub | gh CLI (bundled) |
| Agent tools | cursorsandbox binary (bundled) |

### Container Environment

| Component | Choice |
|---|---|
| Base OS | Ubuntu 24.04.4 LTS |
| Display server | Xtigervnc |
| Desktop | XFCE4 |
| WebSocket bridge | websockify (Python) |
| Browser | Google Chrome + Playwright |
| Docker | Docker Engine + fuse-overlayfs |
| Inner containers | postgres:15-alpine, redis:7-alpine |

### Infrastructure (Inferred)

| Component | Choice |
|---|---|
| Cloud | AWS (EC2 + VPC) |
| Node VMs | EC2 instances (likely c/m-series) |
| Object storage | S3 (for snapshots) |
| Container runtime | Docker |
| Orchestration | Custom ("AnyRun") |
| Init system | Custom (pod-daemon) |

---

## Agent Execution Flow

### Session Creation

```
1. User creates background agent task in Cursor IDE
2. Control plane receives request
3. Scheduler finds available node (ListNodes → ClaimNode)
     - Prefers node with cached image or recent snapshot
4. Node agent pulls container image (ImagePullStarted)
5. Container created with:
     - /pod-daemon as PID 1 (entrypoint)
     - Env vars injected (secrets + config)
     - /workspace volume (or clone target)
6. Pod-daemon starts → gRPC server on :26500
7. Init scripts run:
     - anyos-setup (container initialization)
     - VNC + XFCE desktop start
     - websockify starts
     - Docker-in-Docker starts
8. Exec-daemon starts → connects to Cursor cloud
9. Repo cloned into /workspace (GIT_LFS_SKIP_SMUDGE=1)
10. BuildStepStarted → DevContainerSpec → prepare_commands → install_commands
11. Pod status → Running, heartbeat begins
12. Agent begins executing user task
```

### During Execution

```
1. Cursor IDE sends command to cloud backend
2. Cloud backend forwards to exec-daemon (in container)
3. Exec-daemon translates to gRPC CreateProcess call to pod-daemon
4. Pod-daemon spawns process, captures stdout/stderr
5. Output streamed back: pod-daemon → exec-daemon → cloud → IDE
6. For reconnections: AttachProcess with last_event_id replays missed events
7. Agent uses tools:
     - Terminal: CreateProcess via pod-daemon
     - File search: rg (ripgrep)
     - GitHub: gh CLI
     - File operations: cursorsandbox binary
     - Browser: Chrome on VNC display via Playwright
```

### Pause / Hibernate

```
1. Pod idle timeout reached (or user pauses)
2. Control plane sets should_hibernate = true
3. Inner containers stopped (docker stop)
4. Filesystem snapshot begins (SNAPSHOT_STATE_CREATING)
5. Tar created from rootfs
6. Upload to object storage (UploadTarRequest, state_file_chunk)
7. Snapshot state → COMPLETED (or FAILED)
8. Container stopped and removed
9. Node resources freed
```

### Resume

```
1. User resumes agent session
2. Control plane picks node (allow_cross_node check)
3. Snapshot pulled to node
4. Tar extracted to container rootfs
5. New container started with restored filesystem
6. Pod-daemon starts fresh (new PID 1)
7. Exec-daemon starts, reconnects to cloud
8. Desktop stack restarts
9. Docker-in-Docker restarts
10. DevContainerSpec commands re-run if needed
11. Agent continues from where it left off (persistent_state)
```

---

## Why They Built Custom

### vs. Modal
- Modal is designed for serverless function execution, not long-lived interactive dev environments
- Modal's snapshot system optimizes cold start, not interactive pause/resume
- No Docker-in-Docker support in Modal containers
- No VNC/desktop environment support
- No fine-grained process streaming with event replay
- At Cursor's scale, Modal's per-second pricing is prohibitively expensive

### vs. E2B
- E2B's pause/resume is a black box — can't control snapshot pipeline, storage, or cross-node scheduling
- Limited control over network policy (egress restriction, port leasing)
- Docker-in-Docker support is limited/unreliable
- Can't optimize node placement for snapshot locality
- Vendor lock-in for a core product capability

### vs. Fly Machines
- Fly Machines have basic stop/start but not filesystem-level checkpoint/restore
- Limited control over the container runtime and storage driver
- No gRPC-based process management — would need to build it anyway
- Networking model is different (Anycast-based vs. VPC-based)

### vs. Kubernetes
- K8s is heavy — kubelet alone uses 100MB+ RAM per node
- K8s pod startup is slow (seconds to tens of seconds)
- No native checkpoint/restore (CRIU support is experimental in K8s 1.30+)
- K8s scheduling is generic — can't optimize for snapshot locality
- Process streaming with event replay would need a custom sidecar anyway
- For Cursor's specific use case, K8s adds overhead without solving the hard problems

### The real reason
The sandbox runtime IS Cursor's product. Speed of environment setup, reliability of process streaming, cost of keeping sandboxes warm, and seamless pause/resume are all directly user-facing quality metrics. Outsourcing to a provider caps product quality at the provider's limitations and roadmap.

---

## Raw Evidence

### Container Identity

```
Container ID: b965d1533983aa547ac6faf1779f2787f203c959ab7869ec42a95a1d987c510b
Hostname: cursor
Kernel: 6.1.147 #1 SMP PREEMPT_DYNAMIC Tue Aug  5 21:01:56 UTC 2025
OS: Ubuntu 24.04.4 LTS (Noble Numbat)
Arch: x86_64
```

### Pod-Daemon Binary Analysis

```
Type: ELF 64-bit LSB pie executable, x86-64, static-pie linked, not stripped
Build target: x86_64-unknown-linux-musl
Build path: /app/target/x86_64-unknown-linux-musl/release/
Protobuf codegen: /app/target/x86_64-unknown-linux-musl/release/build/tonic-proto-*/out/anyrun.v1.rs
Source files:
  - pod-daemon/src/main.rs
  - pod-daemon/src/server.rs (lines 55, 70, 86, 90)
  - pod-daemon/src/process_manager.rs (lines 79, 220, 229, 239, 250, 265, 292, 301, 316, 337, 340, 353, 355, 393, 405, 417, 420, 431, 433, 438, 453)
  - pod-daemon/src/config.rs
Version: 0.1.0
```

### Exec-Daemon Identity

```json
{
  "name": "@anysphere/exec-daemon-runtime",
  "private": true,
  "gitCommit": "5cde7e05b646c0ab462aca8196d689636825cf78",
  "buildTimestamp": "2026-02-25T00:18:44.047Z"
}
```

### Key Environment Variables

```bash
HOSTNAME=cursor
GIT_DISCOVERY_ACROSS_FILESYSTEM=0
GIT_LFS_SKIP_SMUDGE=1
VNC_RESOLUTION=1920x1200x24
VNC_DPI=96
DISPLAY=:1
RUST_VERSION=1.83.0
CARGO_HOME=/usr/local/cargo
RUSTUP_HOME=/usr/local/rustup
NVM_DIR=/home/ubuntu/.nvm
```

### DNS/Network

```
nameserver: 10.0.0.2 (AWS VPC DNS)
host.docker.internal: 172.17.0.1
Cloud metadata: blocked (both AWS and GCP)
```

---

*Document generated from live sandbox observation. No binaries were decompiled or reverse-engineered.
All data was obtained from standard system inspection commands (ps, env, strings, file, cat).*
