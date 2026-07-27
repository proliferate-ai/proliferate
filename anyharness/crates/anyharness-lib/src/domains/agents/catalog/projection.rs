//! Picker-facing projection: provider tagging, model-family normalization, and
//! the enrichment join that bridges a resolved gateway/plan model id onto the
//! bundled catalog's display metadata.
//!
//! This is where model-catalog.md's "the picker-facing enrichment join stays in
//! `catalog/`" note points: `resolve_catalog_match`/`enrich_model` moved here
//! from the deleted `agent_gateway_catalog.rs` (the route backend swap, A9 §3),
//! and `provider_for_model`/`normalize_model_family`/`native_default_model` moved
//! here from the deleted `gateway_resolver.rs` (A9 §2) because both the launch
//! options join and the gateway-models route join need them, and neither owns
//! probing or planning.

use super::schema::AgentCatalogModel;
use crate::domains::agents::model::ModelCatalogStatus as DomainModelCatalogStatus;

/// The gateway model context key the catalog uses for gateway-route curation
/// (matches the `gateway` auth-context id and `defaults["gateway"]`).
const GATEWAY_CONTEXT_ID: &str = "gateway";

/// Auth-context ids to consult for a NATIVE launch's default model, in
/// precedence order: an interactive login is the one a native launch most likely
/// uses, and a raw provider key second. Deliberately excludes `gateway` (that is
/// `default_model`) and the flag-driven provider contexts (`bedrock`, `azure`),
/// whose defaults belong to the typed provider-config route rather than to
/// "the user's own login".
const NATIVE_CONTEXT_PRECEDENCE: &[&str] = &[
    "openai-oauth",
    "openai-api",
    "anthropic-oauth",
    "anthropic-api",
];

/// The default model for a NATIVE launch: the first non-gateway auth context the
/// catalog declares a default for, in [`NATIVE_CONTEXT_PRECEDENCE`] order.
///
/// Pure so the precedence is testable without a catalog service or a database.
/// A native launch runs on the user's own provider login, so its model must come
/// from that provider's context default — never from `defaults["gateway"]` (a
/// gateway-only model id would 404 against the user's own account) and never from
/// a Rust constant (the catalog owns model names).
pub fn native_default_model(defaults: &std::collections::BTreeMap<String, String>) -> Option<String> {
    NATIVE_CONTEXT_PRECEDENCE
        .iter()
        .find_map(|context| defaults.get(*context).cloned())
        .or_else(|| {
            // Unknown harness vocabulary: any non-gateway default beats none, so
            // a newly-added harness's native launch is configured before its
            // context ids are listed above. BTreeMap ordering makes the pick
            // deterministic.
            defaults
                .iter()
                .find(|(context, _)| context.as_str() != GATEWAY_CONTEXT_ID)
                .map(|(_, model)| model.clone())
        })
}

/// Model-id -> provider-id prefix/family matcher. The long-term home is
/// provider-tagged catalog model entries; until then this tiny table maps the
/// known gateway model id patterns to their provider id, used to tag enriched
/// gateway-model / launch-option rows with a provider. Returns `None` when no
/// family matches (the caller omits `provider`).
pub fn provider_for_model(model_id: &str) -> Option<&'static str> {
    if model_id.starts_with("claude-") {
        Some("anthropic")
    } else if model_id.starts_with("anthropic.")
        || model_id.starts_with("us.anthropic.")
        || model_id.starts_with("global.anthropic.")
        || model_id.starts_with("eu.anthropic.")
        || model_id.starts_with("apac.anthropic.")
    {
        // Bedrock-style anthropic ids: us.anthropic.claude-sonnet-4-6,
        // global.anthropic.claude-fable-5, us.anthropic.claude-haiku-4-5-...-v1:0
        Some("anthropic")
    } else if model_id.starts_with("openai.") {
        // Bedrock-style openai ids: openai.gpt-oss-*
        Some("openai")
    } else if model_id.starts_with("gpt-") {
        Some("openai")
    } else if model_id.len() >= 2
        && model_id.as_bytes()[0] == b'o'
        && model_id.as_bytes()[1].is_ascii_digit()
    {
        // OpenAI o-series: o1, o3, o4-mini, etc. (but NOT opus/opus[1m])
        Some("openai")
    } else if model_id.starts_with("grok-") {
        Some("xai")
    } else {
        None
    }
}

