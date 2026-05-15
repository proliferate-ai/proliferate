use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const MATERIALIZED_SESSION_ENV_PATH: &str = ".proliferate/env/session.env";

pub fn read_materialized_session_env(
    workspace_path: &Path,
) -> anyhow::Result<BTreeMap<String, String>> {
    let path = workspace_path.join(MATERIALIZED_SESSION_ENV_PATH);
    let Ok(contents) = fs::read_to_string(&path) else {
        return Ok(BTreeMap::new());
    };
    parse_materialized_session_env(&contents)
}

fn parse_materialized_session_env(contents: &str) -> anyhow::Result<BTreeMap<String, String>> {
    let mut env = BTreeMap::new();
    for (index, raw_line) in contents.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((name, value)) = line.split_once('=') else {
            anyhow::bail!("invalid materialized env line {}", index + 1);
        };
        validate_env_name(name.trim()).map_err(|error| {
            anyhow::anyhow!("invalid materialized env line {}: {error}", index + 1)
        })?;
        env.insert(
            name.trim().to_string(),
            parse_materialized_env_value(value.trim()).map_err(|error| {
                anyhow::anyhow!("invalid materialized env line {}: {error}", index + 1)
            })?,
        );
    }
    Ok(env)
}

fn validate_env_name(name: &str) -> anyhow::Result<()> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        anyhow::bail!("empty environment variable name");
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        anyhow::bail!("environment variable name must start with a letter or underscore");
    }
    if !chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
        anyhow::bail!("environment variable name contains unsupported characters");
    }
    Ok(())
}

fn parse_materialized_env_value(value: &str) -> anyhow::Result<String> {
    if !value.starts_with('\'') {
        return Ok(value.to_string());
    }
    let mut rest = value;
    let mut out = String::new();
    loop {
        let Some(after_open) = rest.strip_prefix('\'') else {
            anyhow::bail!("expected single-quoted value segment");
        };
        let Some(close_index) = after_open.find('\'') else {
            anyhow::bail!("unterminated single-quoted value");
        };
        out.push_str(&after_open[..close_index]);
        rest = &after_open[close_index + 1..];
        if rest.is_empty() {
            return Ok(out);
        }
        if let Some(after_escaped_quote) = rest.strip_prefix("\\'") {
            out.push('\'');
            rest = after_escaped_quote;
            continue;
        }
        anyhow::bail!("unexpected characters after single-quoted value segment");
    }
}

#[cfg(test)]
mod tests {
    use super::parse_materialized_session_env;

    #[test]
    fn parses_worker_generated_session_env() {
        let parsed = parse_materialized_session_env(
            "# Generated\nexport ANTHROPIC_API_KEY='sk-test'\nexport QUOTED='a'\\''b'\n",
        )
        .unwrap();

        assert_eq!(
            parsed.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("sk-test")
        );
        assert_eq!(parsed.get("QUOTED").map(String::as_str), Some("a'b"));
    }

    #[test]
    fn rejects_invalid_env_names() {
        let error = parse_materialized_session_env("export 1BAD='no'\n").unwrap_err();
        assert!(error.to_string().contains("invalid materialized env line"));
    }
}
