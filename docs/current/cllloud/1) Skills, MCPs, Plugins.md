## High level notes / mental model broadly

MCPs, skills, and plugins are three different concepts:

- MCP = a callable tool server. Runtime cares about server name, transport, launch/connect shape, and credential refs.
- Skill = reviewed instructions/resources. Runtime cares about metadata, required MCP server names, and artifact refs/hashes for markdown/resources.
- Plugin = product/catalog packaging. It can group MCPs, skills, credential requirements, defaults, and UI copy, but it should not cross the AnyHarness boundary.

Cloud/Desktop are the product source of truth. They decide which MCPs, skills, and plugins are enabled. AnyHarness is only the runtime projection: it stores the compiled sandbox config it needs to launch tools and serve skills.

The ideal runtime scope is sandbox/target-wide, not workspace/session-wide. Every workspace and session in a sandbox sees the same current MCP/skill set. Workspace creation should not pass MCP IDs or skill IDs. It may require a runtime config revision, and worker/Desktop should apply that revision before launch if the sandbox is stale.

Lazy resolution is not the main product flow. The main flow is eager apply on config changes. Lazy resolution is only the repair/fail-closed path when AnyHarness already has a manifest but a referenced artifact is missing, a credential is missing/expired, or local cache state was lost.

## Broad basic UX / high level questions

Personal sandbox:

- User connects MCPs, enables skills, or enables plugins.
- Enabled personal items are available in that user's personal cloud sandbox and local Desktop target.
- Turning something on/off updates the sandbox runtime config proactively.

Shared sandbox:

- Admins mark MCPs/skills/plugins public to the org.
- Public org items are available in the shared sandbox.
- Admin copy should say public items are usable by team automations, Slack, and shared cloud work.

Workspace relationship:

- Workspaces do not select tools directly in V1.
- Workspaces inherit the sandbox's current runtime config.
- Workspace-specific config remains for repo/env/setup/files, not MCP/skill selection.

Plugin relationship:

- Enabling a plugin is a convenience operation.
- Before runtime, plugin expands into flat MCP server entries and skill entries.
- AnyHarness never needs to know the plugin package exists.

## Full set of DB models and key schemas

Cloud/product source of truth:

```text
mcp_catalog_entry
  id, version, display metadata
  transport, launch template, auth/settings schema
  no user secrets

cloud_mcp_connection
  id, owner_user_id or owner_org_id
  catalog_entry_id, catalog_entry_version
  server_name
  enabled
  public_to_org
  settings_json
  config_version

cloud_mcp_connection_auth
  connection_id
  auth_kind
  auth_status: ready | needs_reconnect | error
  payload_ciphertext
  auth_version
  token_expires_at
  last_error_code

skill_catalog_entry
  id, version, display metadata
  instruction artifact source/hash
  resource artifact sources/hashes
  required_mcp_refs

cloud_skill_configured_item
  id
  owner_user_id or owner_org_id
  skill_id, skill_version
  enabled
  public_to_org

plugin_catalog_entry
  id, version, display metadata
  mcp refs
  skill refs
  default enabled children

cloud_plugin_configured_item
  id
  owner_user_id or owner_org_id
  plugin_id, plugin_version
  enabled
  public_to_org

cloud_target_runtime_config_revision
  target_id
  revision_id / sequence / content_hash
  manifest_json
  warnings_json

cloud_target_runtime_config_current
  target_id
  current_revision_id

cloud_target_runtime_config_artifact
  revision_id
  artifact_hash
  content_type
  byte_size
  payload_ciphertext
```

For V1, `enabled` and `public_to_org` live directly on the owner-specific configured item row. Do not add separate settings/mount/publication tables unless we need per-sandbox exceptions, complex consent, multi-org sharing, or audit-heavy delegation.

The split is:

```text
catalog entry
  global definition: what exists and how it works

configured item
  owner-specific state: who has it, enabled/private/public, settings/auth refs
```

AnyHarness local runtime projection:

```text
runtime_config_current
  revision_id
  content_hash
  manifest_json          # flat MCPs/skills/artifact refs/credential refs
  source
  applied_at

runtime_artifact_cache
  artifact_hash
  content_type
  byte_size
  cache_path
  created_at
  last_used_at

credential_cache
  credential_ref -> value + expires_at
  memory only, not SQLite

pending_resolution_requests
  request_id -> missing artifact/credential request
  memory only, recomputed when needed
```

Workspace/session creation request:

```text
workspace/session launch
  target/workspace/session fields
  optional required_runtime_config_revision
  no MCP ids
  no skill ids
  no plugin bundle
```

## End to end flows

Personal sandbox, enabling an MCP:

