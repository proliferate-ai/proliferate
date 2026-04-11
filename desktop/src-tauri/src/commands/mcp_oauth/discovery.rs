use std::collections::HashMap;

use reqwest::header::WWW_AUTHENTICATE;
use url::Url;

use super::types::{
    AuthorizationServerMetadata, DiscoveryOutcome, ProtectedResourceMetadata,
};

pub fn normalize_resource_url(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value).map_err(|error| format!("Invalid resource URL: {error}"))?;
    url.set_fragment(None);
    if let Some(host) = url.host_str() {
        let _ = url.set_host(Some(&host.to_lowercase()));
    }
    let scheme = url.scheme().to_lowercase();
    url.set_scheme(&scheme)
        .map_err(|_| "Couldn't normalize URL scheme.".to_string())?;
    if (scheme == "https" && url.port() == Some(443))
        || (scheme == "http" && url.port() == Some(80))
    {
        let _ = url.set_port(None);
    }
    if let Some(query) = url.query() {
        let mut pairs = url::form_urlencoded::parse(query.as_bytes())
            .into_owned()
            .collect::<Vec<(String, String)>>();
        pairs.sort();
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in pairs {
            serializer.append_pair(&key, &value);
        }
        let query = serializer.finish();
        if query.is_empty() {
            url.set_query(None);
        } else {
            url.set_query(Some(&query));
        }
    }
    Ok(url.to_string())
}

pub fn prm_fallback_urls(server_url: &Url) -> Result<Vec<Url>, String> {
    let mut urls = Vec::new();
    let path = server_url.path();
    if path != "/" {
        let mut path_scoped = server_url.clone();
        path_scoped.set_path(&format!("/.well-known/oauth-protected-resource{path}"));
        path_scoped.set_fragment(None);
        path_scoped.set_query(server_url.query());
        urls.push(path_scoped);
    }
    let mut root = server_url.clone();
    root.set_path("/.well-known/oauth-protected-resource");
    root.set_query(None);
    root.set_fragment(None);
    urls.push(root);
    Ok(urls)
}

pub fn discovery_urls(issuer: &str) -> Result<Vec<Url>, String> {
    let issuer_url = Url::parse(issuer).map_err(|error| format!("Invalid issuer URL: {error}"))?;
    let mut urls = Vec::new();

    let mut oauth_metadata = issuer_url.clone();
    oauth_metadata.set_path("/.well-known/oauth-authorization-server");
    oauth_metadata.set_query(None);
    oauth_metadata.set_fragment(None);
    urls.push(oauth_metadata);

    let mut oidc_root = issuer_url.clone();
    oidc_root.set_path("/.well-known/openid-configuration");
    oidc_root.set_query(None);
    oidc_root.set_fragment(None);
    urls.push(oidc_root);

    let issuer_path = issuer_url.path().trim_end_matches('/');
    if !issuer_path.is_empty() && issuer_path != "/" {
        let mut oidc_path = issuer_url.clone();
        oidc_path.set_path(&format!("{issuer_path}/.well-known/openid-configuration"));
        oidc_path.set_query(None);
        oidc_path.set_fragment(None);
        urls.push(oidc_path);
    }

    Ok(urls)
}

pub fn parse_www_authenticate(value: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    let bearer = value.strip_prefix("Bearer ").unwrap_or(value);
    let mut current = String::new();
    let mut in_quotes = false;
    for character in bearer.chars() {
        if character == '"' {
            in_quotes = !in_quotes;
        }
        if character == ',' && !in_quotes {
            insert_auth_param(&mut params, &current);
            current.clear();
        } else {
            current.push(character);
        }
    }
    insert_auth_param(&mut params, &current);
    params
}

fn insert_auth_param(target: &mut HashMap<String, String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    let Some((key, value)) = trimmed.split_once('=') else {
        return;
    };
    let cleaned = value.trim().trim_matches('"').to_string();
    target.insert(key.trim().to_string(), cleaned);
}