/// Normalize a model id to a conservative FAMILY key for the enrichment join
/// (contract §5). Catalog ids and gateway ids share almost no exact ids
/// (catalog: `sonnet`, `us.anthropic.claude-sonnet-4-6[1m]`; gateway:
/// `claude-sonnet-4-5`, `claude-opus-4-6-20260205`), so the enrichment falls
/// back to matching on this key. It strips, in order:
///   1. the `us.anthropic.` / `global.anthropic.` vendor prefix,
///   2. a trailing `[1m]` context-window suffix,
///   3. a trailing bedrock `-vN:M` version suffix (colon-bearing only — a bare
///      `-vN` is deliberately NOT a version suffix),
///   4. a trailing `-YYYYMMDD` release date,
/// and lowercases the result. Pure CLI selectors (`default`, `sonnet`, `opus`,
/// `haiku`) normalize to themselves, which never equals a real gateway model id
/// family — so they stay unbridged by design (no guessy displayName matching).
pub fn normalize_model_family(model_id: &str) -> String {
    let mut s = model_id.trim();
    // (a) Strip a leading models.dev-style provider prefix (e.g.
    // `anthropic/claude-sonnet-4-5` → `claude-sonnet-4-5`). Must run BEFORE
    // the us.anthropic./global.anthropic. prefix handling.
    if let Some(slash_idx) = s.find('/') {
        s = &s[slash_idx + 1..];
    }
    for prefix in ["us.anthropic.", "global.anthropic."] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
            break;
        }
    }
    let mut s = s.to_ascii_lowercase();
    if let Some(rest) = s.strip_suffix("[1m]") {
        s = rest.to_string();
    }
    s = strip_bedrock_version_suffix(&s);
    s = strip_release_date_suffix(&s);
    s
}

/// Strip a trailing bedrock version suffix. Handles two forms:
/// - `-vN:M` (e.g. `-v1:0`) — the classic Bedrock versioned id.
/// - bare `-N:M` (e.g. `-1:0`, no `v`) — newer Bedrock ids like
///   `openai.gpt-oss-120b-1:0`.
/// A bare `-vN` (no colon) is left intact — the catalog uses
/// `claude-opus-4-6-v1` as a distinct family from `claude-opus-4-6`.
fn strip_bedrock_version_suffix(s: &str) -> String {
    // Try `-vN:M` first (colon-bearing with v).
    if let Some(idx) = s.rfind("-v") {
        let tail = &s[idx + 2..];
        if let Some((n, m)) = tail.split_once(':') {
            if !n.is_empty()
                && n.bytes().all(|b| b.is_ascii_digit())
                && !m.is_empty()
                && m.bytes().all(|b| b.is_ascii_digit())
            {
                return s[..idx].to_string();
            }
        }
    }
    // Try bare `-N:M` (no `v`, dash + digits + colon + digits at end).
    if let Some(colon_idx) = s.rfind(':') {
        let after_colon = &s[colon_idx + 1..];
        if !after_colon.is_empty() && after_colon.bytes().all(|b| b.is_ascii_digit()) {
            // Walk backwards from the colon to find the dash that starts `-N:M`.
            let before_colon = &s[..colon_idx];
            if let Some(dash_idx) = before_colon.rfind('-') {
                let n_part = &before_colon[dash_idx + 1..];
                if !n_part.is_empty()
                    && n_part.bytes().all(|b| b.is_ascii_digit())
                    // Ensure this isn't a `-vN:M` that we already checked (the
                    // char before the digits after the dash would be 'v').
                    && !before_colon[..dash_idx + 1].ends_with("-v")
                {
                    return s[..dash_idx].to_string();
                }
            }
        }
    }
    s.to_string()
}

/// Strip a trailing release date suffix. Handles two forms (checked in order):
/// - ISO-8601 `-YYYY-MM-DD` (e.g. `-2025-12-11`) — three dash-separated groups.
/// - Compact `-YYYYMMDD` (e.g. `-20250929`) — dash + exactly 8 ASCII digits.
fn strip_release_date_suffix(s: &str) -> String {
    // Try ISO-8601 form first: `-YYYY-MM-DD` (4+2+2 digits with dashes).
    // Look for the pattern by finding a suffix that matches `-\d{4}-\d{2}-\d{2}`.
    if s.len() >= 11 {
        let candidate = &s[s.len() - 10..]; // "YYYY-MM-DD"
        if candidate.as_bytes()[4] == b'-'
            && candidate.as_bytes()[7] == b'-'
            && candidate[..4].bytes().all(|b| b.is_ascii_digit())
            && candidate[5..7].bytes().all(|b| b.is_ascii_digit())
            && candidate[8..10].bytes().all(|b| b.is_ascii_digit())
        {
            // Verify the character before the date is a dash.
            let prefix = &s[..s.len() - 10];
            if prefix.ends_with('-') && prefix.len() > 1 {
                return prefix[..prefix.len() - 1].to_string();
            }
        }
    }
    // Compact form: `-YYYYMMDD` (dash + exactly 8 ASCII digits).
    let Some(idx) = s.rfind('-') else {
        return s.to_string();
    };
    let tail = &s[idx + 1..];
    if tail.len() == 8 && tail.bytes().all(|b| b.is_ascii_digit()) {
        s[..idx].to_string()
    } else {
        s.to_string()
    }
}

