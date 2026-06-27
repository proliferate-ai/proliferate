use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const GLOBAL_SECRET_ENV_PATH: &str = "secrets/global.env";
const MATERIALIZED_WORKSPACE_ENV_PATH: &str = ".proliferate/env/workspace.env";
const MATERIALIZED_SESSION_ENV_PATH: &str = ".proliferate/env/session.env";

pub fn read_global_secret_env(runtime_home: &Path) -> anyhow::Result<BTreeMap<String, String>> {
    read_optional_env_file(&runtime_home.join(GLOBAL_SECRET_ENV_PATH))
}

pub fn read_materialized_workspace_env(
    workspace_path: &Path,
) -> anyhow::Result<BTreeMap<String, String>> {
    read_optional_env_file(&workspace_path.join(MATERIALIZED_WORKSPACE_ENV_PATH))
}

pub fn read_materialized_session_env(
    workspace_path: &Path,
) -> anyhow::Result<BTreeMap<String, String>> {
    read_optional_env_file(&workspace_path.join(MATERIALIZED_SESSION_ENV_PATH))
}

pub fn read_materialized_launch_env(
    runtime_home: &Path,
    workspace_path: &Path,
) -> anyhow::Result<BTreeMap<String, String>> {
    let mut env = BTreeMap::new();
    merge_unprotected_env(&mut env, read_global_secret_env(runtime_home)?);
    merge_unprotected_env(&mut env, read_materialized_workspace_env(workspace_path)?);
    merge_unprotected_env(&mut env, read_materialized_session_env(workspace_path)?);
    Ok(env)
}

pub fn merge_env_overrides_protecting_metadata(
    base_env: impl IntoIterator<Item = (String, String)>,
    override_env: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    let mut merged = BTreeMap::from_iter(base_env);
    merge_unprotected_env(&mut merged, override_env);
    merged.into_iter().collect()
}

pub fn merge_unprotected_env(
    target: &mut BTreeMap<String, String>,
    env: impl IntoIterator<Item = (String, String)>,
) {
    for (name, value) in env {
        if !is_proliferate_metadata_key(&name) {
            target.insert(name, value);
        }
    }
}

fn read_optional_env_file(path: &Path) -> anyhow::Result<BTreeMap<String, String>> {
    match fs::read_to_string(path) {
        Ok(contents) => parse_materialized_env_file(&contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(anyhow::anyhow!(
            "failed to read materialized env file {}: {error}",
            path.display()
        )),
    }
}

fn is_proliferate_metadata_key(name: &str) -> bool {
    name.starts_with("PROLIFERATE_")
}

fn parse_materialized_env_file(contents: &str) -> anyhow::Result<BTreeMap<String, String>> {
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
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        merge_env_overrides_protecting_metadata, parse_materialized_env_file,
        read_materialized_launch_env,
    };

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "anyharness-env-{label}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn parses_worker_generated_session_env() {
        let parsed = parse_materialized_env_file(
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
        let error = parse_materialized_env_file("export 1BAD='no'\n").unwrap_err();
        assert!(error.to_string().contains("invalid materialized env line"));
    }

    #[test]
    fn env_overrides_cannot_replace_proliferate_metadata() {
        let merged = merge_env_overrides_protecting_metadata(
            BTreeMap::from([
                (
                    "PROLIFERATE_WORKSPACE_ID".to_string(),
                    "workspace-1".to_string(),
                ),
                ("SHARED".to_string(), "base".to_string()),
            ]),
            BTreeMap::from([
                (
                    "PROLIFERATE_WORKSPACE_ID".to_string(),
                    "spoofed".to_string(),
                ),
                ("SHARED".to_string(), "override".to_string()),
            ]),
        )
        .into_iter()
        .collect::<BTreeMap<_, _>>();

        assert_eq!(
            merged.get("PROLIFERATE_WORKSPACE_ID").map(String::as_str),
            Some("workspace-1")
        );
        assert_eq!(merged.get("SHARED").map(String::as_str), Some("override"));
    }

    #[test]
    fn launch_env_merges_global_workspace_and_session_env() {
        let runtime_home = TestDir::new("runtime-home");
        let workspace = TestDir::new("workspace");
        std::fs::create_dir_all(runtime_home.path().join("secrets")).unwrap();
        std::fs::create_dir_all(workspace.path().join(".proliferate/env")).unwrap();
        std::fs::write(
            runtime_home.path().join("secrets/global.env"),
            "SHARED='global'\nGLOBAL_ONLY='global'\n",
        )
        .unwrap();
        std::fs::write(
            workspace.path().join(".proliferate/env/workspace.env"),
            "SHARED='workspace'\nWORKSPACE_ONLY='workspace'\n",
        )
        .unwrap();
        std::fs::write(
            workspace.path().join(".proliferate/env/session.env"),
            "SHARED='session'\nSESSION_ONLY='session'\nPROLIFERATE_WORKSPACE_ID='spoofed'\n",
        )
        .unwrap();

        let env = read_materialized_launch_env(runtime_home.path(), workspace.path()).unwrap();

        assert_eq!(env.get("GLOBAL_ONLY").map(String::as_str), Some("global"));
        assert_eq!(
            env.get("WORKSPACE_ONLY").map(String::as_str),
            Some("workspace")
        );
        assert_eq!(env.get("SESSION_ONLY").map(String::as_str), Some("session"));
        assert_eq!(env.get("SHARED").map(String::as_str), Some("session"));
        assert!(!env.contains_key("PROLIFERATE_WORKSPACE_ID"));
    }
}
