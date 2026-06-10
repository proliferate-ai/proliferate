pub(in crate::live::sessions::sink) fn synthesize_patch(
    path: Option<&str>,
    old_text: Option<&str>,
    new_text: Option<&str>,
    start_line: Option<i64>,
) -> Option<SynthesizedPatch> {
    if old_text.is_none() && new_text.is_none() {
        return None;
    }

    let old_lines = split_lines(old_text.unwrap_or_default());
    let new_lines = split_lines(new_text.unwrap_or_default());
    let ops = diff_line_ops(&old_lines, &new_lines);
    let additions = ops
        .iter()
        .filter(|op| matches!(op, LineDiffOp::Insert(_)))
        .count() as i64;
    let deletions = ops
        .iter()
        .filter(|op| matches!(op, LineDiffOp::Delete(_)))
        .count() as i64;
    if additions == 0 && deletions == 0 {
        return None;
    }

    let path = path.unwrap_or("file");
    let mut patch = format!("--- a/{path}\n+++ b/{path}\n");
    let numbered_ops = number_diff_ops(&ops, start_line.unwrap_or(1).max(1));
    for hunk in build_unified_hunks(&numbered_ops) {
        let old_start = hunk_old_start(&hunk);
        let new_start = hunk_new_start(&hunk);
        let old_count = hunk
            .iter()
            .filter(|op| !matches!(op.op, LineDiffOp::Insert(_)))
            .count();
        let new_count = hunk
            .iter()
            .filter(|op| !matches!(op.op, LineDiffOp::Delete(_)))
            .count();

        patch.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            old_start, old_count, new_start, new_count
        ));
        for op in hunk {
            match op.op {
                LineDiffOp::Equal(line) => {
                    patch.push(' ');
                    patch.push_str(line);
                }
                LineDiffOp::Delete(line) => {
                    patch.push('-');
                    patch.push_str(line);
                }
                LineDiffOp::Insert(line) => {
                    patch.push('+');
                    patch.push_str(line);
                }
            }
            patch.push('\n');
        }
    }

    Some(SynthesizedPatch {
        patch,
        additions,
        deletions,
    })
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions::sink) struct SynthesizedPatch {
    pub patch: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineDiffOp<'a> {
    Equal(&'a str),
    Delete(&'a str),
    Insert(&'a str),
}

#[derive(Debug, Clone, Copy)]
struct NumberedLineDiffOp<'a> {
    op: LineDiffOp<'a>,
    old_line: Option<i64>,
    new_line: Option<i64>,
}

fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        Vec::new()
    } else {
        text.lines().collect()
    }
}

fn diff_line_ops<'a>(old_lines: &'a [&'a str], new_lines: &'a [&'a str]) -> Vec<LineDiffOp<'a>> {
    let mut prefix_len = 0;
    while prefix_len < old_lines.len()
        && prefix_len < new_lines.len()
        && old_lines[prefix_len] == new_lines[prefix_len]
    {
        prefix_len += 1;
    }

    let mut old_suffix_start = old_lines.len();
    let mut new_suffix_start = new_lines.len();
    while old_suffix_start > prefix_len
        && new_suffix_start > prefix_len
        && old_lines[old_suffix_start - 1] == new_lines[new_suffix_start - 1]
    {
        old_suffix_start -= 1;
        new_suffix_start -= 1;
    }

    let mut ops = old_lines[..prefix_len]
        .iter()
        .map(|line| LineDiffOp::Equal(*line))
        .collect::<Vec<_>>();
    ops.extend(diff_middle_lines(
        &old_lines[prefix_len..old_suffix_start],
        &new_lines[prefix_len..new_suffix_start],
    ));
    ops.extend(
        old_lines[old_suffix_start..]
            .iter()
            .map(|line| LineDiffOp::Equal(*line)),
    );
    ops
}

fn diff_middle_lines<'a>(
    old_lines: &'a [&'a str],
    new_lines: &'a [&'a str],
) -> Vec<LineDiffOp<'a>> {
    const MAX_LCS_CELLS: usize = 1_000_000;
    if old_lines.is_empty() {
        return new_lines
            .iter()
            .map(|line| LineDiffOp::Insert(*line))
            .collect();
    }
    if new_lines.is_empty() {
        return old_lines
            .iter()
            .map(|line| LineDiffOp::Delete(*line))
            .collect();
    }
    if old_lines.len().saturating_mul(new_lines.len()) > MAX_LCS_CELLS {
        return old_lines
            .iter()
            .map(|line| LineDiffOp::Delete(*line))
            .chain(new_lines.iter().map(|line| LineDiffOp::Insert(*line)))
            .collect();
    }

    let width = new_lines.len() + 1;
    let mut lcs = vec![0usize; (old_lines.len() + 1) * width];
    for old_index in (0..old_lines.len()).rev() {
        for new_index in (0..new_lines.len()).rev() {
            let cell = old_index * width + new_index;
            lcs[cell] = if old_lines[old_index] == new_lines[new_index] {
                lcs[(old_index + 1) * width + new_index + 1] + 1
            } else {
                lcs[(old_index + 1) * width + new_index].max(lcs[old_index * width + new_index + 1])
            };
        }
    }

    let mut ops = Vec::new();
    let mut old_index = 0;
    let mut new_index = 0;
    while old_index < old_lines.len() && new_index < new_lines.len() {
        if old_lines[old_index] == new_lines[new_index] {
            ops.push(LineDiffOp::Equal(old_lines[old_index]));
            old_index += 1;
            new_index += 1;
        } else if lcs[(old_index + 1) * width + new_index] >= lcs[old_index * width + new_index + 1]
        {
            ops.push(LineDiffOp::Delete(old_lines[old_index]));
            old_index += 1;
        } else {
            ops.push(LineDiffOp::Insert(new_lines[new_index]));
            new_index += 1;
        }
    }
    ops.extend(
        old_lines[old_index..]
            .iter()
            .map(|line| LineDiffOp::Delete(*line)),
    );
    ops.extend(
        new_lines[new_index..]
            .iter()
            .map(|line| LineDiffOp::Insert(*line)),
    );
    ops
}

