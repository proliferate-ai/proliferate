//! Compiled-in curated bundle recipes over the Codex desktop app's own
//! artifacts: `bundle:computer-use` (drive local Mac apps) and
//! `bundle:chrome` (drive the Chrome browser). Spec: "Curated bundles".
//!
//! A recipe is Proliferate-authored and versioned with this binary; the
//! artifacts it names are the vendor's, already provisioned on the user's
//! machine by the desktop app. `available` is a pure path-existence check —
//! nothing here spawns, probes, or writes. Both bundles inject the vendor's
//! `node_repl` binary as a stdio server, each under its own Proliferate-owned
//! name ([`CUA_REPL_SERVER_NAME`], [`BROWSER_REPL_SERVER_NAME`]) so both can
//! ride one launch without clobbering each other. Each bundle constructor
//! states its own env precedence — see [`computer_use_env`] and
//! [`chrome_env`].

use std::path::{Path, PathBuf};

use super::discover_codex;
use super::model::{
    NativeIntegration, NativeIntegrationKind, NativeIntegrationRisk, NativeSpawn, BUNDLE_ID_PREFIX,
};
use crate::domains::agents::model::AgentKind;

/// The server name `bundle:computer-use` injects under. Never `node_repl`:
/// codex cancels a session-config server whose name collides with the
/// plugin-owned `node_repl` (verified live against the desktop app), so the
/// injected copy gets a name only Proliferate uses.
pub(crate) const CUA_REPL_SERVER_NAME: &str = "cua_repl";

/// The server name `bundle:chrome` injects under. Distinct from
/// [`CUA_REPL_SERVER_NAME`] so selecting both bundles yields two servers
/// instead of one name-keyed entry clobbering the other.
pub(crate) const BROWSER_REPL_SERVER_NAME: &str = "browser_repl";

/// The injected server name for a bundle integration id, `None` for an id
/// this binary does not ship. Lives here, next to where the ids are minted,
/// so the id→name mapping cannot drift from the recipes.
pub(crate) fn server_name_for_bundle_id(integration_id: &str) -> Option<&'static str> {
    match integration_id {
        "bundle:computer-use" => Some(CUA_REPL_SERVER_NAME),
        "bundle:chrome" => Some(BROWSER_REPL_SERVER_NAME),
        _ => None,
    }
}

/// Where the desktop app installs the `node_repl` binary and its node
/// runtime. An absolute vendor path, not under the user's home.
const CUA_NODE_BIN_DIR: &str = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin";

const COMPUTER_USE_SKILL_PREAMBLE: &str =
    "The Computer Use REPL is exposed as the `cua_repl` MCP server's `js` tool.";
const CHROME_SKILL_PREAMBLE: &str =
    "The Chrome control REPL is exposed as the `browser_repl` MCP server's `js` tool.";

/// The curated bundles for `kind`, listed in the order the settings pane
/// shows them. Only codex has bundles today.
pub(super) fn discover(kind: &AgentKind, home: &Path) -> Vec<NativeIntegration> {
    match kind {
        AgentKind::Codex => discover_codex_bundles(home, Path::new(CUA_NODE_BIN_DIR)),
        _ => Vec::new(),
    }
}

/// Split from [`discover`] so tests can point the vendor bin dir at a
/// fixture instead of the real `/Applications` path.
fn discover_codex_bundles(home: &Path, cua_node_bin_dir: &Path) -> Vec<NativeIntegration> {
    vec![
        computer_use(home, cua_node_bin_dir),
        chrome(home, cua_node_bin_dir),
    ]
}

/// `bundle:computer-use` — the agent drives local Mac apps through the
/// desktop app's Computer Use client (the Sky client plus `node_repl`).
fn computer_use(home: &Path, cua_node_bin_dir: &Path) -> NativeIntegration {
    let node_repl = cua_node_bin_dir.join("node_repl");
    let required = [
        (node_repl.clone(), "the desktop app's node_repl binary"),
        (sky_client_app(home), "the Codex Computer Use client"),
        (
            bundled_plugin_dir(home, "computer-use"),
            "the bundled computer-use plugin",
        ),
    ];
    bundle(BundleRecipe {
        id_name: "computer-use",
        display_name: "Codex Computer Use",
        description: "The agent controls apps on this Mac through the Codex desktop app's \
                      Computer Use client. macOS approval prompts come from the vendor's \
                      client.",
        risk: NativeIntegrationRisk::DesktopControl,
        required: &required,
        node_repl: &node_repl,
        server_name: CUA_REPL_SERVER_NAME,
        env: computer_use_env(home, cua_node_bin_dir),
        skill_path: bundled_plugin_dir(home, "computer-use").join("skills/computer-use/SKILL.md"),
        skill_preamble: COMPUTER_USE_SKILL_PREAMBLE,
    })
}

