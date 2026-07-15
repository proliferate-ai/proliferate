use super::SessionEventSink;
use super::normalization::meta::parse_meta;

impl SessionEventSink {
    pub(super) fn meta_parent_tool_call_id(
        &self,
        meta: Option<&serde_json::Value>,
    ) -> Option<String> {
        let meta = parse_meta(meta);
        meta.anyharness
            .and_then(|meta| meta.parent_tool_call_id)
            .or_else(|| {
                (self.source_agent_kind == "claude")
                    .then(|| meta.claude_code.and_then(|meta| meta.parent_tool_use_id))
                    .flatten()
            })
    }
}