1. User connects/enables an MCP in Desktop or Cloud.
2. Cloud stores `cloud_mcp_connection` and `cloud_mcp_connection_auth`.
3. Cloud compiles the target runtime config revision.
4. Worker applies it to AnyHarness.
5. AnyHarness stores manifest, warms artifacts, stores credential values in memory.
6. Next workspace/session launches with the updated sandbox config.

Shared sandbox, public MCP/skill/plugin:

1. Admin marks the item `public_to_org`.
2. Shared sandbox resolver includes public org items.
3. Cloud compiles a shared-sandbox runtime config revision.
4. Worker applies it to the shared AnyHarness target.
5. Team automations/Slack/shared work inherit that config.

Plugin enablement:

1. User/admin enables plugin.
2. Resolver expands plugin into its MCP connections and skill definitions.
3. Runtime config contains only flat MCP servers and skills.
4. AnyHarness sees no plugin package object.

OAuth credential refresh:

1. Cloud stores refresh-capable OAuth credential encrypted.
2. When compiling/applying runtime config, Cloud asks for a ready access token.
3. If token is near expiry, Cloud refreshes it.
4. Worker fulfills AnyHarness credential refs with access token value plus `expires_at`.
5. If a live MCP later returns an auth-expired/401-style failure, AnyHarness can report credential resolution required for that ref.
6. Worker/Desktop asks Cloud for a fresh fulfillment and applies it.
7. HTTP MCPs may retry with the refreshed credential when safe.
8. Stdio MCPs usually need MCP server/session restart because env/config was fixed at process launch.
9. If refresh fails, Cloud marks credential `needs_reconnect` and the affected launch/tool path fails closed.

Fallback repair:

1. AnyHarness launches with revision R.
2. If artifact hash is missing, it requests that artifact.
3. If credential ref is missing/expired, it requests that credential.
4. Worker/Desktop fulfills from Cloud/local authority.
5. If it cannot fulfill, launch fails with a typed reconnect/missing-artifact error.

## Specific hooks

Config refresh hook:

```text
product config changed
  -> compile target runtime config
  -> enqueue/apply runtime config refresh command
  -> PUT /v1/runtime-config
  -> prefetch/fulfill artifacts and credentials
```

Launch preflight hook:

```text
launch requested with required revision R
  -> check AnyHarness current revision
  -> if current, launch
  -> if stale/missing, apply R first
  -> if apply fails, fail launch
```

Lazy repair hook:

```text
AnyHarness reports runtime_config_resolution_required
  -> worker/Desktop fetches requested artifact/credential
  -> fulfills request
  -> retries launch once
```

Skill storage/interface:

- Skill markdown/resources are artifacts, addressed by hash.
- AnyHarness stores artifacts on disk under its runtime artifact cache.
- The skills MCP server serves only skills listed in the current manifest.
- `list_available_skills` returns manifest metadata.
- `activate_skill` loads the instruction artifact.
- `get_skill_resource` loads resource artifacts.

MCP credential interface:

- Manifest contains credential refs, not secret values.
- Worker/Desktop fulfills refs with concrete values.
- AnyHarness renders refs into HTTP headers/query params or stdio env/args at launch.
- Values stay in memory and expire by `expires_at`.

## More specific one offs

When does a sandbox update?

- User enables/disables a personal MCP/skill/plugin.
- Admin marks an item public/private for org use.
- MCP settings change.
- MCP auth changes or reconnects.
- Skill/plugin catalog version changes and resolver selects the new version.
- Worker/Desktop notices launch requires a newer runtime config revision.

When do we refresh OAuth?

- Proactively during runtime config apply if access token is near expiry.
- Proactively by a background Cloud job if we want smoother readiness.
- Lazily on launch when AnyHarness says the fulfilled credential expired.
- Reactively when an MCP reports an auth-expired failure during use.
- Best-effort live retry for HTTP MCPs; restart/remount for stdio MCPs unless that server supports reload.
- Never inside AnyHarness; AnyHarness does not own OAuth refresh tokens.

What fails closed?

- Missing required artifact.
- Missing required credential.
- Expired credential that cannot refresh.
- Auth status `needs_reconnect`.
- Required runtime config revision cannot be applied.

## Deeper concepts

MCP:

- The runtime shape is transport plus launch/connect template.
- `stdio` MCPs launch a subprocess with command/args/env.
- `http` MCPs connect to a URL with headers/query params.
- Secret-bearing parts of either shape are credential refs.

Skill:

- A skill is a manifest-visible instruction/resource package.
- It is not injected wholesale into every prompt.
- The agent sees a compact skill index and loads skill content through the skills MCP server.

Plugin:

- A plugin is a product package, not a runtime primitive.
- It exists to make configuration ergonomic.
- Runtime expansion is one-way: plugin -> MCPs + skills.

Runtime config revision:

- A revision is just a version stamp for the compiled sandbox config.
- It can be an opaque id plus content hash.
- It exists so worker/Desktop can prove AnyHarness is current before launch.