/// `bundle:chrome` — the agent drives the Chrome browser through the same
/// `node_repl` binary, pointed at the browser service from the chrome
/// plugin's cache.
fn chrome(home: &Path, cua_node_bin_dir: &Path) -> NativeIntegration {
    let node_repl = cua_node_bin_dir.join("node_repl");
    let required = [
        (node_repl.clone(), "the desktop app's node_repl binary"),
        (
            plugin_cache_dir(home, "chrome"),
            "the chrome plugin's cache",
        ),
    ];
    bundle(BundleRecipe {
        id_name: "chrome",
        display_name: "Codex Chrome",
        description: "The agent controls the Chrome browser through the Codex desktop \
                      app's browser client.",
        risk: NativeIntegrationRisk::BrowserControl,
        required: &required,
        node_repl: &node_repl,
        server_name: BROWSER_REPL_SERVER_NAME,
        env: chrome_env(home, cua_node_bin_dir),
        skill_path: bundled_plugin_dir(home, "chrome").join("skills/control-chrome/SKILL.md"),
        skill_preamble: CHROME_SKILL_PREAMBLE,
    })
}

/// What one bundle needs to become a listing entry. Shared by both bundles
/// so the availability and skill-rewrite rules cannot drift apart. Env is
/// NOT resolved here: each bundle constructor states its own precedence and
/// hands the finished block in as `env`.
struct BundleRecipe<'a> {
    id_name: &'a str,
    display_name: &'a str,
    description: &'a str,
    risk: NativeIntegrationRisk,
    /// (path, what it is) — every path must exist for `available: true`.
    required: &'a [(PathBuf, &'a str)],
    node_repl: &'a Path,
    /// The Proliferate-owned name this bundle's server is injected under;
    /// the skill text is rewritten to it.
    server_name: &'a str,
    env: Vec<(String, String)>,
    skill_path: PathBuf,
    skill_preamble: &'a str,
}

fn bundle(recipe: BundleRecipe<'_>) -> NativeIntegration {
    let missing = recipe
        .required
        .iter()
        .find(|(path, _)| !path.exists())
        .map(|(path, what)| format!("{what} is not installed (expected at {})", path.display()));
    let available = missing.is_none();
    let spawn = available.then(|| NativeSpawn::Stdio {
        command: recipe.node_repl.to_string_lossy().into_owned(),
        args: Vec::new(),
        env: recipe.env,
    });
    let skill_text = if available {
        rewritten_skill_text(
            &recipe.skill_path,
            recipe.skill_preamble,
            recipe.server_name,
        )
    } else {
        None
    };
    NativeIntegration {
        id: format!("{BUNDLE_ID_PREFIX}{}", recipe.id_name),
        agent_kind: AgentKind::Codex,
        kind: NativeIntegrationKind::Bundle,
        display_name: recipe.display_name.to_string(),
        description: Some(recipe.description.to_string()),
        source: Some(format!(
            "Codex desktop app · {}@openai-bundled",
            recipe.id_name
        )),
        available,
        unavailable_reason: missing,
        risk: recipe.risk,
        spawn,
        skill_text,
    }
}

/// The plugin's SKILL.md with every `node_repl` tool reference rewritten to
/// `server_name` (THIS bundle's injected name — never another bundle's, so
/// the model calls a tool that exists in its own session), behind a one-line
/// preamble saying where the tool now lives. `None` when the file is
/// unreadable — the bundle still injects its server, just without skill text.
fn rewritten_skill_text(skill_path: &Path, preamble: &str, server_name: &str) -> Option<String> {
    let text = std::fs::read_to_string(skill_path).ok()?;
    Some(format!(
        "{preamble}\n\n{}",
        text.replace("node_repl", server_name)
    ))
}

/// Env precedence for `bundle:computer-use`: the user's own
/// `[mcp_servers.node_repl.env]` table read fresh at discovery time (it is
/// the desktop app's sky setup, exactly what this bundle re-admits), falling
/// back to the same keys derived from `home` and the vendor paths when the
/// table is absent.
fn computer_use_env(home: &Path, cua_node_bin_dir: &Path) -> Vec<(String, String)> {
    if let Some(env) = discover_codex::node_repl_env(home) {
        return env;
    }
    let mut env = shared_derived_env(home, cua_node_bin_dir);
    env.push((
        "NODE_REPL_TRUSTED_SERVICES".to_string(),
        r#"{"sky":"@oai/sky/service"}"#.to_string(),
    ));
    env.push((
        "NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE".to_string(),
        "Control desktop apps on macOS through Computer Use.".to_string(),
    ));
    env
}

