"""Pure Slack repo routing heuristics."""

from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class RepoRoutingCandidate:
    cloud_repo_config_id: UUID
    git_owner: str
    git_repo_name: str
    display_name: str | None
    description: str | None
    readme_summary: str | None
    languages: tuple[str, ...] = ()
    topics: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepoRoutingChoice:
    cloud_repo_config_id: UUID | None
    reason: str
    ambiguous: bool = False


def choose_repo(
    *,
    message_text: str,
    repo_hint: str | None,
    candidates: tuple[RepoRoutingCandidate, ...],
) -> RepoRoutingChoice:
    if not candidates:
        return RepoRoutingChoice(None, "no_candidates")
    if repo_hint:
        normalized_hint = _normalize(repo_hint)
        exact = [
            candidate
            for candidate in candidates
            if normalized_hint
            in {
                _normalize(candidate.git_repo_name),
                _normalize(f"{candidate.git_owner}/{candidate.git_repo_name}"),
                _normalize(candidate.display_name or ""),
            }
        ]
        if len(exact) == 1:
            return RepoRoutingChoice(exact[0].cloud_repo_config_id, "hint_exact")
    if len(candidates) == 1:
        return RepoRoutingChoice(candidates[0].cloud_repo_config_id, "single_candidate")

    query_terms = _terms(" ".join(item for item in (message_text, repo_hint or "") if item))
    scored = sorted(
        ((candidate, _score(query_terms, candidate)) for candidate in candidates),
        key=lambda item: item[1],
        reverse=True,
    )
    if not scored or scored[0][1] <= 0:
        return RepoRoutingChoice(None, "no_match", ambiguous=True)
    if len(scored) > 1 and scored[0][1] == scored[1][1]:
        return RepoRoutingChoice(None, "tie", ambiguous=True)
    return RepoRoutingChoice(scored[0][0].cloud_repo_config_id, "keyword_score")


def _score(query_terms: set[str], candidate: RepoRoutingCandidate) -> int:
    haystack = _terms(
        " ".join(
            [
                candidate.git_owner,
                candidate.git_repo_name,
                candidate.display_name or "",
                candidate.description or "",
                candidate.readme_summary or "",
                " ".join(candidate.languages),
                " ".join(candidate.topics),
            ]
        )
    )
    return len(query_terms & haystack)


def _terms(value: str) -> set[str]:
    return {term for term in re.split(r"[^a-z0-9]+", _normalize(value)) if len(term) >= 2}


def _normalize(value: str) -> str:
    return value.strip().lower()
