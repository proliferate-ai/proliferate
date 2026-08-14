//! The v2 workflow definition DSL and its validation, plus the frozen
//! invocation snapshot the courier delivers. Validation is identical on both
//! planes (CP Python and here) and kept in lockstep by the shared contract
//! fixtures (`fixtures/contracts/workflow-definition/`): edges form exactly
//! one linear path covering all nodes, node ids and doc slugs are unique,
//! every `@input:`/`@doc:` reference resolves, `model` is optional per node.
//! One grammar on every plane: doc slugs are `[a-z0-9]+(-[a-z0-9]+)*`, input
//! names `[A-Za-z][A-Za-z0-9_]*`, node ids `[A-Za-z][A-Za-z0-9_-]*`.
//! References are scanned (case-insensitive sigil detection, `[^\s@]+` token,
//! trailing prose punctuation peeled) and the peeled token validated: a
//! malformed reference — wrong-case sigil included — is an error, never a
//! silent non-match or a prefix match (Ruling C.1).
//! Nothing about placement lives in the definition; placement is a run-time
//! binding frozen into the invocation.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::model::WorkflowNodeType;

pub const DEFINITION_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeModel {
    pub agent_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionInput {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocTemplate {
    pub slug: String,
    /// Required on every plane: every doc has exactly one producing node, and
    /// the filename law (`NN-slug.md`) derives NN from that node's chain
    /// position.
    pub producing_node_id: String,
    pub body: String,
}

/// The frozen `invocation_json` the courier PUTs to the runtime, verbatim from
/// CP. The runtime revalidates the whole snapshot regardless of server checks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvocationSnapshot {
    pub schema_version: u32,
    pub workflow_definition_id: String,
    pub definition: WorkflowDefinition,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    pub placement: InvocationPlacement,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvocationPlacement {
    pub repo_config_id: String,
    pub mode: PlacementMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
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
            if !is_valid_node_id(&node.id) {
                return Err(invalid(format!(
                    "node id '{}' must match [A-Za-z][A-Za-z0-9_-]*",
                    node.id
                )));
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
            if !is_valid_doc_slug(&template.slug) {
                return Err(invalid(format!(
                    "doc slug '{}' must match [a-z0-9]+(-[a-z0-9]+)*",
                    template.slug
                )));
            }
            if !doc_slugs.insert(template.slug.as_str()) {
                return Err(invalid(format!("duplicate doc slug '{}'", template.slug)));
            }
            if !node_ids.contains(template.producing_node_id.as_str()) {
                return Err(invalid(format!(
                    "doc template '{}' names unknown producing node '{}'",
                    template.slug, template.producing_node_id
                )));
            }
        }

        let mut input_names = HashSet::new();
        for input in &self.inputs {
            if !is_valid_input_name(&input.name) {
                return Err(invalid(format!(
                    "input name '{}' must match [A-Za-z][A-Za-z0-9_]*",
                    input.name
                )));
            }
            if !input_names.insert(input.name.as_str()) {
                return Err(invalid(format!("duplicate input name '{}'", input.name)));
            }
        }

        let chain = self.linear_chain(&node_ids)?;

        for node in &self.nodes {
            let references = parse_references(&node.prompt)
                .map_err(|error| invalid(format!("node '{}': {}", node.id, error.detail)))?;
            for reference in references {
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

/// A parsed `@input:name` or `@doc:slug` token. The grammar is slug-only;
/// the engine derives NN filename prefixes from chain position at render
/// time, so builder reorders never break prompts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptReference {
    Input(String),
    Doc(String),
}

/// Doc slug grammar: `[a-z0-9]+(-[a-z0-9]+)*` — lowercase alphanumeric
/// segments joined by single dashes. This is also the path-safety guarantee:
/// a valid slug can never traverse (`..`, `/`, absolute paths all fail).
pub fn is_valid_doc_slug(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Input name grammar: `[A-Za-z][A-Za-z0-9_]*`.
pub fn is_valid_input_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Node id grammar: `[A-Za-z][A-Za-z0-9_-]*`.
pub fn is_valid_node_id(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A reference the scan found whose token fails its grammar. Malformed
/// references are validation errors, never silent non-matches: `@doc:plan.md`
/// is rejected, not prefix-matched to `plan`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceError {
    pub detail: String,
}

impl std::fmt::Display for ReferenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.detail)
    }
}

/// Trailing prose punctuation peeled off a captured token before grammar
/// validation, so `@doc:research-findings.` is a valid reference followed by
/// a sentence period while `@doc:plan.md` stays a hard error (Ruling C.1).
fn is_peelable_punctuation(c: char) -> bool {
    matches!(
        c,
        '.' | ','
            | ';'
            | ':'
            | '!'
            | '?'
            | ')'
            | ']'
            | '}'
            | '>'
            | '"'
            | '\''
            | '`'
            | '*'
            | '»'
            | '\u{201C}'
            | '\u{201D}'
            | '\u{2019}'
            | '\u{2026}'
    )
}

/// One scanned reference occurrence: the byte span of `@sigil:token` in the
/// prompt (peeled punctuation excluded) and its parse outcome.
struct ScannedReference {
    start: usize,
    end: usize,
    outcome: Result<PromptReference, ReferenceError>,
}

/// The ONE scan (Ruling C.1) that both [`parse_references`] and
/// [`resolve_references`] consume, so validation and rendering can never
/// disagree about what is a reference: detect the `@doc:`/`@input:` sigils
/// case-INsensitively (a wrong-case sigil is an error, never silent literal
/// text), capture the maximal `[^\s@]+` token, peel trailing prose
/// punctuation, then validate the peeled token against the per-kind grammar.
/// A malformed reference is an error entry, never a silent non-match or a
/// prefix match.
fn scan_references(prompt: &str) -> Vec<ScannedReference> {
    let mut scanned = Vec::new();
    let mut i = 0;
    while let Some(offset) = prompt[i..].find('@') {
        let at = i + offset;
        let rest = &prompt[at + 1..];
        let sigil = ["input:", "doc:"].into_iter().find(|sigil| {
            rest.get(..sigil.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(sigil))
        });
        let Some(sigil) = sigil else {
            i = at + 1;
            continue;
        };
        let body = &rest[sigil.len()..];
        let raw_end = body
            .find(|c: char| c.is_whitespace() || c == '@')
            .unwrap_or(body.len());
        let raw_token = &body[..raw_end];
        if raw_token.is_empty() {
            // A bare sigil with nothing after it is not a reference attempt.
            i = at + 1 + sigil.len();
            continue;
        }
        if !rest.starts_with(sigil) {
            scanned.push(ScannedReference {
                start: at,
                end: at + 1 + sigil.len() + raw_token.len(),
                outcome: Err(ReferenceError {
                    detail: format!("reference sigils are lowercase: write @{sigil}{raw_token}"),
                }),
            });
            i = at + 1 + sigil.len() + raw_token.len();
            continue;
        }
        let token = raw_token.trim_end_matches(is_peelable_punctuation);
        let kind = &sigil[..sigil.len() - 1];
        let outcome = match kind {
            "input" if is_valid_input_name(token) => Ok(PromptReference::Input(token.to_string())),
            "doc" if is_valid_doc_slug(token) => Ok(PromptReference::Doc(token.to_string())),
            _ => {
                let grammar = match kind {
                    "input" => "[A-Za-z][A-Za-z0-9_]*",
                    _ => "[a-z0-9]+(-[a-z0-9]+)*",
                };
                Err(ReferenceError {
                    detail: format!("malformed reference @{kind}:{token} (must match {grammar})"),
                })
            }
        };
        // A malformed token spans its raw capture; a valid one only what the
        // grammar accepted (the peeled punctuation stays prose).
        let consumed = match &outcome {
            Ok(_) => token.len(),
            Err(_) => raw_token.len(),
        };
        scanned.push(ScannedReference {
            start: at,
            end: at + 1 + sigil.len() + consumed,
            outcome,
        });
        i = at + 1 + sigil.len() + consumed;
    }
    scanned
}

/// Scan-then-validate over the one shared scan. The first malformed
/// reference fails the parse.
pub fn parse_references(prompt: &str) -> Result<Vec<PromptReference>, ReferenceError> {
    scan_references(prompt)
        .into_iter()
        .map(|scanned| scanned.outcome)
        .collect()
}

/// How [`resolve_references`] treats references it cannot rewrite (Ruling E).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveMode {
    /// Definition prompts: validation precedes, so a malformed or
    /// unresolvable reference here means the rows and definition disagree —
    /// fail the render.
    Strict,
    /// Redo-edited and ad hoc prompts — whatever the user typed: resolvable
    /// references resolve, everything else passes through as literal text.
    /// Never a launch refusal on a legal user action.
    Lenient,
}

/// Why a strict rewrite failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// The scan found a malformed reference (wrong-case sigil or
    /// grammar-failing token).
    Malformed(ReferenceError),
    /// A well-formed reference the resolver returned `None` for.
    Unresolved(PromptReference),
}