/// Env precedence for `bundle:chrome`: base keys (`CODEX_HOME`, node paths)
/// may come from the user's `[mcp_servers.node_repl.env]` table, but the
/// browser-specific keys — `BROWSER_USE_*`, the use-case instructions, and
/// `NODE_REPL_TRUSTED_SERVICES` pointing at the cached browser service
/// script — are ALWAYS the derived chrome set. The user's table is the
/// desktop app's sky-only setup; passing it through verbatim would launch a
/// browser bundle that cannot reach the browser service.
fn chrome_env(home: &Path, cua_node_bin_dir: &Path) -> Vec<(String, String)> {
    let mut env = discover_codex::node_repl_env(home)
        .unwrap_or_else(|| shared_derived_env(home, cua_node_bin_dir));
    env.retain(|(name, _)| {
        name != "NODE_REPL_TRUSTED_SERVICES"
            && !name.starts_with("BROWSER_USE_")
            && !name.starts_with("NODE_REPL_INSTRUCTIONS_USE_CASE_")
    });
    let trusted_services = match newest_browser_service(home) {
        Some(service) => format!(
            r#"{{"browser":{},"sky":"@oai/sky/service"}}"#,
            serde_json::to_string(&service.display().to_string()).unwrap_or_default()
        ),
        None => r#"{"sky":"@oai/sky/service"}"#.to_string(),
    };
    env.push(("NODE_REPL_TRUSTED_SERVICES".to_string(), trusted_services));
    env.push((
        "BROWSER_USE_AVAILABLE_BACKENDS".to_string(),
        "chrome".to_string(),
    ));
    env.push((
        "NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME".to_string(),
        "Control the Chrome browser in conjunction with the Chrome Plugin.".to_string(),
    ));
    env
}

/// The keys both bundles need regardless of use case, derived from `home`
/// and the vendor bin dir.
fn shared_derived_env(home: &Path, cua_node_bin_dir: &Path) -> Vec<(String, String)> {
    let codex_home = home.join(".codex");
    let node_modules = cua_node_bin_dir
        .parent()
        .unwrap_or(cua_node_bin_dir)
        .join("lib/node_modules");
    vec![
        ("CODEX_HOME".to_string(), codex_home.display().to_string()),
        (
            "SKY_CUA_SERVICE_PATH".to_string(),
            sky_client_app(home).display().to_string(),
        ),
        (
            "NODE_REPL_NODE_PATH".to_string(),
            cua_node_bin_dir.join("node").display().to_string(),
        ),
        (
            "NODE_REPL_NODE_MODULE_DIRS".to_string(),
            node_modules.display().to_string(),
        ),
        (
            "NODE_REPL_TRUSTED_CODE_PATHS".to_string(),
            format!("{}:{}", codex_home.display(), node_modules.display()),
        ),
    ]
}

/// `scripts/browser-service.mjs` from the newest version dir in the browser
/// plugin's cache, when the desktop app has cached one. "Newest" compares
/// parsed numeric version components (`1.10.0` > `1.9.0`), not the raw dir
/// name; see [`version_sort_key`].
fn newest_browser_service(home: &Path) -> Option<PathBuf> {
    let cache = plugin_cache_dir(home, "browser");
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&cache)
        .ok()?
        .filter_map(|entry| Some(entry.ok()?.path()))
        .filter(|path| path.join("scripts/browser-service.mjs").exists())
        .collect();
    versions.sort_by_key(|path| version_sort_key(path));
    Some(versions.pop()?.join("scripts/browser-service.mjs"))
}

/// Sort key ordering version dirs oldest-first: dotted-numeric names compare
/// by their parsed components, so `1.10.0` outranks `1.9.0` where a lexical
/// sort would not; a name that is not all numbers falls back to comparing
/// lexically, behind every numeric one.
fn version_sort_key(path: &Path) -> (Vec<u64>, String) {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let components: Option<Vec<u64>> = name.split('.').map(|part| part.parse().ok()).collect();
    (components.unwrap_or_default(), name)
}

fn sky_client_app(home: &Path) -> PathBuf {
    home.join(".codex/computer-use/Codex Computer Use.app")
}

fn bundled_plugin_dir(home: &Path, plugin: &str) -> PathBuf {
    home.join(".codex/.tmp/bundled-marketplaces/openai-bundled/plugins")
        .join(plugin)
}

fn plugin_cache_dir(home: &Path, plugin: &str) -> PathBuf {
    home.join(".codex/plugins/cache/openai-bundled")
        .join(plugin)
}
#[cfg(test)]
#[path = "bundles_tests.rs"]
mod tests;
