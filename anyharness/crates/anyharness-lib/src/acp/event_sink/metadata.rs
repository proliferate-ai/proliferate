use super::normalization::meta::parse_meta;
use super::SessionEventSink;

impl SessionEventSink {
    pub(super) fn meta_parent_tool_call_id(
        &self,
        meta: Option<&serde_json::Value>,
    ) -> Option<String> {
        if self.source_agent_kind != "claude" {
            return None;
        }
        parse_meta(meta)
            .claude_code
            .and_then(|meta| meta.parent_tool_use_id)
    }
}
