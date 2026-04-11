use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::artifacts::model::ArtifactRendererKind;
use crate::artifacts::service::{ArtifactMutationInput, ArtifactService, ArtifactServiceError};
use crate::sessions::mcp::{SessionMcpProviderSource, SessionMcpServer, SessionMcpStdioServer};
use crate::sessions::model::SessionRecord;
use crate::workspaces::model::WorkspaceRecord;

const MCP_SERVER_NAME: &str = "proliferate";
const COWORK_SYSTEM_PROMPT_APPEND: &str = concat!(
    "You are running inside Proliferate Cowork. ",
    "A built-in MCP server named `proliferate` is attached by the runtime even if there is no ",
    "`~/.claude/settings.json`, `.claude/settings.json`, or `.mcp.json` entry for it.\n\n",
    "Use the `proliferate` tools for artifact work:\n",
    "- `create_artifact`\n",
    "- `update_artifact`\n",
    "- `list_artifacts`\n",
    "- `get_artifact`\n\n",
    "Artifact files live under `.artifacts/<id>/`. ",
    "For a markdown artifact, prepare a markdown file under that directory and call ",
    "`create_artifact` with renderer `markdown` and the relative markdown entry path.\n\n",
    "If the user asks whether Cowork has artifact or MCP support, treat the built-in ",
    "`proliferate` server as available and do not inspect Claude config files to answer that."
);

#[derive(Clone)]
pub struct CoworkMcpProviderSource {
    executable_path: PathBuf,
}

impl CoworkMcpProviderSource {
    pub fn new(executable_path: PathBuf) -> Self {
        Self { executable_path }
    }
}

impl SessionMcpProviderSource for CoworkMcpProviderSource {
    fn providers_for(
        &self,
        _session: &SessionRecord,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Vec<SessionMcpServer>> {
        if workspace.surface_kind != "cowork" || workspace.is_internal {
            return Ok(Vec::new());
        }

        Ok(vec![SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: format!("cowork-proliferate:{}", workspace.id),
            catalog_entry_id: None,
            server_name: MCP_SERVER_NAME.to_string(),
            command: self.executable_path.to_string_lossy().into_owned(),
            args: vec![
                "mcp-proliferate".to_string(),
                "--workspace".to_string(),
                workspace.path.clone(),
            ],
            env: Vec::new(),
        })])
    }

    fn system_prompt_append(
        &self,
        _session: &SessionRecord,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Option<String>> {
        if workspace.surface_kind != "cowork" || workspace.is_internal {
            return Ok(None);
        }

        Ok(Some(COWORK_SYSTEM_PROMPT_APPEND.to_string()))
    }

    fn startup_meta(
        &self,
        session: &SessionRecord,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Option<serde_json::Map<String, Value>>> {
        if workspace.surface_kind != "cowork" || workspace.is_internal {
            return Ok(None);
        }

        if session.agent_kind != "claude" {
            return Ok(None);
        }

        Ok(Some(serde_json::Map::from_iter([(
            "claudeCode".to_string(),
            json!({
                "options": {
                    "strictMcpConfig": true,
                },
            }),
        )])))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactLookupArgs {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactMutationArgs {
    id: String,
    title: String,
    renderer: String,
    entry: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

pub fn run_stdio_server(workspace_path: &Path) -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    let artifact_service = ArtifactService::new();

    while let Some(request) = read_request(&mut reader)? {
        if request.method.starts_with("notifications/") {
            continue;
        }

        let Some(id) = request.id.clone() else {
            continue;
        };

        match handle_request(&artifact_service, workspace_path, request) {
            Ok(result) => write_response(&mut writer, &id, result)?,
            Err(ServerResponse::JsonRpcError { code, message }) => {
                write_error(&mut writer, &id, code, &message)?;
            }
            Err(ServerResponse::ToolError {
                message,
                structured,
            }) => {
                write_response(
                    &mut writer,
                    &id,
                    json!({
                        "content": [{ "type": "text", "text": message }],
                        "structuredContent": structured,
                        "isError": true,
                    }),
                )?;
            }
        }
    }

    Ok(())
}

enum ServerResponse {
    JsonRpcError { code: i64, message: String },
    ToolError { message: String, structured: Value },
}

fn handle_request(
    artifact_service: &ArtifactService,
    workspace_path: &Path,
    request: JsonRpcRequest,
) -> Result<Value, ServerResponse> {
    match request.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": MCP_SERVER_NAME,
                "version": env!("CARGO_PKG_VERSION"),
            }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({
            "tools": [
                tool_definition(
                    "create_artifact",
                    "Create and autosave an artifact from a prepared .artifacts/<id> directory.",
                    json!({
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "title": { "type": "string" },
                            "renderer": {
                                "type": "string",
                                "enum": ["text", "markdown", "code", "html", "svg", "mermaid", "react"]
                            },
                            "entry": { "type": "string" }
                        },
                        "required": ["id", "title", "renderer", "entry"],
                        "additionalProperties": false
                    }),
                ),
                tool_definition(
                    "update_artifact",
                    "Update and autosave an existing artifact manifest.",
                    json!({
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "title": { "type": "string" },
                            "renderer": {
                                "type": "string",
                                "enum": ["text", "markdown", "code", "html", "svg", "mermaid", "react"]
                            },
                            "entry": { "type": "string" }
                        },
                        "required": ["id", "title", "renderer", "entry"],
                        "additionalProperties": false
                    }),
                ),
                tool_definition(
                    "list_artifacts",
                    "List artifacts for the current Cowork workspace.",
                    json!({ "type": "object", "properties": {}, "additionalProperties": false }),
                ),
                tool_definition(
                    "get_artifact",
                    "Get detail for one artifact in the current Cowork workspace.",
                    json!({
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" }
                        },
                        "required": ["id"],
                        "additionalProperties": false
                    }),
                ),
            ]
        })),
        "tools/call" => handle_tool_call(artifact_service, workspace_path, request.params),
        other => Err(ServerResponse::JsonRpcError {
            code: -32601,
            message: format!("method not found: {other}"),
        }),
    }
}