/// Resolve the bundled catalog row for a resolved gateway id (contract §5).
/// Tries an exact id match first, then falls back to a FAMILY-key match (see
/// [`normalize_model_family`]). When several catalog entries share the family
/// key, prefer the non-`[1m]` entry, then the longest (most-specific) id, then
/// a lexical tiebreak — deterministic regardless of catalog ordering.
pub fn resolve_catalog_match<'a>(
    id: &str,
    catalog_models: &'a [AgentCatalogModel],
) -> Option<&'a AgentCatalogModel> {
    if let Some(model) = catalog_models.iter().find(|model| model.id == id) {
        return Some(model);
    }
    let key = normalize_model_family(id);
    catalog_models
        .iter()
        .filter(|model| normalize_model_family(&model.id) == key)
        .max_by(|a, b| {
            let a_non_1m = !a.id.ends_with("[1m]");
            let b_non_1m = !b.id.ends_with("[1m]");
            a_non_1m
                .cmp(&b_non_1m)
                .then_with(|| a.id.len().cmp(&b.id.len()))
                .then_with(|| a.id.cmp(&b.id))
        })
}

/// One enriched model row's projected fields — the shape both the gateway-models
/// route and any future picker join need: identity plus the behavioral controls
/// that only an own-harness catalog match can supply.
#[derive(Debug, Clone, PartialEq)]
pub struct EnrichedModel {
    pub id: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub provider: Option<String>,
    pub status: Option<DomainModelCatalogStatus>,
    pub effort: Option<EnrichedModelEffort>,
    pub fast_mode: Option<bool>,
    pub modes: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnrichedModelEffort {
    pub values: Vec<String>,
    pub default: Option<String>,
}

/// The effort control joined from a catalog model, if it declares one.
/// Falls back to `reasoning_effort` for codex models.
fn model_effort(model: &AgentCatalogModel) -> Option<EnrichedModelEffort> {
    model
        .controls
        .get("effort")
        .or_else(|| model.controls.get("reasoning_effort"))
        .map(|control| EnrichedModelEffort {
            values: control.values.clone(),
            default: control.observed_value.clone(),
        })
}

/// The permission/agent modes joined from a catalog model (`controls.mode`), if
/// it declares that control (contract §5).
fn model_modes(model: &AgentCatalogModel) -> Option<Vec<String>> {
    model
        .controls
        .get("mode")
        .map(|control| control.values.clone())
}

/// Enrich a resolved gateway/plan model id by joining the bundled catalog
/// row(s).
///
/// - `own_match`: from the requesting harness's own catalog — contributes FULL
///   enrichment (identity + behavioral controls: effort, modes, fast_mode, status).
/// - `foreign_match`: from any other harness's catalog (cross-harness fallback) —
///   contributes IDENTITY ONLY (displayName + description). Behavioral controls
///   are harness-specific (e.g. codex users should not see claude-CLI thinking
///   controls) so they are never bridged from a foreign harness.
/// - Neither: probe-only sparse row `{ id, provider? }`.
pub fn enrich_model(
    id: String,
    own_match: Option<&AgentCatalogModel>,
    foreign_match: Option<&AgentCatalogModel>,
) -> EnrichedModel {
    let provider = provider_for_model(&id).map(str::to_string);
    if let Some(model) = own_match {
        // Full enrichment from own-harness catalog.
        EnrichedModel {
            id,
            display_name: Some(model.display_name.clone()),
            description: model.description.clone(),
            provider,
            status: Some(model.status),
            effort: model_effort(model),
            fast_mode: Some(model.controls.contains_key("fast_mode")),
            modes: model_modes(model),
        }
    } else if let Some(model) = foreign_match {
        // Identity-only enrichment from foreign-harness catalog.
        EnrichedModel {
            id,
            display_name: Some(model.display_name.clone()),
            description: model.description.clone(),
            provider,
            status: None,
            effort: None,
            fast_mode: None,
            modes: None,
        }
    } else {
        // Probe-only: no catalog entry anywhere.
        EnrichedModel {
            id,
            display_name: None,
            description: None,
            provider,
            status: None,
            effort: None,
            fast_mode: None,
            modes: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{
        AgentCatalogAvailability, AgentCatalogModelControl,
    };
    use std::collections::BTreeMap;

    fn defaults(pairs: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// The native default must never be the gateway's model: a gateway-only id
    /// would 404 against the user's own provider account.
    #[test]
    fn native_default_never_falls_back_to_the_gateway_model() {
        assert_eq!(
            native_default_model(&defaults(&[("gateway", "gpt-5.2")])),
            None,
            "a gateway-only catalog must yield no native default at all"
        );
    }

    /// codex's real catalog shape, and the precedence it exercises: the OAuth
    /// context wins over the api-key one, and both win over `gateway`.
    #[test]
    fn native_default_follows_context_precedence() {
        assert_eq!(
            native_default_model(&defaults(&[
                ("openai-api", "gpt-5.5"),
                ("openai-oauth", "gpt-5.5-oauth"),
                ("bedrock", "openai.gpt-5.5"),
                ("gateway", "gpt-5.2"),
            ]))
            .as_deref(),
            Some("gpt-5.5-oauth")
        );
        // Without the oauth context, the api-key context's default is next.
        assert_eq!(
            native_default_model(&defaults(&[
                ("openai-api", "gpt-5.5"),
                ("gateway", "gpt-5.2"),
            ]))
            .as_deref(),
            Some("gpt-5.5")
        );
    }

    /// A harness whose contexts are not yet in the precedence list still gets a
    /// native default rather than none — configured-by-default beats
    /// silently-unconfigured, and the pick is deterministic.
    #[test]
    fn native_default_falls_back_to_any_non_gateway_context() {
        assert_eq!(
            native_default_model(&defaults(&[
                ("gateway", "gw-model"),
                ("zzz-future-context", "future-model"),
            ]))
            .as_deref(),
            Some("future-model")
        );
    }

    /// The real bundled catalog must give codex a native default, or the native
    /// codex recipe silently renders nothing on every machine.
    #[test]
    fn the_bundled_catalog_gives_codex_a_native_default() {
        let document = crate::domains::agents::catalog::bundled::bundled_agent_catalog_document();
        let codex = document
            .agents
            .iter()
            .find(|agent| agent.kind == "codex")
            .expect("codex in the bundled catalog");

        let native = native_default_model(&codex.session.defaults)
            .expect("codex must have a native default model");
        let gateway = codex.session.defaults.get("gateway").cloned();
        assert_ne!(
            Some(native.as_str()),
            gateway.as_deref(),
            "the native default must be a distinct catalog value, not the gateway's"
        );
    }

    /// The any-non-gateway fallback is not hypothetical — it fires TODAY for
    /// opencode, whose only non-gateway default is `baseline`. Pin the value it
    /// resolves to, so a change in either the fallback or the catalog is a visible
    /// diff rather than a silent behavior change.
    ///
    /// This asserts the value rather than adding `baseline` to
    /// [`NATIVE_CONTEXT_PRECEDENCE`] on purpose: `baseline` is a catalog-wide
    /// notion of "the model to use absent any context", not an auth context, and
    /// listing it would make it outrank a real provider context for any harness
    /// that declares both. The generic fallback already picks it when it is the
    /// only candidate, which is exactly the intended precedence.
    ///
    /// (opencode has no native recipe today — `render_native` renders nothing for
    /// it — so this value is currently unused at launch. It is pinned because the
    /// resolver computes it for every harness, and a future native recipe would
    /// consume whatever this returns.)
    #[test]
    fn the_bundled_catalogs_opencode_native_default_is_its_baseline() {
        let document = crate::domains::agents::catalog::bundled::bundled_agent_catalog_document();
        let opencode = document
            .agents
            .iter()
            .find(|agent| agent.kind == "opencode")
            .expect("opencode in the bundled catalog");

        assert_eq!(
            opencode
                .session
                .defaults
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["baseline", "gateway"],
            "if opencode gains a real auth-context default, the expectation below changes"
        );
        assert_eq!(
            native_default_model(&opencode.session.defaults).as_deref(),
            Some("opencode/big-pickle"),
            "opencode's native default comes from the any-non-gateway fallback"
        );
    }

    #[test]
    fn provider_matcher_covers_known_families() {
        assert_eq!(provider_for_model("claude-sonnet-4-5"), Some("anthropic"));
        assert_ne!(provider_for_model("gpt-5.5"), Some("anthropic"));
        assert_eq!(provider_for_model("gpt-5.5"), Some("openai"));
        assert_eq!(provider_for_model("o3"), Some("openai"));
        assert_eq!(provider_for_model("o3-mini"), Some("openai"));
        assert_eq!(provider_for_model("o4-mini"), Some("openai"));
        assert_eq!(
            provider_for_model("openai.gpt-oss-120b-1:0"),
            Some("openai")
        );
        assert_eq!(provider_for_model("grok-4"), Some("xai"));
        assert_ne!(provider_for_model("claude-sonnet-4-5"), Some("unknown"));
        // CLI selectors like opus/opus[1m] should NOT match openai
        assert_ne!(provider_for_model("opus"), Some("openai"));
        assert_ne!(provider_for_model("opus[1m]"), Some("openai"));
        // Also verify they return None (no provider)
        assert_eq!(provider_for_model("opus"), None);
        assert_eq!(provider_for_model("opus[1m]"), None);
        assert_eq!(provider_for_model("claude-sonnet-4-6"), Some("anthropic"));
        // Bedrock-style anthropic ids (region-prefixed and bare) map to anthropic,
        // so a caller tagging gateway rows with a provider still tags them
        // correctly for claude's gateway model plan.
        assert_eq!(
            provider_for_model("us.anthropic.claude-sonnet-4-6"),
            Some("anthropic")
        );
        assert_eq!(
            provider_for_model("global.anthropic.claude-fable-5"),
            Some("anthropic")
        );
        assert_eq!(
            provider_for_model("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
            Some("anthropic")
        );
        assert_eq!(
            provider_for_model("anthropic.claude-sonnet-4-6"),
            Some("anthropic")
        );
        assert_eq!(
            provider_for_model("us.anthropic.claude-sonnet-4-6"),
            Some("anthropic")
        );
    }

    // --- normalize_model_family (contract §5), exercised with the REAL id sets
    // from catalogs/agents/catalog.json (catalog) and server/litellm/config.yaml
    // (gateway). ---

    #[test]
    fn normalize_strips_vendor_prefix_bracket_version_and_date() {
        // Vendor prefix + [1m] window suffix (catalog).
        assert_eq!(
            normalize_model_family("us.anthropic.claude-sonnet-4-6[1m]"),
            "claude-sonnet-4-6"
        );
        assert_eq!(
            normalize_model_family("global.anthropic.claude-fable-5"),
            "claude-fable-5"
        );
        // Bedrock version + date (catalog).
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-1-20250805-v1:0"),
            "claude-opus-4-1"
        );
        // Trailing release dates (gateway / config.yaml).
        assert_eq!(
            normalize_model_family("claude-sonnet-4-5-20250929"),
            "claude-sonnet-4-5"
        );
        assert_eq!(
            normalize_model_family("claude-haiku-4-5-20251001"),
            "claude-haiku-4-5"
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-6-20260205"),
            "claude-opus-4-6"
        );
        // Pure CLI selectors normalize to themselves.
        assert_eq!(normalize_model_family("opus[1m]"), "opus");
        assert_eq!(normalize_model_family("sonnet"), "sonnet");
        assert_eq!(normalize_model_family("default"), "default");
    }

    #[test]
    fn bare_dash_v_is_not_a_version_suffix() {
        // The catalog's bedrock opus-4-6 entry carries a bare `-v1` (no colon),
        // which is a DISTINCT family from a plain `claude-opus-4-6`.
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-6-v1[1m]"),
            "claude-opus-4-6-v1"
        );
    }

    #[test]
    fn sonnet_4_6_catalog_does_not_match_sonnet_4_5_gateway() {
        // The headline real-data hazard: catalog moved to 4-6 while the gateway
        // config still serves 4-5, so these must NOT bridge.
        assert_ne!(
            normalize_model_family("us.anthropic.claude-sonnet-4-6[1m]"),
            normalize_model_family("claude-sonnet-4-5")
        );
    }

    #[test]
    fn opus_4_6_dated_gateway_family_key() {
        // The dated gateway id normalizes to the plain family; it would bridge
        // to a catalog `claude-opus-4-6` entry IF one existed. Today the closest
        // catalog entry is a bedrock `-v1[1m]` variant, which normalizes
        // distinctly, so opus-4-6 stays unbridged.
        assert_eq!(
            normalize_model_family("claude-opus-4-6-20260205"),
            "claude-opus-4-6"
        );
        assert_ne!(
            normalize_model_family("claude-opus-4-6-20260205"),
            normalize_model_family("us.anthropic.claude-opus-4-6-v1[1m]")
        );
    }

    #[test]
    fn dated_opus_4_8_bridges_to_bedrock_family() {
        // A genuine positive: the catalog's opus-4-8 entries and a dated gateway
        // opus-4-8 id share a family key.
        assert_eq!(
            normalize_model_family("us.anthropic.claude-opus-4-8[1m]"),
            normalize_model_family("us.anthropic.claude-opus-4-8")
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-8-20260101"),
            "claude-opus-4-8"
        );
        assert_eq!(
            normalize_model_family("claude-opus-4-8-20260101"),
            normalize_model_family("us.anthropic.claude-opus-4-8[1m]")
        );
    }

    // --- (a) Provider-prefix stripping (models.dev style `provider/model`) ---

    #[test]
    fn strip_provider_prefix_anthropic() {
        assert_eq!(
            normalize_model_family("anthropic/claude-sonnet-4-5"),
            "claude-sonnet-4-5"
        );
        // Bridges to the plain gateway id.
        assert_eq!(
            normalize_model_family("anthropic/claude-sonnet-4-5"),
            normalize_model_family("claude-sonnet-4-5")
        );
    }

    #[test]
    fn strip_provider_prefix_openai() {
        assert_eq!(normalize_model_family("openai/gpt-5.2"), "gpt-5.2");
        assert_eq!(
            normalize_model_family("openai/gpt-5.2"),
            normalize_model_family("gpt-5.2")
        );
    }

    #[test]
    fn strip_provider_prefix_combined_with_date() {
        // `anthropic/claude-sonnet-4-5-20250929` should strip both the prefix
        // and the trailing date.
        assert_eq!(
            normalize_model_family("anthropic/claude-sonnet-4-5-20250929"),
            "claude-sonnet-4-5"
        );
    }

    #[test]
    fn provider_prefix_does_not_affect_dotted_vendor() {
        // If the id has BOTH a slash AND us.anthropic., the slash strips first,
        // leaving the us.anthropic. prefix for the next step.
        assert_eq!(
            normalize_model_family("bedrock/us.anthropic.claude-opus-4-8[1m]"),
            "claude-opus-4-8"
        );
    }

    // --- (b) ISO-8601 date stripping (`-YYYY-MM-DD`) ---

    #[test]
    fn strip_iso_date_suffix() {
        assert_eq!(normalize_model_family("gpt-5.2-2025-12-11"), "gpt-5.2");
        assert_eq!(
            normalize_model_family("gpt-5-mini-2025-08-07"),
            "gpt-5-mini"
        );
    }

    #[test]
    fn iso_date_bridges_to_bare_id() {
        assert_eq!(
            normalize_model_family("gpt-5.2-2025-12-11"),
            normalize_model_family("gpt-5.2")
        );
    }

    #[test]
    fn compact_date_still_works() {
        // Regression: existing compact date stripping preserved.
        assert_eq!(
            normalize_model_family("claude-sonnet-4-5-20250929"),
            "claude-sonnet-4-5"
        );
    }

    // --- (c) Bare bedrock version `-N:M` (no `v`) ---

    #[test]
    fn strip_bare_bedrock_version_no_v() {
        assert_eq!(
            normalize_model_family("openai.gpt-oss-120b-1:0"),
            "openai.gpt-oss-120b"
        );
    }

    #[test]
    fn bare_bedrock_version_bridges() {
        assert_eq!(
            normalize_model_family("openai.gpt-oss-120b-1:0"),
            normalize_model_family("openai.gpt-oss-120b")
        );
    }

    #[test]
    fn dash_v_colon_still_stripped() {
        // Regression: `-vN:M` form still works.
        assert_eq!(
            normalize_model_family("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
            "claude-haiku-4-5"
        );
    }

    #[test]
    fn bare_dash_v_still_not_stripped() {
        // Regression: bare `-vN` (no colon) stays as a distinct family.
        assert_eq!(
            normalize_model_family("claude-opus-4-6-v1"),
            "claude-opus-4-6-v1"
        );
    }

    #[test]
    fn selectors_normalize_to_themselves() {
        // Regression: pure CLI selectors.
        assert_eq!(normalize_model_family("sonnet"), "sonnet");
        assert_eq!(normalize_model_family("haiku"), "haiku");
        assert_eq!(normalize_model_family("opus"), "opus");
        assert_eq!(normalize_model_family("default"), "default");
    }

    // --- enrich_model / resolve_catalog_match (moved from agent_gateway_catalog.rs) ---

    fn catalog_model(id: &str) -> AgentCatalogModel {
        let mut controls = BTreeMap::new();
        controls.insert(
            "effort".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                ],
                default: None,
                observed_value: Some("medium".to_string()),
            },
        );
        controls.insert(
            "fast_mode".to_string(),
            AgentCatalogModelControl {
                values: vec!["on".to_string(), "off".to_string()],
                default: None,
                observed_value: None,
            },
        );
        controls.insert(
            "mode".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "default".to_string(),
                    "acceptEdits".to_string(),
                    "plan".to_string(),
                ],
                default: None,
                observed_value: None,
            },
        );
        AgentCatalogModel {
            id: id.to_string(),
            display_name: "Claude Sonnet 4.5".to_string(),
            description: Some("Balanced coding model".to_string()),
            aliases: vec![],
            family: None,
            availability: AgentCatalogAvailability {
                any_of: vec!["anthropic-api".to_string()],
            },
            default_visible: true,
            controls,
            status: DomainModelCatalogStatus::Active,
            provenance: None,
        }
    }

