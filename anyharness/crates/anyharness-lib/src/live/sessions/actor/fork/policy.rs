use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) fn has_anyharness_targeted_fork_extension(
    meta: &acp::Meta,
) -> bool {
    let Some(anyharness) = meta.get("anyharness").and_then(|value| value.as_object()) else {
        return false;
    };
    if anyharness
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return false;
    }
    let Some(targeted_fork) = anyharness
        .get("targetedFork")
        .and_then(|value| value.as_object())
    else {
        return false;
    };
    if targeted_fork
        .get("fileEffects")
        .and_then(|value| value.as_str())
        != Some("none")
    {
        return false;
    }
    matches!(
        targeted_fork.get("target").and_then(|value| value.as_str()),
        Some("message_id" | "user_message_index")
    )
}
