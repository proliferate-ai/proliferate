//! The v2 workflow definition DSL and its validation, plus the frozen
//! invocation snapshot the courier delivers. Validation is identical on both
//! planes (CP Python and here) and kept in lockstep by the shared contract
//! fixtures (`fixtures/contracts/workflow-definition/`): edges form exactly
//! one linear path covering all nodes, node ids and doc slugs are unique,
//! every `@input:`/`@doc:` reference resolves, `model` is optional per node.
//! Nothing about placement lives in the definition; placement is a run-time
//! binding frozen into the invocation.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::model::WorkflowNodeType;

pub const DEFINITION_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowDefinition {
    pub schema_version: u32,
    pub nodes: Vec<DefinitionNode>,
    pub edges: Vec<DefinitionEdge>,
    #[serde(default)]
    pub inputs: Vec<DefinitionInput>,
    #[serde(default)]
    pub doc_templates: Vec<DocTemplate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: WorkflowNodeType,
    pub title: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<NodeModel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeModel {
    pub agent_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionInput {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocTemplate {
    pub slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producing_node_id: Option<String>,
    pub body: String,
}

/// The frozen `invocation_json` the courier PUTs to the runtime, verbatim from
/// CP. The runtime revalidates the whole snapshot regardless of server checks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvocationSnapshot {
    pub schema_version: u32,
    pub workflow_definition_id: String,
    pub definition: WorkflowDefinition,
    #[serde(default)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    pub placement: InvocationPlacement,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvocationPlacement {
    pub repo_config_id: String,
    pub mode: PlacementMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementMode {
    Worktree,
    RepoRoot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefinitionValidationError {
    pub detail: String,
}

impl std::fmt::Display for DefinitionValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.detail)
    }
}

impl std::error::Error for DefinitionValidationError {}

fn invalid(detail: impl Into<String>) -> DefinitionValidationError {
    DefinitionValidationError {
        detail: detail.into(),
    }
}

impl WorkflowDefinition {
    /// Validate the whole definition. Returns the node ids in chain order on
    /// success, so callers materialize node rows without re-deriving the path.
    pub fn validate(&self) -> Result<Vec<String>, DefinitionValidationError> {
        if self.schema_version != DEFINITION_SCHEMA_VERSION {
            return Err(invalid(format!(
                "schemaVersion must be {DEFINITION_SCHEMA_VERSION}, got {}",
                self.schema_version
            )));
        }
        if self.nodes.is_empty() {
            return Err(invalid("a workflow needs at least one node"));
        }

        let mut node_ids = HashSet::new();
        for node in &self.nodes {
            if node.id.trim().is_empty() {
                return Err(invalid("node ids must be non-empty"));
            }
            if node.title.trim().is_empty() {
                return Err(invalid(format!("node '{}' needs a title", node.id)));
            }
            if !node_ids.insert(node.id.as_str()) {
                return Err(invalid(format!("duplicate node id '{}'", node.id)));
            }
        }

        let mut doc_slugs = HashSet::new();
        for template in &self.doc_templates {
            if template.slug.trim().is_empty() {
                return Err(invalid("doc template slugs must be non-empty"));
            }
            if !doc_slugs.insert(template.slug.as_str()) {
                return Err(invalid(format!("duplicate doc slug '{}'", template.slug)));
            }
            if let Some(producer) = &template.producing_node_id {
                if !node_ids.contains(producer.as_str()) {
                    return Err(invalid(format!(
                        "doc template '{}' names unknown producing node '{producer}'",
                        template.slug
                    )));
                }
            }
        }

        let mut input_names = HashSet::new();
        for input in &self.inputs {
            if input.name.trim().is_empty() {
                return Err(invalid("input names must be non-empty"));
            }
            if !input_names.insert(input.name.as_str()) {
                return Err(invalid(format!("duplicate input name '{}'", input.name)));
            }
        }

        let chain = self.linear_chain(&node_ids)?;

        for node in &self.nodes {
            for reference in parse_references(&node.prompt) {
                match reference {
                    PromptReference::Input(name) => {
                        if !input_names.contains(name.as_str()) {
                            return Err(invalid(format!(
                                "node '{}' references undeclared @input:{name}",
                                node.id
                            )));
                        }
                    }
                    PromptReference::Doc(slug) => {
                        if !doc_slugs.contains(slug.as_str()) {
                            return Err(invalid(format!(
                                "node '{}' references unknown @doc:{slug}",
                                node.id
                            )));
                        }
                    }
                }
            }
        }

        Ok(chain)
    }

    /// Edges must form exactly one linear path covering all nodes: n-1 edges,
    /// unique from/to endpoints, one source, one sink, fully connected.
    fn linear_chain(
        &self,
        node_ids: &HashSet<&str>,
    ) -> Result<Vec<String>, DefinitionValidationError> {
        if self.edges.len() + 1 != self.nodes.len() {
            return Err(invalid(format!(
                "a linear chain of {} nodes needs exactly {} edges, got {}",
                self.nodes.len(),
                self.nodes.len() - 1,
                self.edges.len()
            )));
        }
        let mut next: HashMap<&str, &str> = HashMap::new();
        let mut has_incoming: HashSet<&str> = HashSet::new();
        for edge in &self.edges {
            if !node_ids.contains(edge.from.as_str()) {
                return Err(invalid(format!("edge from unknown node '{}'", edge.from)));
            }
            if !node_ids.contains(edge.to.as_str()) {
                return Err(invalid(format!("edge to unknown node '{}'", edge.to)));
            }
            if next.insert(edge.from.as_str(), edge.to.as_str()).is_some() {
                return Err(invalid(format!(
                    "node '{}' has more than one outgoing edge; v1 validates linearity",
                    edge.from
                )));
            }
            if !has_incoming.insert(edge.to.as_str()) {
                return Err(invalid(format!(
                    "node '{}' has more than one incoming edge; v1 validates linearity",
                    edge.to
                )));
            }
        }
        let mut sources = self
            .nodes
            .iter()
            .filter(|node| !has_incoming.contains(node.id.as_str()))
            .map(|node| node.id.as_str());
        let head = sources
            .next()
            .ok_or_else(|| invalid("edges form a cycle; v1 validates linearity"))?;
        if let Some(second) = sources.next() {
            return Err(invalid(format!(
                "edges leave more than one chain head ('{head}', '{second}'); \
                 v1 validates one linear path"
            )));
        }
        let mut chain = Vec::with_capacity(self.nodes.len());
        let mut cursor = Some(head);
        let mut seen = HashSet::new();
        while let Some(id) = cursor {
            if !seen.insert(id) {
                return Err(invalid("edges form a cycle; v1 validates linearity"));
            }
            chain.push(id.to_string());
            cursor = next.get(id).copied();
        }
        if chain.len() != self.nodes.len() {
            return Err(invalid(
                "edges do not connect all nodes into one path; v1 validates linearity",
            ));
        }
        Ok(chain)
    }
}

/// A parsed `@input:name` or `@doc:slug` token. The grammar is slug-only
/// (`[A-Za-z0-9_-]+`); the engine derives NN filename prefixes from chain
/// position at render time, so builder reorders never break prompts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptReference {
    Input(String),
    Doc(String),
}