    #[test]
    fn catalog_known_model_is_fully_enriched() {
        let model = catalog_model("claude-sonnet-4-5");
        let entry = enrich_model("claude-sonnet-4-5".to_string(), Some(&model), None);

        assert_eq!(entry.id, "claude-sonnet-4-5");
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert_eq!(entry.description.as_deref(), Some("Balanced coding model"));
        assert_eq!(entry.provider.as_deref(), Some("anthropic"));
        assert!(matches!(entry.status, Some(DomainModelCatalogStatus::Active)));
        let effort = entry.effort.expect("effort");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));
        assert_eq!(entry.fast_mode, Some(true));
        assert_eq!(
            entry.modes,
            Some(vec![
                "default".to_string(),
                "acceptEdits".to_string(),
                "plan".to_string()
            ])
        );
    }

    #[test]
    fn model_without_effort_or_fast_mode_omits_them() {
        let mut model = catalog_model("claude-sonnet-4-5");
        model.controls.clear();
        let entry = enrich_model("claude-sonnet-4-5".to_string(), Some(&model), None);

        assert!(entry.effort.is_none());
        assert_eq!(entry.fast_mode, Some(false));
        assert!(entry.modes.is_none());
        // Catalog-known rows still carry display metadata + status.
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert!(entry.status.is_some());
    }

    #[test]
    fn probe_only_matched_id_is_sparse_with_provider() {
        // Not in the catalog (proxy serves it, catalog doesn't know it).
        let entry = enrich_model("claude-future-9".to_string(), None, None);

        assert_eq!(entry.id, "claude-future-9");
        assert_eq!(entry.provider.as_deref(), Some("anthropic"));
        assert!(entry.display_name.is_none());
        assert!(entry.description.is_none());
        assert!(entry.status.is_none());
        assert!(entry.effort.is_none());
        assert!(entry.fast_mode.is_none());
    }

    #[test]
    fn probe_only_unmatched_id_omits_provider() {
        let entry = enrich_model("mystery-model".to_string(), None, None);

        assert_eq!(entry.id, "mystery-model");
        assert!(entry.provider.is_none());
        assert!(entry.display_name.is_none());
    }

    /// The real catalog's claude opus-4-8 entries (three ids sharing a family
    /// key) plus the drifted sonnet/opus-4-6 entries that DON'T bridge today.
    fn claude_catalog() -> Vec<AgentCatalogModel> {
        [
            "sonnet",
            "opus[1m]",
            "us.anthropic.claude-sonnet-4-6",
            "us.anthropic.claude-sonnet-4-6[1m]",
            "us.anthropic.claude-opus-4-6-v1[1m]",
            "claude-opus-4-8",
            "us.anthropic.claude-opus-4-8",
            "us.anthropic.claude-opus-4-8[1m]",
        ]
        .into_iter()
        .map(catalog_model)
        .collect()
    }

    #[test]
    fn exact_id_wins_over_family() {
        let models = claude_catalog();
        let hit = resolve_catalog_match("claude-opus-4-8", &models).expect("match");
        // Exact id match, even though bedrock opus-4-8 variants share its family.
        assert_eq!(hit.id, "claude-opus-4-8");
    }

    #[test]
    fn dated_gateway_id_family_joins_preferring_non_1m_most_specific() {
        let models = claude_catalog();
        // No exact id: the dated gateway id family-matches the three opus-4-8
        // catalog entries; prefer non-[1m], then the longest/most-specific id.
        let hit = resolve_catalog_match("claude-opus-4-8-20260101", &models).expect("match");
        assert_eq!(hit.id, "us.anthropic.claude-opus-4-8");
    }

    #[test]
    fn drifted_gateway_ids_stay_sparse_today() {
        let models = claude_catalog();
        // Real config.yaml gateway ids: catalog moved to 4-6/4-8, gateway serves
        // 4-5 and a bedrock-`-v1` 4-6 — none bridge, so enrichment is sparse.
        assert!(resolve_catalog_match("claude-sonnet-4-5", &models).is_none());
        assert!(resolve_catalog_match("claude-sonnet-4-5-20250929", &models).is_none());
        assert!(resolve_catalog_match("claude-haiku-4-5", &models).is_none());
        assert!(resolve_catalog_match("claude-opus-4-6-20260205", &models).is_none());
    }

    #[test]
    fn codex_model_with_reasoning_effort_enriches_effort() {
        // Codex models use "reasoning_effort" key — verify the fallback works.
        let mut controls = BTreeMap::new();
        controls.insert(
            "reasoning_effort".to_string(),
            AgentCatalogModelControl {
                values: vec![
                    "low".to_string(),
                    "medium".to_string(),
                    "high".to_string(),
                    "xhigh".to_string(),
                ],
                default: None,
                observed_value: Some("medium".to_string()),
            },
        );
        let model = AgentCatalogModel {
            id: "codex-model".to_string(),
            display_name: "Codex Model".to_string(),
            description: None,
            aliases: vec![],
            family: None,
            availability: AgentCatalogAvailability {
                any_of: vec!["codex-api".to_string()],
            },
            default_visible: true,
            controls,
            status: DomainModelCatalogStatus::Active,
            provenance: None,
        };

        let entry = enrich_model("codex-model".to_string(), Some(&model), None);
        assert!(entry.effort.is_some());
        assert_eq!(
            entry.effort.unwrap().values,
            vec!["low", "medium", "high", "xhigh"]
        );
    }

    #[test]
    fn claude_model_with_effort_still_works() {
        // Claude models use "effort" key — verify it still works.
        let model = catalog_model("claude-sonnet-4-5");
        let effort = model_effort(&model).expect("effort should be present");
        assert_eq!(effort.values, vec!["low", "medium", "high"]);
        assert_eq!(effort.default.as_deref(), Some("medium"));
    }

    // --- Cross-harness fallback enrichment (identity-only from foreign harness) ---

    #[test]
    fn foreign_match_yields_identity_only() {
        // Simulates: codex requesting `claude-sonnet-4-5`; own catalog has no
        // match, but the opencode catalog has `anthropic/claude-sonnet-4-5`.
        let foreign_model = catalog_model("anthropic/claude-sonnet-4-5");
        let entry = enrich_model("claude-sonnet-4-5".to_string(), None, Some(&foreign_model));

        // Identity fields bridged.
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert_eq!(entry.description.as_deref(), Some("Balanced coding model"));
        assert_eq!(entry.provider.as_deref(), Some("anthropic"));
        // Behavioral controls NOT bridged (harness-specific).
        assert!(entry.status.is_none());
        assert!(entry.effort.is_none());
        assert!(entry.fast_mode.is_none());
        assert!(entry.modes.is_none());
    }

    #[test]
    fn own_match_takes_priority_over_foreign() {
        // When both own and foreign match, own wins with full enrichment.
        let own_model = catalog_model("claude-sonnet-4-5");
        let foreign_model = catalog_model("anthropic/claude-sonnet-4-5");
        let entry = enrich_model(
            "claude-sonnet-4-5".to_string(),
            Some(&own_model),
            Some(&foreign_model),
        );

        // Full enrichment from own (status, effort, modes present).
        assert!(entry.status.is_some());
        assert!(entry.effort.is_some());
        assert_eq!(entry.fast_mode, Some(true));
        assert!(entry.modes.is_some());
    }

    #[test]
    fn no_match_anywhere_stays_sparse() {
        let entry = enrich_model("totally-unknown-model".to_string(), None, None);

        assert_eq!(entry.id, "totally-unknown-model");
        assert!(entry.display_name.is_none());
        assert!(entry.description.is_none());
        assert!(entry.provider.is_none());
        assert!(entry.status.is_none());
        assert!(entry.effort.is_none());
        assert!(entry.fast_mode.is_none());
        assert!(entry.modes.is_none());
    }

    #[test]
    fn codex_requesting_claude_bridges_via_opencode_catalog_entry() {
        // The real scenario: codex harness requests `claude-sonnet-4-5` via
        // gateway; codex's own catalog doesn't know it, but opencode's catalog
        // has `anthropic/claude-sonnet-4-5`. The normalizer strips the provider
        // prefix, enabling the family-key bridge.
        let opencode_catalog = vec![catalog_model("anthropic/claude-sonnet-4-5")];
        let codex_catalog: Vec<AgentCatalogModel> = vec![];

        // Own-harness miss.
        let own = resolve_catalog_match("claude-sonnet-4-5", &codex_catalog);
        assert!(own.is_none());

        // Foreign-harness hit (family key: both normalize to `claude-sonnet-4-5`).
        let foreign = resolve_catalog_match("claude-sonnet-4-5", &opencode_catalog);
        assert!(foreign.is_some());
        assert_eq!(foreign.unwrap().id, "anthropic/claude-sonnet-4-5");

        // Enrichment is identity-only.
        let entry = enrich_model("claude-sonnet-4-5".to_string(), own, foreign);
        assert_eq!(entry.display_name.as_deref(), Some("Claude Sonnet 4.5"));
        assert!(entry.status.is_none());
        assert!(entry.effort.is_none());
        assert!(entry.fast_mode.is_none());
        assert!(entry.modes.is_none());
    }
}
