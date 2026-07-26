//! The R14 attribution rule, generalized past claude: an entry must mean what its
//! context key says, so an ambient credential belonging to a DIFFERENT provider slot
//! of the same harness never reaches the spawn.

use super::super::*;
use super::*;

/// **The R14 attribution rule, generalized past claude.**
///
/// opencode declares `openai-api`, `anthropic-api` and `gemini-api` over three
/// separate provider slots, and it composes every provider it can see. So probing
/// `openai-api` on a machine that also exports `ANTHROPIC_API_KEY` would otherwise
/// record ANTHROPIC models inside the `openai-api` entry — and because entries are
/// keyed by context id, that is what the picker serves and what launch validation
/// trusts.
///
/// Asserted as a relationship, not against a hardcoded list: whatever the registry
/// declares for the OTHER slots must be removed, and whatever this context's own slot
/// declares must survive.
#[test]
fn a_non_gateway_probe_scrubs_the_other_providers_ambient_keys() {
    let home = TempHome::new("attribution");
    // Nothing enrolled, so `openai-api` falls back to Native — the login-backed case,
    // which is exactly the shape where ambient contamination was possible.
    home.write_state_json(&state(1, json!([])));
    let contexts = opencode_contexts();

    let material = material_for(&home, "opencode", "openai-api", &contexts).expect("material");
    assert!(
        material.is_native(),
        "the fixture must exercise the Native-fallback path"
    );
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");
    let removed: BTreeSet<&str> = materialized
        .env_remove
        .iter()
        .map(String::as_str)
        .collect();

    let slots = &bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == "opencode")
        .expect("opencode in registry")
        .auth
        .slots;
    let own: BTreeSet<String> = slots
        .iter()
        .filter(|slot| slot.id == "openai")
        .flat_map(|slot| slot.env_vars.iter())
        .map(|env_var| env_var.name().to_string())
        .collect();
    let others: BTreeSet<String> = slots
        .iter()
        .filter(|slot| slot.id != "openai")
        .flat_map(|slot| slot.env_vars.iter())
        .map(|env_var| env_var.name().to_string())
        .collect();
    assert!(
        !own.is_empty() && !others.is_empty(),
        "the fixture is meaningful only if both sets exist"
    );

    for name in &others {
        assert!(
            removed.contains(name.as_str()),
            "probing openai-api must scrub another provider's {name}"
        );
    }
    for name in &own {
        assert!(
            !removed.contains(name.as_str()),
            "probing openai-api must NOT scrub its own slot's {name}"
        );
    }
    // Concretely, the case the review named.
    assert!(removed.contains("ANTHROPIC_API_KEY"));
    assert!(removed.contains("GEMINI_API_KEY"));
    assert!(!removed.contains("OPENAI_API_KEY"));

    // And the removals really reach the child, so an ambient anthropic key cannot be
    // seen by the spawn whose entry is keyed `openai-api`.
    let options = crate::live::sessions::probe::ProbeOptions {
        agent_kind: crate::domains::agents::model::AgentKind::OpenCode,
        auth_context: "openai-api".to_string(),
        auth_env: materialized.env_set.clone(),
        auth_env_remove: materialized.env_remove.clone(),
        runtime_home: home.path().to_path_buf(),
        workspace_root: Some(materialized.scratch.workspace_root()),
        model_switch_timeout: std::time::Duration::from_secs(1),
        max_models: None,
        switch_models: false,
        send_test_prompt: false,
    };
    let ambient: std::collections::BTreeMap<String, String> = [
        ("ANTHROPIC_API_KEY".to_string(), "sk-ant-ambient".to_string()),
        ("OPENAI_API_KEY".to_string(), "sk-oai-ambient".to_string()),
    ]
    .into_iter()
    .collect();
    let merged = crate::live::sessions::probe::spawn_env_for_options(&options, &ambient);
    assert!(
        !merged.contains_key("ANTHROPIC_API_KEY"),
        "an ambient anthropic key must not reach an openai-api probe"
    );
    assert_eq!(
        merged.get("OPENAI_API_KEY").map(String::as_str),
        Some("sk-oai-ambient"),
        "the context's OWN provider credential is what the probe exists to observe"
    );
}

/// The gateway context is exempt: its recipes already sanitize what they need to, and
/// its job is to observe one proxy rather than one provider. Scrubbing the other slots
/// there would be noise at best, and at worst would strip a var a gateway recipe
/// deliberately set.
#[test]
fn the_gateway_context_is_not_attribution_scrubbed() {
    let home = TempHome::new("attribution-gateway");
    home.write_state_json(&state(
        2,
        json!([{ "harness_kind": "opencode", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = opencode_contexts();
    let material = material_for(&home, "opencode", "gateway", &contexts).expect("material");
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");

    // opencode's gateway recipe declares no removals of its own, so an empty list IS
    // the assertion that the scrub did not fire.
    assert!(
        materialized.env_remove.is_empty(),
        "the gateway context must not be attribution-scrubbed, got {:?}",
        materialized.env_remove
    );
    assert!(materialized
        .env_set
        .contains_key("PROLIFERATE_GATEWAY_KEY"));
}
