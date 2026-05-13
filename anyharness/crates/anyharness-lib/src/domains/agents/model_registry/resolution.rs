use super::model::ResolvedModelIntent;
use super::projection::effective_registry_for_kind;
use super::store::DynamicModelRegistryStore;

pub fn resolve_model_intent(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
    requested_model_id: &str,
) -> anyhow::Result<ResolvedModelIntent> {
    let snapshot = store.get(agent_kind, workspace_id)?;
    let registry = effective_registry_for_kind(agent_kind, snapshot.as_ref());
    let Some(registry) = registry else {
        return Ok(ResolvedModelIntent {
            requested_model_id: requested_model_id.to_string(),
            resolved_model_id: None,
            available: false,
            reason: Some("model_registry_not_found".to_string()),
        });
    };

    let resolved = registry.models.iter().find(|model| {
        model.id == requested_model_id
            || model
                .aliases
                .iter()
                .any(|alias| alias == requested_model_id)
    });

    Ok(ResolvedModelIntent {
        requested_model_id: requested_model_id.to_string(),
        resolved_model_id: resolved.map(|model| model.id.clone()),
        available: resolved.is_some(),
        reason: resolved
            .is_none()
            .then(|| "model_not_available_on_target".to_string()),
    })
}
