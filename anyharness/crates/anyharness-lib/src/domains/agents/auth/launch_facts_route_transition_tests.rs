//! Provider-scoped route-transition regression tests for launch facts.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::collect_launch_env_facts;
use crate::domains::agents::auth::context::classify;
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::catalog::service::{ActiveCatalog, SelectionUnsupported};
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::registry::built_in_registry;

fn temp_home() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "anyharness-route-transition-facts-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(path.join("agent-auth")).expect("create agent-auth dir");
    path
}

fn write_state(home: &Path, json: &str) {
    std::fs::write(home.join("agent-auth").join("state.json"), json).expect("write state");
}

/// Regression for gateway -> native -> API-key route changes. A Codex
/// native credential may be present throughout, but an explicit route is
/// authoritative for single-source harnesses. In particular, the native-
/// only `gpt-5.6-sol` model must be rejected while gateway is selected and
/// become valid again for native and explicit OpenAI API-key launches.
#[test]
fn codex_route_transitions_scope_model_validation_to_the_effective_provider() {
    let home = temp_home();
    let document = Arc::new(bundled_agent_catalog_document().clone());
    let contexts = document
        .agents
        .iter()
        .find(|agent| agent.kind == "codex")
        .map(|agent| agent.auth_contexts.as_slice())
        .expect("codex auth contexts");
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == AgentKind::Codex)
        .expect("codex descriptor");
    let catalog = ActiveCatalog::new(Arc::clone(&document));
    let native_key_env = BTreeMap::from([(
        "OPENAI_API_KEY".to_string(),
        "present-but-never-inspected".to_string(),
    )]);

    write_state(
        &home,
        r#"{"version":2,"revision":1,"harnesses":[
            {"harness_kind":"codex","sources":[
                {"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
    );
    let gateway_facts = collect_launch_env_facts("codex", &native_key_env, &home);
    let gateway_contexts = classify(&descriptor, contexts, &gateway_facts);
    assert_eq!(gateway_contexts.ids(), &["gateway".to_string()]);
    assert!(matches!(
        catalog.validate_launch("codex", &gateway_contexts, Some("gpt-5.6-sol"), None,),
        Err(SelectionUnsupported::ModelGated { .. })
    ));

    std::fs::remove_file(home.join("agent-auth/state.json")).expect("clear to native");
    let native_facts = collect_launch_env_facts("codex", &native_key_env, &home);
    let native_contexts = classify(&descriptor, contexts, &native_facts);
    catalog
        .validate_launch("codex", &native_contexts, Some("gpt-5.6-sol"), None)
        .expect("native OpenAI route accepts native model");

    write_state(
        &home,
        r#"{"version":2,"revision":2,"harnesses":[
            {"harness_kind":"codex","sources":[
                {"kind":"api_key","env_var_name":"OPENAI_API_KEY","value":"sk-raw"}]}]}"#,
    );
    let api_key_facts = collect_launch_env_facts("codex", &BTreeMap::new(), &home);
    let api_key_contexts = classify(&descriptor, contexts, &api_key_facts);
    assert_eq!(api_key_contexts.ids(), &["openai-api".to_string()]);
    catalog
        .validate_launch("codex", &api_key_contexts, Some("gpt-5.6-sol"), None)
        .expect("explicit OpenAI API-key route accepts native model");

    let _ = std::fs::remove_dir_all(&home);
}
