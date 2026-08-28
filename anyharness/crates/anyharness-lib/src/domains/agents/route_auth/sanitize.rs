//! Claude ambient-environment sanitization: the strip list required by the
//! agent_auth spec's sanitization law (§4, the claude recipes): remove "the
//! rerouting flags ... plus every Anthropic selector the route did not set",
//! so the composed route — not the host machine — decides where a launch
//! authenticates and which models it selects. Split from `render.rs` (which
//! composes the delta this fn then sanitizes) so the law's list has its own
//! seam.

use std::collections::BTreeSet;

use crate::domains::agents::model::AgentKind;

use super::render::RenderedRouteAuth;

/// Compose a harness's enabled sources into one additive launch delta. Each
/// `api_key` source rides its free-form env var; each `gateway` source runs the
/// per-harness recipe. OpenCode consumes a live-fetched [`GatewayModelPlan`]
/// because its provider config must enumerate exact gateway models before spawn.
/// The server validated source legality, so ordering/count are trusted here.
/// Sanitize claude's ambient provider env on EVERY non-native route, after the
/// sources have composed.
///
/// agent-auth.md requires sanitization on every non-native route, and it was only
/// wired into the gateway recipe. The gap this closes is REVERSE contamination:
/// an `api_key` selection set `ANTHROPIC_API_KEY` and stopped there, so on a
/// Bedrock-configured host the ambient `CLAUDE_CODE_USE_BEDROCK=1` survived and
/// the CLI routed the user's BYOK launch to Bedrock — billing an account they did
/// not select, with the key they did select sitting unused in the env.
///
/// Applied here rather than inside each recipe because it must observe the FULLY
/// composed delta: `sanitize_claude_ambient` keeps whatever this route actually
/// set and removes the rest, so running it per-source would let an earlier
/// source's var be removed on behalf of a later one.
///
/// `provider_config_keys` is the set of env var names the `provider_config` arm
/// itself composed — the ONLY source whose keys may exempt a rerouting flag from
/// removal (see [`sanitize_claude_ambient`]).
pub(super) fn sanitize_claude_if_routed(
    harness_kind: &str,
    rendered: &mut RenderedRouteAuth,
    provider_config_keys: &BTreeSet<String>,
) {
    if harness_kind == AgentKind::Claude.as_str() {
        sanitize_claude_ambient(rendered, provider_config_keys);
    }
}

/// HARD REQUIREMENT (HARNESS-MATRIX.md §claude): ambient provider env silently
/// reroutes the Claude CLI (observed: Bedrock). Remove the rerouting flags and
/// any Anthropic base-url/token/key we did NOT just set, so the gateway
/// credentials are authoritative. Removal wins over inherited values (applied
/// last at spawn); we do not just set empties because the CLI treats a
/// present-but-empty flag inconsistently.
///
/// The rules key off which vars THIS render set, not off providers: the gateway
/// route sets base-url + auth-token → those are kept; ambient ANTHROPIC_API_KEY
/// is removed so a raw key cannot shadow the gateway token.
///
/// The rerouting flags are the ONE exception, and their exemption is deliberately
/// narrower. Track D makes a `provider_config` × `aws_bedrock`/`azure_openai`
/// source legitimately SET `CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_FOUNDRY` —
/// that flag IS the route, so stripping it would sanitize away the very thing the
/// arm just composed. But the exemption keys off `provider_config_keys` (the keys
/// the provider_config arm itself rendered), NOT off `rendered.set` at large,
/// because the `api_key` arm sets an ARBITRARY, user-chosen env var name gated
/// only by a shape regex server-side (`^[A-Z][A-Z0-9_]{0,127}$`, no denylist). An
/// `api_key` row named `CLAUDE_CODE_USE_BEDROCK=1` would otherwise survive and
/// reroute the launch to Bedrock with no Bedrock credential selected — exactly the
/// hole described above, re-opened through the user's own naming. For those names
/// the removal stays unconditional.
fn sanitize_claude_ambient(
    rendered: &mut RenderedRouteAuth,
    provider_config_keys: &BTreeSet<String>,
) {
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        // Azure AI Foundry, the third provider-rerouting flag. Included now
        // rather than with Track D's Foundry support, because the flag reroutes
        // an ambient host TODAY whether or not we can yet configure Foundry
        // ourselves — leaving it out would be a hole with no upside.
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
    ] {
        if !provider_config_keys.contains(key) {
            rendered.remove(key);
        }
    }
    // DELIBERATELY NOT REMOVED: ambient `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/
    // `AWS_SESSION_TOKEN`/`AWS_PROFILE`. `AWS_BEARER_TOKEN_BEDROCK` is used by the
    // CLI as a direct auth header rather than through SigV4, so an ambient
    // long-lived credential does not take precedence over the token we inject, and
    // stripping the AWS credential chain would also break unrelated tooling the
    // session legitimately inherits. Revisit if a precedence inversion is ever
    // observed; the python arm makes the same call.
    //
    // Remove each Anthropic selector we didn't explicitly set on this route, so
    // ambient values can't shadow the chosen credential path.
    for key in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
    ] {
        if !rendered.set.contains_key(key) {
            rendered.remove(key);
        }
    }
    // Session model selection must come from the product's launch
    // configuration, never the host machine. An ambient `ANTHROPIC_MODEL` /
    // `ANTHROPIC_DEFAULT_*_MODEL` (e.g. a Bedrock-configured host's Claude
    // Code settings `env`, inherited by a runtime relaunched from such a
    // shell) silently resolves the session's model alias to a provider-format
    // id the routed credential cannot serve — observed live 2026-08-27:
    // `global.anthropic.claude-sonnet-5` sent to api.anthropic.com under a
    // seat, failing every turn with model-not-found. These are "Anthropic
    // selectors the route did not set" (the sanitization law, agent_auth spec
    // §4); the list was simply incomplete against the law's own words. The
    // exemption matches the rerouting flags': only the `provider_config` arm
    // may legitimately compose one of these names.
    for key in [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_BEDROCK_REGION_PREFIX",
    ] {
        if !provider_config_keys.contains(key) {
            rendered.remove(key);
        }
    }
}
