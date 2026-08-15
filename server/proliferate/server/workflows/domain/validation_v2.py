"""Pure cross-field validation for gen-2 workflow definition documents.

Catalog-free by design: the identical rules run on the runtime plane (which
has no CP catalog), kept in lockstep through the shared contract fixtures in
``fixtures/contracts/workflow-definition/``. Issue paths are document-relative
(``nodes.1.id``), matching the fixtures on both planes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from proliferate.server.workflows.models_v2 import WorkflowDefinitionDocumentV2

# Scan-then-validate (Ruling C, amended C.1): sigils are detected
# case-INsensitively so a wrong-case sigil is an error, not silent literal
# text; the capture stops at whitespace or the next '@' (back-to-back
# references parse individually); trailing prose punctuation peels off the
# token before grammar validation, so a sentence may end directly after a
# reference. Malformed = wrong-case sigil, empty token, or grammar-fail after
# the peel. Trailing junk that does not peel ('@doc:plan.md') stays an error,
# not a prefix match.
REFERENCE_SCAN_PATTERN = re.compile(r"@(input|doc):([^\s@]*)", re.IGNORECASE)
TRAILING_PROSE_PUNCTUATION_PATTERN = re.compile("[.,;:!?)\\]}>\"'`*»“”‘’…]+\\Z")
INPUT_NAME_TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_]*\Z")
DOC_SLUG_TOKEN_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


@dataclass(frozen=True)
class DefinitionV2Issue:
    path: str
    message: str


@dataclass(frozen=True)
class PromptReference:
    sigil: str
    """The sigil word exactly as written (e.g. ``INPUT`` in ``@INPUT:x``)."""

    kind: str
    """Lowercased sigil: ``input`` or ``doc``."""

    token: str
    """The captured token after peeling trailing prose punctuation."""

    raw_token: str
    """The captured token as written, punctuation included."""

    @property
    def well_formed_sigil(self) -> bool:
        return self.sigil == self.kind


def validate_definition_v2_document(
    document: WorkflowDefinitionDocumentV2,
) -> DefinitionV2Issue | None:
    """Return the first structural issue, or None for a valid document."""

    node_ids: set[str] = set()
    for index, node in enumerate(document.nodes):
        if node.id in node_ids:
            return DefinitionV2Issue(
                path=f"nodes.{index}.id",
                message=f"Node id '{node.id}' is duplicated.",
            )
        node_ids.add(node.id)

    issue = _validate_linear_path(document, node_ids)
    if issue is not None:
        return issue

    input_names: set[str] = set()
    for index, input_definition in enumerate(document.inputs):
        if input_definition.name in input_names:
            return DefinitionV2Issue(
                path=f"inputs.{index}.name",
                message=f"Input name '{input_definition.name}' is duplicated.",
            )
        input_names.add(input_definition.name)

    doc_slugs: set[str] = set()
    for index, template in enumerate(document.doc_templates):
        if template.slug in doc_slugs:
            return DefinitionV2Issue(
                path=f"docTemplates.{index}.slug",
                message=f"Doc template slug '{template.slug}' is duplicated.",
            )
        doc_slugs.add(template.slug)
        if template.producing_node_id not in node_ids:
            return DefinitionV2Issue(
                path=f"docTemplates.{index}.producingNodeId",
                message=(
                    f"Doc template '{template.slug}' names unknown producing node "
                    f"'{template.producing_node_id}'."
                ),
            )

    for index, node in enumerate(document.nodes):
        for reference in scan_prompt_references(node.prompt):
            problem = _validate_reference(reference, input_names, doc_slugs)
            if problem is not None:
                return DefinitionV2Issue(path=f"nodes.{index}.prompt", message=problem)

    return None


def scan_prompt_references(prompt: str) -> list[PromptReference]:
    """Every reference attempt in a prompt, sigils matched case-insensitively."""

    references: list[PromptReference] = []
    for match in REFERENCE_SCAN_PATTERN.finditer(prompt):
        raw_token = match.group(2)
        references.append(
            PromptReference(
                sigil=match.group(1),
                kind=match.group(1).lower(),
                token=TRAILING_PROSE_PUNCTUATION_PATTERN.sub("", raw_token),
                raw_token=raw_token,
            )
        )
    return references


def _validate_reference(
    reference: PromptReference,
    input_names: set[str],
    doc_slugs: set[str],
) -> str | None:
    kind = reference.kind
    if not reference.well_formed_sigil:
        return (
            f"Prompt contains malformed @{kind}: reference "
            f"'@{reference.sigil}:{reference.raw_token}' (sigils are lowercase)."
        )
    if not reference.token:
        return f"Prompt contains malformed @{kind}: reference with an empty token."
    grammar = INPUT_NAME_TOKEN_PATTERN if kind == "input" else DOC_SLUG_TOKEN_PATTERN
    if grammar.fullmatch(reference.token) is None:
        return f"Prompt contains malformed @{kind}: reference '{reference.token}'."
    if kind == "input" and reference.token not in input_names:
        return f"Prompt references undeclared input '{reference.token}'."
    if kind == "doc" and reference.token not in doc_slugs:
        return f"Prompt references undeclared doc '{reference.token}'."
    return None


def _validate_linear_path(
    document: WorkflowDefinitionDocumentV2,
    node_ids: set[str],
) -> DefinitionV2Issue | None:
    """Edges must form exactly one linear path covering every node."""

    outgoing: dict[str, str] = {}
    incoming: dict[str, str] = {}
    for index, edge in enumerate(document.edges):
        if edge.from_node not in node_ids:
            return DefinitionV2Issue(
                path=f"edges.{index}.from",
                message=f"Edge names unknown node '{edge.from_node}'.",
            )
        if edge.to_node not in node_ids:
            return DefinitionV2Issue(
                path=f"edges.{index}.to",
                message=f"Edge names unknown node '{edge.to_node}'.",
            )
        if edge.from_node in outgoing:
            return DefinitionV2Issue(
                path=f"edges.{index}.from",
                message=f"Node '{edge.from_node}' has more than one outgoing edge.",
            )
        if edge.to_node in incoming:
            return DefinitionV2Issue(
                path=f"edges.{index}.to",
                message=f"Node '{edge.to_node}' has more than one incoming edge.",
            )
        outgoing[edge.from_node] = edge.to_node
        incoming[edge.to_node] = edge.from_node

    if len(document.edges) != len(node_ids) - 1:
        return DefinitionV2Issue(
            path="edges",
            message=(
                "Edges must form exactly one linear path covering all nodes "
                f"({len(node_ids)} nodes need {len(node_ids) - 1} edges, "
                f"got {len(document.edges)})."
            ),
        )

    heads = [node.id for node in document.nodes if node.id not in incoming]
    if len(heads) != 1:
        return DefinitionV2Issue(
            path="edges",
            message="Edges must form exactly one linear path with a single first node.",
        )

    visited = 0
    cursor: str | None = heads[0]
    while cursor is not None:
        visited += 1
        cursor = outgoing.get(cursor)
    if visited != len(node_ids):
        return DefinitionV2Issue(
            path="edges",
            message="Edges must form exactly one linear path covering all nodes.",
        )

    return None
