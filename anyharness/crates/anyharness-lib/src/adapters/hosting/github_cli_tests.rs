use serde_json::json;

use super::*;

fn repo(owner: &str, name: &str) -> GithubRepo {
    GithubRepo {
        owner: owner.to_string(),
        name: name.to_string(),
    }
}

#[test]
fn parses_supported_github_remote_url_forms() {
    for (url, expected) in [
        ("git@github.com:acme/widgets.git", repo("acme", "widgets")),
        ("git@github.com:acme/widgets", repo("acme", "widgets")),
        (
            "https://github.com/acme/widgets.git",
            repo("acme", "widgets"),
        ),
        ("https://github.com/acme/widgets", repo("acme", "widgets")),
        ("https://github.com/acme/widgets/", repo("acme", "widgets")),
        (
            "ssh://git@github.com/acme/widgets.git",
            repo("acme", "widgets"),
        ),
        ("ssh://github.com/acme/widgets", repo("acme", "widgets")),
        ("git://github.com/acme/widgets.git", repo("acme", "widgets")),
        (
            "  https://github.com/acme/widgets.git\n",
            repo("acme", "widgets"),
        ),
        (
            "git@github.com:acme/repo.with.dots.git",
            repo("acme", "repo.with.dots"),
        ),
    ] {
        assert_eq!(
            parse_github_remote_url(url).as_ref(),
            Some(&expected),
            "url: {url}"
        );
    }
}

#[test]
fn rejects_non_github_and_malformed_remote_urls() {
    for url in [
        "git@gitlab.com:acme/widgets.git",
        "https://gitlab.com/acme/widgets.git",
        "https://bitbucket.org/acme/widgets.git",
        "ssh://git@github.example.com/acme/widgets.git",
        "https://github.enterprise.dev/acme/widgets",
        "git@github.com:acme",
        "https://github.com/acme",
        "https://github.com/acme/widgets/extra",
        "https://github.com//widgets",
        "",
        "not a url",
    ] {
        assert_eq!(parse_github_remote_url(url), None, "url: {url}");
    }
}

#[test]
fn builds_branch_query_with_variables_and_aliases() {
    let query = build_branch_prs_query(2);
    assert!(query.contains("$owner: String!"));
    assert!(query.contains("$name: String!"));
    assert!(query.contains("$b0: String!"));
    assert!(query.contains("$b1: String!"));
    assert!(!query.contains("$b2"));
    assert!(query.contains("pr0: pullRequests(headRefName: $b0"));
    assert!(query.contains("pr1: pullRequests(headRefName: $b1"));
    assert!(query.contains("states: [OPEN, MERGED, CLOSED]"));
    assert!(query.contains("orderBy: {field: UPDATED_AT, direction: DESC}"));
    assert!(query.contains("statusCheckRollup { state }"));
    assert!(query.contains("reviewDecision"));
}

/// Fixture mirrors a real `gh api graphql` response (validated against
/// github.com): pr0 open draft with failing checks, pr1 merged, pr2 no
/// PR for the branch.
#[test]
fn maps_graphql_response_to_branch_statuses() {
    let fixture = json!({
        "data": {
            "repository": {
                "pr0": {
                    "nodes": [{
                        "number": 865,
                        "url": "https://github.com/acme/widgets/pull/865",
                        "title": "feat: admin emails",
                        "state": "OPEN",
                        "isDraft": true,
                        "baseRefName": "main",
                        "headRefName": "feat/admin-emails",
                        "reviewDecision": null,
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": { "state": "FAILURE" }
                                }
                            }]
                        }
                    }]
                },
                "pr1": {
                    "nodes": [{
                        "number": 864,
                        "url": "https://github.com/acme/widgets/pull/864",
                        "title": "style: fades",
                        "state": "MERGED",
                        "isDraft": false,
                        "baseRefName": "main",
                        "headRefName": "ux/fades",
                        "reviewDecision": "APPROVED",
                        "commits": {
                            "nodes": [{
                                "commit": { "statusCheckRollup": null }
                            }]
                        }
                    }]
                },
                "pr2": { "nodes": [] }
            }
        }
    });
    let branches = vec![
        "feat/admin-emails".to_string(),
        "ux/fades".to_string(),
        "no-pr-branch".to_string(),
    ];

    let entries = parse_branch_prs_response(&fixture, &branches).expect("parse fixture");
    assert_eq!(entries.len(), 3);

    let open = &entries[0];
    assert_eq!(open.head_branch, "feat/admin-emails");
    let pr = open.pull_request.as_ref().expect("pr0 present");
    assert_eq!(pr.number, 865);
    assert_eq!(pr.state, PullRequestState::Open);
    assert!(pr.draft);
    assert_eq!(pr.base_branch, "main");
    assert_eq!(pr.head_branch, "feat/admin-emails");
    assert_eq!(pr.checks, Some(PullRequestChecksState::Failing));
    assert_eq!(pr.review_decision, Some(PullRequestReviewDecision::None));

    let merged = &entries[1];
    let pr = merged.pull_request.as_ref().expect("pr1 present");
    assert_eq!(pr.state, PullRequestState::Merged);
    assert!(!pr.draft);
    assert_eq!(pr.checks, Some(PullRequestChecksState::None));
    assert_eq!(
        pr.review_decision,
        Some(PullRequestReviewDecision::Approved)
    );

    // Queried branch with no PR: authoritative none.
    let none = &entries[2];
    assert_eq!(none.head_branch, "no-pr-branch");
    assert!(none.pull_request.is_none());
}