pub fn parse_references(prompt: &str) -> Vec<PromptReference> {
    let mut references = Vec::new();
    let bytes = prompt.as_bytes();
    let mut i = 0;
    while let Some(offset) = prompt[i..].find('@') {
        let at = i + offset;
        let rest = &prompt[at + 1..];
        let (kind, body) = if let Some(body) = rest.strip_prefix("input:") {
            (Some(PromptReference::Input(String::new())), body)
        } else if let Some(body) = rest.strip_prefix("doc:") {
            (Some(PromptReference::Doc(String::new())), body)
        } else {
            (None, rest)
        };
        match kind {
            None => i = at + 1,
            Some(kind) => {
                let name: String = body
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                    .collect();
                let consumed = at
                    + 1
                    + match &kind {
                        PromptReference::Input(_) => "input:".len(),
                        PromptReference::Doc(_) => "doc:".len(),
                    }
                    + name.len();
                if name.is_empty() {
                    i = at + 1;
                    continue;
                }
                references.push(match kind {
                    PromptReference::Input(_) => PromptReference::Input(name),
                    PromptReference::Doc(_) => PromptReference::Doc(name),
                });
                i = consumed;
            }
        }
        if i >= bytes.len() {
            break;
        }
    }
    references
}

impl InvocationSnapshot {
    /// Full runtime-side revalidation of a courier-delivered snapshot:
    /// definition validity, argument coverage for required inputs, and no
    /// arguments outside the declared inputs. Returns the chain order.
    pub fn validate(&self) -> Result<Vec<String>, DefinitionValidationError> {
        if self.schema_version != DEFINITION_SCHEMA_VERSION {
            return Err(invalid(format!(
                "invocation schemaVersion must be {DEFINITION_SCHEMA_VERSION}, got {}",
                self.schema_version
            )));
        }
        let chain = self.definition.validate()?;
        let declared: HashSet<&str> = self
            .definition
            .inputs
            .iter()
            .map(|input| input.name.as_str())
            .collect();
        for input in &self.definition.inputs {
            if input.required && !self.arguments.contains_key(&input.name) {
                return Err(invalid(format!(
                    "required input '{}' has no argument",
                    input.name
                )));
            }
        }
        for name in self.arguments.keys() {
            if !declared.contains(name.as_str()) {
                return Err(invalid(format!("argument '{name}' is not a declared input")));
            }
        }
        Ok(chain)
    }
}