fn handle_tool_call(
    artifact_service: &ArtifactService,
    workspace_path: &Path,
    params: Option<Value>,
) -> Result<Value, ServerResponse> {
    let params = params.unwrap_or_else(|| json!({}));
    let tool_name =
        params
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| ServerResponse::JsonRpcError {
                code: -32602,
                message: "tools/call requires a tool name".to_string(),
            })?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match tool_name {
        "create_artifact" => {
            let args: ArtifactMutationArgs =
                serde_json::from_value(arguments).map_err(invalid_params_error)?;
            let input = build_mutation_input(args)?;
            let detail = artifact_service
                .create_workspace_artifact(workspace_path, &input)
                .map_err(map_tool_error)?;
            Ok(tool_result(json!({
                "artifact": detail,
                "action": "created",
            })))
        }
        "update_artifact" => {
            let args: ArtifactMutationArgs =
                serde_json::from_value(arguments).map_err(invalid_params_error)?;
            let input = build_mutation_input(args)?;
            let detail = artifact_service
                .update_workspace_artifact(workspace_path, &input)
                .map_err(map_tool_error)?;
            Ok(tool_result(json!({
                "artifact": detail,
                "action": "updated",
            })))
        }
        "list_artifacts" => {
            let artifacts = artifact_service
                .list_workspace_artifacts(workspace_path)
                .map_err(map_tool_error)?;
            Ok(tool_result(json!({ "artifacts": artifacts })))
        }
        "get_artifact" => {
            let args: ArtifactLookupArgs =
                serde_json::from_value(arguments).map_err(invalid_params_error)?;
            let artifact = artifact_service
                .get_workspace_artifact(workspace_path, &args.id)
                .map_err(map_tool_error)?;
            Ok(tool_result(json!({ "artifact": artifact })))
        }
        other => Err(ServerResponse::JsonRpcError {
            code: -32601,
            message: format!("unknown tool: {other}"),
        }),
    }
}

fn build_mutation_input(
    args: ArtifactMutationArgs,
) -> Result<ArtifactMutationInput, ServerResponse> {
    let renderer = ArtifactRendererKind::parse(args.renderer.trim()).ok_or_else(|| {
        ServerResponse::ToolError {
            message: format!("Unknown artifact renderer: {}", args.renderer),
            structured: json!({
                "code": "invalid_renderer",
                "renderer": args.renderer,
            }),
        }
    })?;
    Ok(ArtifactMutationInput {
        id: args.id,
        title: args.title,
        renderer,
        entry: args.entry,
    })
}

fn tool_definition(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

fn tool_result(structured: Value) -> Value {
    let text = serde_json::to_string_pretty(&structured).unwrap_or_else(|_| structured.to_string());
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": structured,
        "isError": false,
    })
}

