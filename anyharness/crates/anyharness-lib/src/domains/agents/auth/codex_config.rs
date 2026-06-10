use std::fs;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

pub(super) fn write_codex_config(
    codex_home: &PathBuf,
    config: &Value,
    api_key: Option<&str>,
) -> anyhow::Result<()> {
    let object = config
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig must be an object"))?;
    let provider_id = string_value(object, "model_provider")
        .or_else(|| string_value(object, "model_provider_id"))
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing model_provider"))?;
    let providers = object
        .get("model_providers")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing model_providers"))?;
    let provider = providers
        .get(provider_id)
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("codex protectedConfig missing selected provider"))?;
    let name = string_value(provider, "name").unwrap_or("Proliferate Gateway");
    let base_url = string_value(provider, "base_url")
        .ok_or_else(|| anyhow::anyhow!("codex provider missing base_url"))?;
    let env_key = string_value(provider, "env_key")
        .ok_or_else(|| anyhow::anyhow!("codex provider missing env_key"))?;
    let wire_api = string_value(provider, "wire_api").unwrap_or("responses");
    let requires_openai_auth = provider
        .get("requires_openai_auth")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let contents = format!(
        "openai_base_url = {}\nenv_key = {}\n\nmodel_provider = {}\n\n[model_providers.{}]\nname = {}\nbase_url = {}\nenv_key = {}\nwire_api = {}\nrequires_openai_auth = {}\n",
        toml_string(base_url),
        toml_string(env_key),
        toml_string(provider_id),
        provider_id,
        toml_string(name),
        toml_string(base_url),
        toml_string(env_key),
        toml_string(wire_api),
        requires_openai_auth,
    );
    fs::create_dir_all(codex_home)?;
    let path = codex_home.join("config.toml");
    fs::write(&path, contents)?;
    set_private_file_permissions(&path)?;
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        write_codex_auth(codex_home, api_key)?;
    }
    Ok(())
}

fn write_codex_auth(codex_home: &PathBuf, api_key: &str) -> anyhow::Result<()> {
    fs::create_dir_all(codex_home)?;
    let path = codex_home.join("auth.json");
    let contents = serde_json::to_vec_pretty(&json!({
        "auth_mode": "apikey",
        "OPENAI_API_KEY": api_key,
    }))?;
    fs::write(&path, contents)?;
    set_private_file_permissions(&path)?;
    Ok(())
}

fn string_value<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &PathBuf) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &PathBuf) -> anyhow::Result<()> {
    Ok(())
}
