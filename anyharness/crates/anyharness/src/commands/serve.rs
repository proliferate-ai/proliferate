use anyhow::Result;
use axum::{extract::MatchedPath, http::Request, Router};
use clap::Args;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::request_id::{
    MakeRequestUuid, PropagateRequestIdLayer, RequestId, SetRequestIdLayer,
};
use tower_http::trace::TraceLayer;

use anyharness_lib::api::router::build_router;
use anyharness_lib::app::{default_runtime_home, ensure_runtime_home, AppState};
use anyharness_lib::persistence::Db;

#[derive(Args)]
pub struct ServeArgs {
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    #[arg(long, default_value = "8457")]
    pub port: u16,

    #[arg(long)]
    pub runtime_home: Option<String>,

    #[arg(long)]
    pub require_bearer_auth: bool,

    #[arg(long)]
    pub disable_cors: bool,
}

pub async fn run(args: ServeArgs) -> Result<()> {
    let runtime_home = args
        .runtime_home
        .map(std::path::PathBuf::from)
        .unwrap_or_else(default_runtime_home);

    ensure_runtime_home(&runtime_home)?;

    let db = Db::open(&runtime_home)?;
    let state = AppState::new(runtime_home.clone(), db, args.require_bearer_auth)?;
    let app = build_app(state, args.disable_cors);

    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!(
        addr = %addr,
        runtime_home = %runtime_home.display(),
        "AnyHarness listening"
    );

    axum::serve(listener, app).await?;

    Ok(())
}

fn build_app(state: AppState, disable_cors: bool) -> Router {
    let trace_layer = TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
        let matched_path = request
            .extensions()
            .get::<MatchedPath>()
            .map(MatchedPath::as_str)
            .unwrap_or("");
        let request_id = request
            .extensions()
            .get::<RequestId>()
            .and_then(|value| value.header_value().to_str().ok())
            .unwrap_or("");

        tracing::info_span!(
            "http_request",
            method = %request.method(),
            matched_path = matched_path,
            path = %request.uri().path(),
            request_id = request_id,
        )
    });
    let middleware = ServiceBuilder::new()
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(trace_layer)
        .layer(PropagateRequestIdLayer::x_request_id());
    let app = build_router(state).layer(middleware);

    if disable_cors {
        return app;
    }

    // Direct desktop connections hit AnyHarness itself from the Tauri WebView,
    // so the local runtime still needs permissive CORS. Proxied cloud runtimes
    // can disable this and let the upstream proxy own browser-facing CORS.
    app.layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use tower::Service;

    use anyharness_lib::{app::AppState, persistence::Db};

    use super::build_app;

    fn test_state() -> AppState {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("expected unix timestamp")
            .as_nanos();
        let runtime_home = PathBuf::from(format!("/tmp/anyharness-cors-test-{unique_suffix}"));
        AppState::new(
            runtime_home,
            Db::open_in_memory().expect("expected in-memory db"),
            false,
        )
        .expect("expected app state")
    }

    #[tokio::test]
    async fn build_app_adds_cors_headers_when_enabled() {
        let mut app = build_app(test_state(), false);
        let response = app
            .call(
                Request::builder()
                    .uri("/health")
                    .header(header::ORIGIN, "http://localhost:1420")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_some());
    }

    #[tokio::test]
    async fn build_app_omits_cors_headers_when_disabled() {
        let mut app = build_app(test_state(), true);
        let response = app
            .call(
                Request::builder()
                    .uri("/health")
                    .header(header::ORIGIN, "http://localhost:1420")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }
}
