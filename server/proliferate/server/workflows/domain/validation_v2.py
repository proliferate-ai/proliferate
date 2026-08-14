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

INPUT_REFERENCE_PATTERN = re.compile(r"@input:([A-Za-z][A-Za-z0-9_]*)")
DOC_REFERENCE_PATTERN = re.compile(r"@doc:([a-z0-9]+(?:-[a-z0-9]+)*)")


@dataclass(frozen=True)
class DefinitionV2Issue:
    path: str
    message: str


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
        for name in INPUT_REFERENCE_PATTERN.findall(node.prompt):
            if name not in input_names:
                return DefinitionV2Issue(
                    path=f"nodes.{index}.prompt",
                    message=f"Prompt references undeclared input '{name}'.",
                )
        for slug in DOC_REFERENCE_PATTERN.findall(node.prompt):
            if slug not in doc_slugs:
                return DefinitionV2Issue(
                    path=f"nodes.{index}.prompt",
                    message=f"Prompt references undeclared doc '{slug}'.",
                )

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