fn number_diff_ops<'a>(ops: &[LineDiffOp<'a>], start_line: i64) -> Vec<NumberedLineDiffOp<'a>> {
    let mut old_line = start_line;
    let mut new_line = start_line;
    ops.iter()
        .map(|op| match *op {
            LineDiffOp::Equal(_) => {
                let numbered = NumberedLineDiffOp {
                    op: *op,
                    old_line: Some(old_line),
                    new_line: Some(new_line),
                };
                old_line += 1;
                new_line += 1;
                numbered
            }
            LineDiffOp::Delete(_) => {
                let numbered = NumberedLineDiffOp {
                    op: *op,
                    old_line: Some(old_line),
                    new_line: None,
                };
                old_line += 1;
                numbered
            }
            LineDiffOp::Insert(_) => {
                let numbered = NumberedLineDiffOp {
                    op: *op,
                    old_line: None,
                    new_line: Some(new_line),
                };
                new_line += 1;
                numbered
            }
        })
        .collect()
}

fn build_unified_hunks<'a>(ops: &[NumberedLineDiffOp<'a>]) -> Vec<Vec<NumberedLineDiffOp<'a>>> {
    const CONTEXT_LINES: usize = 3;
    let mut hunks = Vec::new();
    let mut index = 0;

    while let Some(relative_change_index) = ops[index..]
        .iter()
        .position(|op| !matches!(op.op, LineDiffOp::Equal(_)))
    {
        let change_index = index + relative_change_index;
        let hunk_start = change_index.saturating_sub(CONTEXT_LINES);
        let mut hunk_end = change_index;
        let mut trailing_context = 0;

        while hunk_end < ops.len() {
            if matches!(ops[hunk_end].op, LineDiffOp::Equal(_)) {
                trailing_context += 1;
                if trailing_context > CONTEXT_LINES {
                    break;
                }
            } else {
                trailing_context = 0;
            }
            hunk_end += 1;
        }

        hunks.push(ops[hunk_start..hunk_end].to_vec());
        index = hunk_end;
    }

    hunks
}

fn hunk_old_start(hunk: &[NumberedLineDiffOp<'_>]) -> i64 {
    hunk.iter()
        .find_map(|op| op.old_line)
        .or_else(|| hunk.iter().find_map(|op| op.new_line).map(|line| line - 1))
        .unwrap_or(0)
        .max(0)
}

fn hunk_new_start(hunk: &[NumberedLineDiffOp<'_>]) -> i64 {
    hunk.iter()
        .find_map(|op| op.new_line)
        .or_else(|| hunk.iter().find_map(|op| op.old_line).map(|line| line - 1))
        .unwrap_or(0)
        .max(0)
}

pub(in crate::live::sessions::sink) fn extract_diff_start_line(
    diff_item: &serde_json::Value,
    raw_input: Option<&serde_json::Value>,
    locations: Option<&Vec<serde_json::Value>>,
) -> Option<i64> {
    const START_LINE_KEYS: &[&str] = &[
        "startLine",
        "start_line",
        "lineStart",
        "line_start",
        "oldStart",
        "old_start",
        "oldLine",
        "old_line",
        "line",
    ];

    extract_i64_keys(Some(diff_item), START_LINE_KEYS)
        .or_else(|| extract_i64_keys(raw_input, START_LINE_KEYS))
        .or_else(|| {
            locations.and_then(|items| {
                items
                    .iter()
                    .find_map(|item| extract_i64_keys(Some(item), START_LINE_KEYS))
            })
        })
}

fn extract_i64_keys(value: Option<&serde_json::Value>, keys: &[&str]) -> Option<i64> {
    let value = value?;
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(read_i64_value)
}

fn read_i64_value(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|raw| i64::try_from(raw).ok()))
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesized_patch_uses_minimal_hunk_and_start_line() {
        let old_text = [
            "line 1",
            "line 2",
            "line 3",
            "line 4",
            "old value",
            "line 6",
            "line 7",
            "line 8",
            "line 9",
        ]
        .join("\n");
        let new_text = [
            "line 1",
            "line 2",
            "line 3",
            "line 4",
            "new value",
            "line 6",
            "line 7",
            "line 8",
            "line 9",
        ]
        .join("\n");

        let patch = synthesize_patch(
            Some("README.md"),
            Some(&old_text),
            Some(&new_text),
            Some(100),
        )
        .expect("patch");

        assert_eq!(patch.additions, 1);
        assert_eq!(patch.deletions, 1);
        assert!(patch.patch.contains("--- a/README.md\n+++ b/README.md\n"));
        assert!(patch.patch.contains("@@ -101,7 +101,7 @@"));
        assert!(patch.patch.contains("-old value\n+new value"));
        assert!(!patch.patch.contains(" line 1\n"));
    }

    #[test]
    fn synthesized_patch_extracts_start_line_from_diff_payload() {
        let line = extract_diff_start_line(
            &serde_json::json!({ "type": "diff", "startLine": "42" }),
            None,
            None,
        );

        assert_eq!(line, Some(42));
    }
}