/// Rewrite every reference in `prompt` through `resolve`, passing all other
/// text through verbatim. Consumes the same scan as [`parse_references`], so
/// the two can never drift. Lenient mode never fails.
pub fn resolve_references(
    prompt: &str,
    mode: ResolveMode,
    mut resolve: impl FnMut(&PromptReference) -> Option<String>,
) -> Result<String, ResolveError> {
    let mut output = String::with_capacity(prompt.len());
    let mut i = 0;
    for scanned in scan_references(prompt) {
        output.push_str(&prompt[i..scanned.start]);
        i = scanned.end;
        let literal = &prompt[scanned.start..scanned.end];
        match scanned.outcome {
            Ok(reference) => match resolve(&reference) {
                Some(replacement) => output.push_str(&replacement),
                None => match mode {
                    ResolveMode::Strict => return Err(ResolveError::Unresolved(reference)),
                    ResolveMode::Lenient => output.push_str(literal),
                },
            },
            Err(error) => match mode {
                ResolveMode::Strict => return Err(ResolveError::Malformed(error)),
                ResolveMode::Lenient => output.push_str(literal),
            },
        }
    }
    output.push_str(&prompt[i..]);
    Ok(output)
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
                return Err(invalid(format!(
                    "argument '{name}' is not a declared input"
                )));
            }
        }
        Ok(chain)
    }
}