#[test]
fn maps_pending_and_changes_requested_states() {
    let fixture = json!({
        "data": {
            "repository": {
                "pr0": {
                    "nodes": [{
                        "number": 7,
                        "url": "https://github.com/acme/widgets/pull/7",
                        "title": "wip",
                        "state": "CLOSED",
                        "isDraft": false,
                        "baseRefName": "main",
                        "headRefName": "wip",
                        "reviewDecision": "CHANGES_REQUESTED",
                        "commits": {
                            "nodes": [{
                                "commit": {
                                    "statusCheckRollup": { "state": "PENDING" }
                                }
                            }]
                        }
                    }]
                }
            }
        }
    });
    let entries = parse_branch_prs_response(&fixture, &["wip".to_string()]).expect("parse");
    let pr = entries[0].pull_request.as_ref().expect("pr present");
    assert_eq!(pr.state, PullRequestState::Closed);
    assert_eq!(pr.checks, Some(PullRequestChecksState::Pending));
    assert_eq!(
        pr.review_decision,
        Some(PullRequestReviewDecision::ChangesRequested)
    );
}

#[test]
fn graphql_missing_repository_is_command_failure() {
    let fixture = json!({ "data": { "repository": null } });
    let error = parse_branch_prs_response(&fixture, &["main".to_string()])
        .expect_err("null repository should fail");
    assert!(matches!(error, GhError::CommandFailed(_)));
}

#[test]
fn reduces_pr_view_check_rollup_contexts() {
    // Empty / absent rollups.
    assert_eq!(
        reduce_check_rollup(&serde_json::Value::Null),
        PullRequestChecksState::None
    );
    assert_eq!(
        reduce_check_rollup(&json!([])),
        PullRequestChecksState::None
    );
    // All successful CheckRuns + StatusContexts.
    assert_eq!(
        reduce_check_rollup(&json!([
            { "status": "COMPLETED", "conclusion": "SUCCESS" },
            { "state": "SUCCESS" },
            { "status": "COMPLETED", "conclusion": "SKIPPED" },
        ])),
        PullRequestChecksState::Passing
    );
    // Any failure wins.
    assert_eq!(
        reduce_check_rollup(&json!([
            { "status": "COMPLETED", "conclusion": "SUCCESS" },
            { "status": "COMPLETED", "conclusion": "FAILURE" },
            { "status": "IN_PROGRESS", "conclusion": "" },
        ])),
        PullRequestChecksState::Failing
    );
    // Otherwise unfinished runs are pending.
    assert_eq!(
        reduce_check_rollup(&json!([
            { "status": "COMPLETED", "conclusion": "SUCCESS" },
            { "status": "IN_PROGRESS", "conclusion": "" },
            { "state": "EXPECTED" },
        ])),
        PullRequestChecksState::Pending
    );
}

#[test]
fn classifies_gh_failures() {
    assert!(matches!(
        classify_gh_failure("To get started with GitHub CLI, please run: gh auth login".into()),
        GhError::AuthRequired(_)
    ));
    assert!(matches!(
        classify_gh_failure("You are not logged into any GitHub hosts".into()),
        GhError::AuthRequired(_)
    ));
    assert!(matches!(
        classify_gh_failure("GraphQL: rate limited".into()),
        GhError::CommandFailed(_)
    ));
}
