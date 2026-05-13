use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) fn first_prompt_system_prompt_append_for_codex_prompt<'a>(
    source_agent_kind: &str,
    first_prompt_system_prompt_append: Option<&'a str>,
    has_turn_started: bool,
) -> Option<&'a str> {
    if source_agent_kind != AgentKind::Codex.as_str() || has_turn_started {
        return None;
    }

    let append = first_prompt_system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }
    Some(append)
}
