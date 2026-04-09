use super::types::{GitChangedFile, GitFileStatus, GitIncludedState, GitOperation};

#[derive(Debug, Default)]
pub struct ParsedStatus {
    pub branch_head: Option<String>,
    pub branch_oid: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitChangedFile>,
    pub operation: GitOperation,
}

/// Parses the NUL-separated output of `git status --porcelain=v2 --branch -z`.
pub fn parse_porcelain_v2(raw: &str) -> ParsedStatus {
    let mut result = ParsedStatus {
        branch_oid: "0000000".into(),
        ..Default::default()
    };

    let entries: Vec<&str> = raw.split('\0').collect();
    let mut i = 0;
    while i < entries.len() {
        let entry = entries[i];
        if entry.is_empty() {
            i += 1;
            continue;
        }

        if let Some(rest) = entry.strip_prefix("# branch.oid ") {
            result.branch_oid = rest.to_string();
        } else if let Some(rest) = entry.strip_prefix("# branch.head ") {
            if rest == "(detached)" {
                result.branch_head = None;
            } else {
                result.branch_head = Some(rest.to_string());
            }
        } else if let Some(rest) = entry.strip_prefix("# branch.upstream ") {
            result.upstream = Some(rest.to_string());
        } else if let Some(rest) = entry.strip_prefix("# branch.ab ") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() == 2 {
                result.ahead = parts[0].trim_start_matches('+').parse().unwrap_or(0);
                result.behind = parts[1].trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if entry.starts_with("1 ") || entry.starts_with("2 ") {
            if let Some(file) = parse_ordinary_or_rename(entry, &entries, &mut i) {
                result.files.push(file);
            }
        } else if entry.starts_with("u ") {
            if let Some(file) = parse_unmerged(entry) {
                result.files.push(file);
            }
        } else if entry.starts_with("? ") {
            let path = entry[2..].to_string();
            result.files.push(GitChangedFile {
                path,
                old_path: None,
                status: GitFileStatus::Untracked,
                additions: 0,
                deletions: 0,
                binary: false,
                included_state: GitIncludedState::Excluded,
            });
        }
        i += 1;
    }

    result
}

fn parse_ordinary_or_rename(
    entry: &str,
    entries: &[&str],
    idx: &mut usize,
) -> Option<GitChangedFile> {
    let parts: Vec<&str> = entry.splitn(9, ' ').collect();
    if parts.len() < 9 {
        return None;
    }

    let xy = parts[1];
    let index_char = xy.as_bytes().first().copied().unwrap_or(b'.');
    let worktree_char = xy.as_bytes().get(1).copied().unwrap_or(b'.');

    let is_rename = entry.starts_with("2 ");

    let path = parts[8].to_string();

    let old_path = if is_rename {
        *idx += 1;
        entries.get(*idx).map(|s| s.to_string())
    } else {
        None
    };

    let status = match (index_char, worktree_char) {
        (b'R', _) | (_, b'R') => GitFileStatus::Renamed,
        (b'C', _) | (_, b'C') => GitFileStatus::Copied,
        (b'A', _) | (_, b'A') => GitFileStatus::Added,
        (b'D', _) | (_, b'D') => GitFileStatus::Deleted,
        (b'M', _) | (_, b'M') => GitFileStatus::Modified,
        _ => GitFileStatus::Modified,
    };

    let included_state = match (index_char, worktree_char) {
        (b'.', _) => GitIncludedState::Excluded,
        (_, b'.') => GitIncludedState::Included,
        _ => GitIncludedState::Partial,
    };

    Some(GitChangedFile {
        path,
        old_path,
        status,
        additions: 0,
        deletions: 0,
        binary: false,
        included_state,
    })
}

fn parse_unmerged(entry: &str) -> Option<GitChangedFile> {
    let parts: Vec<&str> = entry.splitn(11, ' ').collect();
    let path = parts.last()?.to_string();
    Some(GitChangedFile {
        path,
        old_path: None,
        status: GitFileStatus::Conflicted,
        additions: 0,
        deletions: 0,
        binary: false,
        included_state: GitIncludedState::Excluded,
    })
}
