# @proliferate/cli

## 0.3.9

### Patch Changes

- [`35782a2`](https://github.com/proliferate-ai/cloud/commit/35782a2de09e6c6af13db44a4229543216d23f8c) Thanks [@pablonyx](https://github.com/pablonyx)! - Sync AWS credentials (~/.aws) to sandbox

## 0.3.8

### Patch Changes

- [`b102eed`](https://github.com/proliferate-ai/cloud/commit/b102eed70ae01ebedc8b2c811eb39559c4754054) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix "missing or unsuitable terminal: xterm-ghostty" error

## 0.3.7

### Patch Changes

- [`e97c061`](https://github.com/proliferate-ai/cloud/commit/e97c0616056350edb8afbdd48f296a3e5d5c3ae9) Thanks [@pablonyx](https://github.com/pablonyx)! - Exclude SSH config from sync (macOS UseKeychain option breaks on Linux)

## 0.3.6

### Patch Changes

- [`399ae3b`](https://github.com/proliferate-ai/cloud/commit/399ae3babb33aa803c13da7bcb2d8ec7ca0b9c31) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix login/config commands hanging after completion

## 0.3.5

### Patch Changes

- [`d5ad4bc`](https://github.com/proliferate-ai/cloud/commit/d5ad4bc42a6b8beabd6a05fda4f3a305fce172ec) Thanks [@pablonyx](https://github.com/pablonyx)! - Sync SSH keys for git push/pull authentication in sandbox

## 0.3.4

### Patch Changes

- [`64b50b9`](https://github.com/proliferate-ai/cloud/commit/64b50b97e7d81b2e07996c51f8acc1932ca1b979) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix login command hanging after completion

## 0.3.3

### Patch Changes

- [`66232eb`](https://github.com/proliferate-ai/cloud/commit/66232ebe7ff2e458ac8b9bdde5ec906402976276) Thanks [@pablonyx](https://github.com/pablonyx)! - Sync ~/.gitconfig to sandbox so git commits work with user's identity

## 0.3.2

### Patch Changes

- [`8e25bda`](https://github.com/proliferate-ai/cloud/commit/8e25bda94dfca502dee2da14a26017d32c42ca6c) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix MCP servers: don't include user's local MCP servers (which have local paths that don't exist in sandbox), and fix sandbox-mcp binary path

## 0.3.1

### Patch Changes

- [`a87091c`](https://github.com/proliferate-ai/cloud/commit/a87091cd3aaaf3d7294a48e388237f415c8c4d93) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix Claude Code auth by only writing essential config fields (hasCompletedOnboarding + mcpServers) instead of the full user config which exceeded command line length limits

## 0.3.0

### Minor Changes

- [`e1d0e5c`](https://github.com/proliferate-ai/cloud/commit/e1d0e5c6643e9d6b963698801611c12aa82d0eda) Thanks [@pablonyx](https://github.com/pablonyx)! - Add tmux wrapper with preview URL status bar for better visibility of sandbox URLs

### Patch Changes

- [#86](https://github.com/proliferate-ai/cloud/pull/86) [`a25fc00`](https://github.com/proliferate-ai/cloud/commit/a25fc000f41ab89541796608005353e71648a130) Thanks [@Edwarf](https://github.com/Edwarf)! - Fix config sync and use GitHub token abstraction

  - Create parent directories on remote before syncing config files (fixes rsync errors)
  - Silence non-critical config sync errors (only log with DEBUG)
  - Use unified getGitHubTokenForIntegration() for both GitHub App and Nango

- [`7ed8e38`](https://github.com/proliferate-ai/cloud/commit/7ed8e3824591b3613a972b4a30aa536890308843) Thanks [@pablonyx](https://github.com/pablonyx)! - Fix Claude Code MCP config - merge sandbox MCP servers with user config instead of overwriting, and always set hasCompletedOnboarding to skip onboarding wizard

- [`45cc874`](https://github.com/proliferate-ai/cloud/commit/45cc874da9c638ef2128b8a510a964955cbdcaf4) Thanks [@pablonyx](https://github.com/pablonyx)! - Show uncommitted git changes info before syncing to sandbox

## 0.2.0

### Minor Changes

- [#74](https://github.com/proliferate-ai/cloud/pull/74) [`6a2531b`](https://github.com/proliferate-ai/cloud/commit/6a2531bf59287acc8183d114e492b92711345e49) Thanks [@Edwarf](https://github.com/Edwarf)! - Add persistent sessions, resume, config, and reset commands

  - `--persist` flag keeps sandbox running after disconnect using tmux
  - `proliferate resume` to reconnect to persistent sessions
  - `proliferate config` to configure sync mode and persist preference
  - `proliferate reset` to reset config/auth/all
  - Server-side session checking for faster resume
  - Smart gitignore sync excludes large directories while keeping small config files
  - Default workspace mode changed to sync (rsync local files)