#[cfg(test)]
mod tests {
    use super::{CoworkMcpProviderSource, COWORK_SYSTEM_PROMPT_APPEND};
    use crate::sessions::mcp::SessionMcpProviderSource;
    use crate::sessions::model::{SessionPermissionPolicy, SessionRecord};
    use crate::workspaces::model::WorkspaceRecord;
    use serde_json::json;
    use std::path::PathBuf;

    fn sample_session() -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            mode_locked: true,
            permission_policy: SessionPermissionPolicy::FailOnRequest,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
        }
    }

    fn sample_workspace(surface_kind: &str, is_internal: bool) -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: if is_internal {
                "repo".to_string()
            } else {
                "worktree".to_string()
            },
            surface_kind: surface_kind.to_string(),
            is_internal,
            path: "/tmp/workspace".to_string(),
            source_repo_root_path: "/tmp/workspace".to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: None,
            current_branch: None,
            display_name: None,
            default_session_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn provider_adds_startup_prompt_for_visible_cowork_workspaces() {
        let source = CoworkMcpProviderSource::new(PathBuf::from("/tmp/anyharness"));
        let prompt = source
            .system_prompt_append(&sample_session(), &sample_workspace("cowork", false))
            .expect("prompt lookup");

        assert_eq!(prompt.as_deref(), Some(COWORK_SYSTEM_PROMPT_APPEND));
    }

    #[test]
    fn provider_omits_startup_prompt_for_non_cowork_workspaces() {
        let source = CoworkMcpProviderSource::new(PathBuf::from("/tmp/anyharness"));
        let prompt = source
            .system_prompt_append(&sample_session(), &sample_workspace("code", false))
            .expect("prompt lookup");

        assert!(prompt.is_none());
    }

    #[test]
    fn provider_omits_startup_prompt_for_internal_cowork_repo() {
        let source = CoworkMcpProviderSource::new(PathBuf::from("/tmp/anyharness"));
        let prompt = source
            .system_prompt_append(&sample_session(), &sample_workspace("cowork", true))
            .expect("prompt lookup");

        assert!(prompt.is_none());
    }

    #[test]
    fn provider_adds_claude_startup_meta_for_visible_cowork_workspaces() {
        let source = CoworkMcpProviderSource::new(PathBuf::from("/tmp/anyharness"));
        let meta = source
            .startup_meta(&sample_session(), &sample_workspace("cowork", false))
            .expect("startup meta lookup");

        assert_eq!(
            meta,
            Some(serde_json::Map::from_iter([(
                "claudeCode".to_string(),
                json!({
                    "options": {
                        "strictMcpConfig": true,
                    },
                }),
            )]))
        );
    }
}

fn invalid_params_error(error: serde_json::Error) -> ServerResponse {
    ServerResponse::JsonRpcError {
        code: -32602,
        message: format!("invalid tool arguments: {error}"),
    }
}

fn map_tool_error(error: ArtifactServiceError) -> ServerResponse {
    ServerResponse::ToolError {
        message: error.to_string(),
        structured: json!({
            "code": error.problem_code(),
            "status": error.status_code(),
            "message": error.to_string(),
        }),
    }
}

fn read_request(reader: &mut impl BufRead) -> anyhow::Result<Option<JsonRpcRequest>> {
    let mut content_length: Option<usize> = None;
    let mut saw_header = false;

    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return if saw_header {
                Err(anyhow::anyhow!("unexpected EOF while reading MCP headers"))
            } else {
                Ok(None)
            };
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        saw_header = true;
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(value.trim().parse().context("parse Content-Length")?);
        }
    }

    let content_length = content_length.ok_or_else(|| anyhow::anyhow!("missing Content-Length"))?;
    let mut body = vec![0_u8; content_length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body).context("decode JSON-RPC request")
}

fn write_response(writer: &mut impl Write, id: &Value, result: Value) -> anyhow::Result<()> {
    write_message(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }),
    )
}

fn write_error(
    writer: &mut impl Write,
    id: &Value,
    code: i64,
    message: &str,
) -> anyhow::Result<()> {
    write_message(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": code,
                "message": message,
            }
        }),
    )
}

fn write_message(writer: &mut impl Write, payload: &Value) -> anyhow::Result<()> {
    let body = serde_json::to_vec(payload).context("encode JSON-RPC response")?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()?;
    Ok(())
}
