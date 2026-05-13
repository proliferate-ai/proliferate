use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) fn prepend_system_prompt_append_to_acp_blocks(
    blocks: &mut Vec<acp::ContentBlock>,
    append: &str,
) {
    blocks.insert(
        0,
        acp::ContentBlock::Text(acp::TextContent::new(format!(
            "System instruction from AnyHarness, not user content:\n{append}"
        ))),
    );
}
