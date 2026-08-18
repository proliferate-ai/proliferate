use std::collections::HashSet;
use std::sync::OnceLock;

use serde::Deserialize;

/// The targeted-fork side-door qualification registry. An
/// agent kind only ever advertises `targeted_fork` when a row here says
/// `qualified: true` for its exact resolved native version -- flipping that
/// flag is a deliberate, reviewed act after the live two-boundary probe, not
/// a side effect of shipping the bridge code.
const BUNDLED_QUALIFICATIONS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../catalogs/agents/qualifications/targeted-fork-sidedoor.json"
));

#[derive(Debug, Clone, Deserialize)]
struct QualificationEntry {
    #[serde(rename = "agentKind")]
    agent_kind: String,
    #[serde(rename = "nativeVersion")]
    native_version: String,
    qualified: bool,
    #[allow(dead_code)]
    evidence: String,
}

static PARSED: OnceLock<Vec<QualificationEntry>> = OnceLock::new();

fn parsed_qualifications() -> &'static [QualificationEntry] {
    PARSED
        .get_or_init(|| {
            parse_qualifications(BUNDLED_QUALIFICATIONS)
                .expect("bundled targeted-fork-sidedoor qualification registry must be valid")
        })
        .as_slice()
}

/// Parse and validate a qualification registry document. Fails closed (loud
/// error, never a silent skip) on anything malformed: duplicate
/// `(agentKind, nativeVersion)` pairs are ambiguous and an unknown/empty
/// `agentKind` is very likely a typo that would otherwise silently qualify
/// nothing.
fn parse_qualifications(raw: &str) -> anyhow::Result<Vec<QualificationEntry>> {
    let entries: Vec<QualificationEntry> = serde_json::from_str(raw)
        .map_err(|error| anyhow::anyhow!("targeted-fork-sidedoor registry: invalid JSON: {error}"))?;

    let mut seen: HashSet<(String, String)> = HashSet::new();
    for entry in &entries {
        if entry.agent_kind.trim().is_empty() {
            anyhow::bail!("targeted-fork-sidedoor registry: entry has empty agentKind");
        }
        if entry.native_version.trim().is_empty() {
            anyhow::bail!(
                "targeted-fork-sidedoor registry: entry for {} has empty nativeVersion",
                entry.agent_kind
            );
        }
        let key = (entry.agent_kind.clone(), entry.native_version.clone());
        if !seen.insert(key) {
            anyhow::bail!(
                "targeted-fork-sidedoor registry: duplicate entry for agentKind={} nativeVersion={}",
                entry.agent_kind,
                entry.native_version
            );
        }
    }
    Ok(entries)
}

/// Whether targeted-fork side-door dispatch is qualified for the given agent
/// kind at the given resolved native version. An unknown `(agent_kind,
/// native_version)` pair -- including an unknown agent kind entirely -- is
/// unqualified: fail closed, never assume.
pub fn sidedoor_fork_qualified(agent_kind: &str, native_version: &str) -> bool {
    parsed_qualifications()
        .iter()
        .any(|entry| entry.agent_kind == agent_kind && entry.native_version == native_version && entry.qualified)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_registry_parses_and_matches_opencode_pin() {
        let entries = parse_qualifications(BUNDLED_QUALIFICATIONS).expect("bundled registry parses");
        assert!(entries
            .iter()
            .any(|entry| entry.agent_kind == "opencode" && entry.native_version == "1.18.3"));
    }

    #[test]
    fn unqualified_entry_reports_false() {
        // The bundled registry ships qualified:false until the live probe
        // flips it -- this pins that the flag, not just presence, gates.
        assert!(!sidedoor_fork_qualified("opencode", "1.18.3"));
    }

    #[test]
    fn unknown_agent_kind_is_unqualified() {
        assert!(!sidedoor_fork_qualified("does-not-exist", "1.0.0"));
    }

    #[test]
    fn unknown_native_version_is_unqualified() {
        assert!(!sidedoor_fork_qualified("opencode", "0.0.1"));
    }

    #[test]
    fn duplicate_entries_fail_closed() {
        let raw = r#"[
            {"agentKind": "opencode", "nativeVersion": "1.18.3", "qualified": false, "evidence": "a"},
            {"agentKind": "opencode", "nativeVersion": "1.18.3", "qualified": true, "evidence": "b"}
        ]"#;
        let error = parse_qualifications(raw).expect_err("duplicate entries must fail to parse");
        assert!(error.to_string().contains("duplicate entry"));
    }

    #[test]
    fn empty_agent_kind_fails_closed() {
        let raw = r#"[{"agentKind": "", "nativeVersion": "1.0.0", "qualified": true, "evidence": "a"}]"#;
        let error = parse_qualifications(raw).expect_err("empty agentKind must fail to parse");
        assert!(error.to_string().contains("empty agentKind"));
    }
}