pub async fn discover_protected_resource_metadata(
    client: &reqwest::Client,
    server_url: &str,
) -> Result<DiscoveryOutcome, String> {
    let server = Url::parse(server_url).map_err(|error| format!("Invalid MCP URL: {error}"))?;
    let response = client
        .get(server.clone())
        .send()
        .await
        .map_err(|error| format!("Couldn't reach MCP server: {error}"))?;

    let auth_header = response
        .headers()
        .get(WWW_AUTHENTICATE)
        .and_then(|value| value.to_str().ok())
        .map(parse_www_authenticate);

    if let Some(params) = auth_header.as_ref() {
        if let Some(resource_metadata) = params.get("resource_metadata") {
            let prm = client
                .get(resource_metadata)
                .send()
                .await
                .map_err(|error| format!("Couldn't load OAuth metadata: {error}"))?
                .error_for_status()
                .map_err(|error| format!("Couldn't load OAuth metadata: {error}"))?
                .json::<ProtectedResourceMetadata>()
                .await
                .map_err(|error| format!("Invalid OAuth metadata response: {error}"))?;
            return Ok(DiscoveryOutcome {
                prm,
                challenged_scope: params.get("scope").cloned(),
            });
        }
    }

    for candidate in prm_fallback_urls(&server)? {
        let candidate_url = candidate.to_string();
        let prm_response = match client.get(candidate).send().await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth protected-resource discovery request failed"
                );
                continue;
            }
        };
        let prm_response = match prm_response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth protected-resource discovery returned a non-success status"
                );
                continue;
            }
        };
        let prm = match prm_response.json::<ProtectedResourceMetadata>().await {
            Ok(prm) => prm,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth protected-resource discovery returned an invalid body"
                );
                continue;
            }
        };
        return Ok(DiscoveryOutcome {
            prm,
            challenged_scope: auth_header
                .as_ref()
                .and_then(|params| params.get("scope").cloned()),
        });
    }

    Err("This MCP server didn't publish OAuth protected-resource metadata.".to_string())
}

pub async fn discover_authorization_server_metadata(
    client: &reqwest::Client,
    issuer: &str,
) -> Result<AuthorizationServerMetadata, String> {
    for candidate in discovery_urls(issuer)? {
        let candidate_url = candidate.to_string();
        let response = match client.get(candidate).send().await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth authorization-server discovery request failed"
                );
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth authorization-server discovery returned a non-success status"
                );
                continue;
            }
        };
        let metadata = match response.json::<AuthorizationServerMetadata>().await {
            Ok(metadata) => metadata,
            Err(error) => {
                tracing::warn!(
                    candidate = %candidate_url,
                    error = %error,
                    "MCP OAuth authorization-server discovery returned an invalid body"
                );
                continue;
            }
        };
        let supports_s256 = metadata
            .code_challenge_methods_supported
            .as_ref()
            .map(|methods| methods.iter().any(|method| method == "S256"))
            .unwrap_or(false);
        if !supports_s256 {
            return Err("This OAuth provider doesn't advertise PKCE S256 support.".to_string());
        }
        return Ok(metadata);
    }
    Err("Couldn't discover OAuth authorization-server metadata.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{normalize_resource_url, parse_www_authenticate, prm_fallback_urls};
    use url::Url;

    #[test]
    fn parses_www_authenticate_params() {
        let parsed = parse_www_authenticate(
            "Bearer realm=\"OAuth\", resource_metadata=\"https://example.com/.well-known/oauth-protected-resource\", scope=\"read write\"",
        );
        assert_eq!(
            parsed.get("resource_metadata").map(String::as_str),
            Some("https://example.com/.well-known/oauth-protected-resource")
        );
        assert_eq!(parsed.get("scope").map(String::as_str), Some("read write"));
    }

    #[test]
    fn normalizes_resource_urls_stably() {
        let normalized = normalize_resource_url(
            "HTTPS://MCP.SUPABASE.COM:443/mcp?read_only=true&project_ref=abc",
        )
        .expect("normalize");
        assert_eq!(
            normalized,
            "https://mcp.supabase.com/mcp?project_ref=abc&read_only=true"
        );
    }

    #[test]
    fn builds_prm_fallback_urls() {
        let server = Url::parse("https://mcp.notion.com/mcp").expect("url");
        let candidates = prm_fallback_urls(&server).expect("candidates");
        assert_eq!(
            candidates[0].as_str(),
            "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp"
        );
        assert_eq!(
            candidates[1].as_str(),
            "https://mcp.notion.com/.well-known/oauth-protected-resource"
        );
    }
}
