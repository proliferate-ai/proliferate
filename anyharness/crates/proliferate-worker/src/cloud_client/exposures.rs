use serde::Deserialize;

use crate::error::WorkerError;

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerExposureSnapshot {
    pub exposure_id: String,
    pub target_id: String,
    pub cloud_workspace_id: String,
    pub session_projection_id: Option<String>,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: Option<String>,
    #[serde(default = "default_projection_level")]
    pub projection_level: String,
    #[serde(default)]
    pub commandable: bool,
    #[serde(default = "default_status")]
    pub status: String,
    pub revision: Option<i64>,
    #[serde(default)]
    pub last_uploaded_seq: i64,
}

#[derive(Debug, Clone)]
pub struct WorkerExposureListResponse {
    pub exposures: Vec<WorkerExposureSnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum WorkerExposureListWire {
    Wrapped {
        exposures: Vec<WorkerExposureSnapshot>,
    },
    Bare(Vec<WorkerExposureSnapshot>),
}

impl From<WorkerExposureListWire> for WorkerExposureListResponse {
    fn from(value: WorkerExposureListWire) -> Self {
        match value {
            WorkerExposureListWire::Wrapped { exposures } => Self { exposures },
            WorkerExposureListWire::Bare(exposures) => Self { exposures },
        }
    }
}

impl CloudClient {
    pub async fn list_worker_exposures(
        &self,
        worker_token: &str,
    ) -> Result<WorkerExposureListResponse, WorkerError> {
        let response = self
            .http
            .get(format!("{}/v1/cloud/worker/exposures", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .send()
            .await?;
        let wire: WorkerExposureListWire = parse_json_response(response).await?;
        Ok(wire.into())
    }
}

fn default_projection_level() -> String {
    "live".to_string()
}

fn default_status() -> String {
    "active".to_string()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use crate::{cloud_client::CloudClient, config::WorkerConfig};

    use super::{WorkerExposureListResponse, WorkerExposureListWire};

    #[test]
    fn deserializes_wrapped_exposure_response() {
        let response: WorkerExposureListWire = serde_json::from_value(serde_json::json!({
            "exposures": [{
                "exposureId": "exposure-1",
                "targetId": "target-1",
                "cloudWorkspaceId": "cloud-workspace-1",
                "sessionProjectionId": "projection-1",
                "anyharnessWorkspaceId": "workspace-1",
                "anyharnessSessionId": "session-1",
                "projectionLevel": "live",
                "commandable": true,
                "status": "active",
                "revision": 3,
                "lastUploadedSeq": 12
            }]
        }))
        .expect("response");
        let response = WorkerExposureListResponse::from(response);
        assert_eq!(response.exposures.len(), 1);
        assert_eq!(response.exposures[0].exposure_id, "exposure-1");
        assert_eq!(
            response.exposures[0].anyharness_session_id.as_deref(),
            Some("session-1")
        );
        assert_eq!(response.exposures[0].last_uploaded_seq, 12);
    }

    #[test]
    fn deserializes_bare_exposure_response() {
        let response: WorkerExposureListWire = serde_json::from_value(serde_json::json!([{
            "exposureId": "exposure-1",
            "targetId": "target-1",
            "cloudWorkspaceId": "cloud-workspace-1",
            "anyharnessWorkspaceId": "workspace-1"
        }]))
        .expect("response");
        let response = WorkerExposureListResponse::from(response);
        assert_eq!(response.exposures.len(), 1);
        assert_eq!(response.exposures[0].projection_level, "live");
        assert_eq!(response.exposures[0].status, "active");
        assert!(!response.exposures[0].commandable);
    }

    #[tokio::test]
    async fn list_worker_exposures_calls_worker_endpoint() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let base_url = format!("http://{}", listener.local_addr().expect("addr"));
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            loop {
                let read = stream.read(&mut buffer).await.expect("read request");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&request);
            assert!(request.starts_with("GET /v1/cloud/worker/exposures "));
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer worker-token"));
            let body = r#"{"exposures":[{"exposureId":"exposure-1","targetId":"target-1","cloudWorkspaceId":"cloud-workspace-1","anyharnessWorkspaceId":"workspace-1","anyharnessSessionId":"session-1","projectionLevel":"live","commandable":true,"status":"active","revision":2,"lastUploadedSeq":4}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write response");
        });

        let client = CloudClient::new(&WorkerConfig {
            cloud_base_url: base_url,
            enrollment_token: None,
            anyharness_base_url: None,
            anyharness_bearer_token: None,
            worker_db_path: PathBuf::from("worker.sqlite"),
            materialization_root: None,
            supervisor_update_request_dir: None,
            supervisor_version: None,
            heartbeat_interval_seconds: 60,
            config_path: None,
        })
        .expect("client");
        let response = client
            .list_worker_exposures("worker-token")
            .await
            .expect("exposures");
        server.await.expect("server");
        assert_eq!(response.exposures.len(), 1);
        assert_eq!(response.exposures[0].exposure_id, "exposure-1");
        assert_eq!(
            response.exposures[0].anyharness_session_id.as_deref(),
            Some("session-1")
        );
    }
}
