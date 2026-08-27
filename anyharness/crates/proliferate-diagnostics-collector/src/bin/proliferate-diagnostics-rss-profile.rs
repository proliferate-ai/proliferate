use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use clap::Parser;
use futures::StreamExt;
use proliferate_diagnostics_protocol::v1::limits::{CURRENT_SCHEMA_VERSION, MAX_RECORD_BYTES};
use proliferate_diagnostics_protocol::v1::types::{
    ConnectionDescriptorV1, HealthResponseV1, IngestReceiptV1, RecordsPageV1,
    RssMeasurementProfileV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_rss_profile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::watch;

const CAPABILITY: &str = "rss-proof-capability-ec94f7f52d";
const RESPONSE_DEADLINE: Duration = Duration::from_secs(1);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const TAIL_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

struct HttpClients {
    request: reqwest::Client,
    tail: reqwest::Client,
}

fn build_http_clients(request_timeout: Duration) -> anyhow::Result<HttpClients> {
    let request = reqwest::Client::builder()
        .pool_max_idle_per_host(16)
        .timeout(request_timeout)
        .build()?;
    // Reqwest's total timeout includes the complete response body. Tail bodies
    // intentionally span the profile, so bound connect here and headers at the
    // call site while the existing stop signal owns the streaming lifetime.
    let tail = reqwest::Client::builder()
        .pool_max_idle_per_host(16)
        .connect_timeout(request_timeout)
        .build()?;
    Ok(HttpClients { request, tail })
}

#[derive(Debug, Parser)]
#[command(name = "proliferate-diagnostics-rss-profile")]
struct Args {
    #[arg(long)]
    collector_binary: PathBuf,
    #[arg(long)]
    profile: PathBuf,
    #[arg(long)]
    target: String,
    #[arg(long)]
    output_dir: PathBuf,
}

#[derive(Debug, Serialize)]
struct Evidence {
    target: String,
    runner_architecture: String,
    binary_sha256: String,
    profile_sha256: String,
    profile: RssMeasurementProfileV1,
    attempted_records: u64,
    expected_oversized_records: u64,
    ingest_errors: u64,
    query_errors: u64,
    export_errors: u64,
    export_cancellation_injected: bool,
    export_cancellation_observed: bool,
    fast_tail_frames: u64,
    slow_tail_frames: u64,
    tail_reported_drops: u64,
    max_response_micros: u64,
    rss_samples: usize,
    peak_rss_bytes: u64,
    health: HealthResponseV1,
    gap_query: RecordsPageV1,
    cancelled_exports: RecordsPageV1,
    child_working_directory_files: usize,
    token_absent_from_descriptor_stdout_stderr_and_url: bool,
    pass: bool,
    failures: Vec<String>,
}

struct ChildCollector {
    child: Child,
    control: UnixStream,
    stdout: BufReader<std::process::ChildStdout>,
    endpoint: String,
    descriptor_line: String,
    working_directory: PathBuf,
}

impl ChildCollector {
    fn spawn(binary: &Path) -> anyhow::Result<Self> {
        let working_directory = std::env::temp_dir().join(format!(
            "proliferate-diagnostics-rss-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)?
                .as_nanos()
        ));
        std::fs::create_dir(&working_directory)?;
        let (mut capability_writer, capability_reader) = UnixStream::pair()?;
        let (control_writer, control_reader) = UnixStream::pair()?;
        clear_cloexec(capability_reader.as_raw_fd())?;
        clear_cloexec(control_reader.as_raw_fd())?;
        let mut child = Command::new(binary)
            .arg("--capability-fd")
            .arg(capability_reader.as_raw_fd().to_string())
            .arg("--control-fd")
            .arg(control_reader.as_raw_fd().to_string())
            .arg("--release")
            .arg("rss-profile")
            .arg("--environment")
            .arg("proof")
            .current_dir(&working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        drop(capability_reader);
        drop(control_reader);
        writeln!(capability_writer, "{CAPABILITY}")?;
        capability_writer.shutdown(Shutdown::Write)?;
        let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
        let mut descriptor_line = String::new();
        stdout.read_line(&mut descriptor_line)?;
        let descriptor: ConnectionDescriptorV1 = serde_json::from_str(&descriptor_line)?;
        anyhow::ensure!(descriptor.endpoint.starts_with("http://127.0.0.1:"));
        anyhow::ensure!(!descriptor_line.contains(CAPABILITY));
        Ok(Self {
            child,
            control: control_writer,
            stdout,
            endpoint: descriptor.endpoint,
            descriptor_line,
            working_directory,
        })
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn control(&mut self, command: serde_json::Value) -> anyhow::Result<()> {
        serde_json::to_writer(&mut self.control, &command)?;
        self.control.write_all(b"\n")?;
        self.control.flush()?;
        Ok(())
    }

    fn shutdown(mut self) -> anyhow::Result<(String, String, usize)> {
        self.control(serde_json::json!({"command": "shutdown"}))?;
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if self.child.try_wait()?.is_some() {
                break;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                anyhow::bail!("collector did not shut down in 10 seconds");
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let status = self.child.wait()?;
        anyhow::ensure!(
            status.success(),
            "collector exited unsuccessfully: {status}"
        );
        let mut stdout_rest = String::new();
        self.stdout.read_to_string(&mut stdout_rest)?;
        let mut stderr = String::new();
        self.child
            .stderr
            .take()
            .expect("piped stderr")
            .read_to_string(&mut stderr)?;
        let file_count = std::fs::read_dir(&self.working_directory)?.count();
        std::fs::remove_dir(&self.working_directory)?;
        Ok((
            format!("{}{}", self.descriptor_line, stdout_rest),
            stderr,
            file_count,
        ))
    }
}

impl Drop for ChildCollector {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let profile_bytes = std::fs::read(&args.profile)?;
    let profile: RssMeasurementProfileV1 = serde_json::from_slice(&profile_bytes)?;
    validate_rss_profile(&profile)
        .map_err(|reason| anyhow::anyhow!("invalid RSS profile: {reason:?}"))?;
    anyhow::ensure!(
        profile.targets.contains(&args.target),
        "target is not in RSS profile"
    );
    let expected_target = match std::env::consts::ARCH {
        "aarch64" => "aarch64-apple-darwin",
        "x86_64" => "x86_64-apple-darwin",
        architecture => anyhow::bail!("unsupported runner architecture: {architecture}"),
    };
    anyhow::ensure!(
        args.target == expected_target,
        "target label does not match the executing release binary"
    );
    anyhow::ensure!(profile.build_profile == "release");
    std::fs::create_dir_all(&args.output_dir)?;

    let binary_sha256 = hash_file(&args.collector_binary)?;
    let profile_sha256 = hash_bytes(&profile_bytes);
    let mut collector = ChildCollector::spawn(&args.collector_binary)?;
    let HttpClients {
        request: http,
        tail: tail_http,
    } = build_http_clients(HTTP_REQUEST_TIMEOUT)?;

    warm_up(&http, &collector.endpoint, &profile).await?;
    let warmup_health = timed_health(&http, &collector.endpoint, &AtomicU64::new(0)).await?;
    anyhow::ensure!(
        warmup_health.evictions_by_reason.is_empty(),
        "warm-up unexpectedly evicted records before counter reset"
    );
    collector.control(serde_json::json!({"command": "reset_profile_counters"}))?;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let samples = Arc::new(Mutex::new(Vec::<(u128, u64)>::new()));
    let (sample_stop_tx, sample_stop_rx) = watch::channel(false);
    let sampler = tokio::spawn(sample_rss(
        collector.pid(),
        profile.sampling.interval_ms,
        Arc::clone(&samples),
        sample_stop_rx,
    ));

    let attempted = Arc::new(AtomicU64::new(0));
    let ingest_errors = Arc::new(AtomicU64::new(0));
    let query_errors = Arc::new(AtomicU64::new(0));
    let export_errors = Arc::new(AtomicU64::new(0));
    let max_response_micros = Arc::new(AtomicU64::new(0));
    let export_cancelled = Arc::new(AtomicBool::new(false));
    let export_cancellation_observed = Arc::new(AtomicBool::new(false));
    let fast_tail_frames = Arc::new(AtomicU64::new(0));
    let slow_tail_frames = Arc::new(AtomicU64::new(0));
    let tail_reported_drops = Arc::new(AtomicU64::new(0));
    let (stress_stop_tx, stress_stop_rx) = watch::channel(false);

    let mut background = Vec::new();
    for _ in 0..profile.concurrency.query_readers {
        background.push(tokio::spawn(query_reader(
            http.clone(),
            collector.endpoint.clone(),
            Arc::clone(&query_errors),
            Arc::clone(&max_response_micros),
            stress_stop_rx.clone(),
        )));
    }
    for index in 0..profile.concurrency.tail_readers {
        background.push(tokio::spawn(tail_reader(
            tail_http.clone(),
            collector.endpoint.clone(),
            TAIL_HANDSHAKE_TIMEOUT,
            index == 1,
            profile.stress.slow_tail_delay_ms,
            if index == 1 {
                Arc::clone(&slow_tail_frames)
            } else {
                Arc::clone(&fast_tail_frames)
            },
            Arc::clone(&tail_reported_drops),
            stress_stop_rx.clone(),
        )));
    }
    background.push(tokio::spawn(export_reader(
        http.clone(),
        collector.endpoint.clone(),
        profile.stress.fail_exporter_after_records as u64,
        Arc::clone(&attempted),
        Arc::clone(&export_errors),
        Arc::clone(&export_cancelled),
        Arc::clone(&export_cancellation_observed),
        stress_stop_rx.clone(),
    )));

    tokio::time::sleep(Duration::from_millis(200)).await;
    let stress_started = tokio::time::Instant::now();
    let total_records =
        u64::from(profile.stress.duration_seconds) * u64::from(profile.stress.records_per_second);
    let mut writers = Vec::new();
    for writer in 0..profile.concurrency.ingest_writers {
        writers.push(tokio::spawn(ingest_writer(
            http.clone(),
            collector.endpoint.clone(),
            writer,
            profile.clone(),
            total_records / u64::from(profile.concurrency.ingest_writers),
            Arc::clone(&attempted),
            Arc::clone(&ingest_errors),
            Arc::clone(&max_response_micros),
            stress_started,
        )));
    }
    for writer in writers {
        writer.await??;
    }
    tokio::time::sleep_until(
        stress_started + Duration::from_secs(u64::from(profile.stress.duration_seconds)),
    )
    .await;
    let _ = stress_stop_tx.send(true);
    for task in background {
        task.await??;
    }

    tokio::time::sleep(Duration::from_secs(30)).await;
    let _ = sample_stop_tx.send(true);
    sampler.await??;

    let health = timed_health(&http, &collector.endpoint, &max_response_micros).await?;
    let gap_query = timed_query(
        &http,
        &collector.endpoint,
        "schema_version=1.1&after_cursor=1&limit=100",
        &max_response_micros,
    )
    .await?;
    let cancelled_exports = timed_query(
        &http,
        &collector.endpoint,
        "schema_version=1.1&name=collector.export&outcome=cancelled&limit=500",
        &max_response_micros,
    )
    .await?;

    let (stdout, stderr, working_files) = collector.shutdown()?;
    let token_absent = !stdout.contains(CAPABILITY)
        && !stderr.contains(CAPABILITY)
        && !health.collector_boot_id.contains(CAPABILITY);
    let samples = Arc::try_unwrap(samples)
        .expect("sampler released samples")
        .into_inner()
        .expect("RSS samples mutex");
    let peak_rss_bytes = samples.iter().map(|(_, rss)| *rss).max().unwrap_or(0);
    let samples_path = args
        .output_dir
        .join(format!("rss-samples-{}.csv", args.target));
    let mut sample_csv = String::from("elapsed_ms,rss_bytes\n");
    for (elapsed_ms, rss) in &samples {
        sample_csv.push_str(&format!("{elapsed_ms},{rss}\n"));
    }
    std::fs::write(&samples_path, sample_csv)?;

    let expected_oversized = total_records / u64::from(profile.stress.oversized_record_every);
    let mut failures = Vec::new();
    check(
        attempted.load(Ordering::Relaxed) == total_records,
        format!(
            "attempted {} records, expected {total_records}",
            attempted.load(Ordering::Relaxed)
        ),
        &mut failures,
    );
    check(
        health.oversized_records == expected_oversized,
        format!(
            "oversized counter {}, expected {expected_oversized}",
            health.oversized_records
        ),
        &mut failures,
    );
    check(
        health.rejected_records == expected_oversized,
        format!(
            "rejected counter {}, expected {expected_oversized}",
            health.rejected_records
        ),
        &mut failures,
    );
    check(
        health.retained_bytes <= profile.pass_fail.retained_arena_limit_bytes,
        format!(
            "retained bytes exceeded contract: {}",
            health.retained_bytes
        ),
        &mut failures,
    );
    check(
        peak_rss_bytes <= profile.pass_fail.total_rss_limit_bytes,
        format!("peak RSS exceeded contract: {peak_rss_bytes}"),
        &mut failures,
    );
    check(
        max_response_micros.load(Ordering::Relaxed) <= RESPONSE_DEADLINE.as_micros() as u64,
        format!(
            "response exceeded one second: {}us",
            max_response_micros.load(Ordering::Relaxed)
        ),
        &mut failures,
    );
    check(
        health.tail_reader_drops > 0,
        "slow tail did not lag".to_owned(),
        &mut failures,
    );
    check(
        health.tail_reader_drops >= tail_reported_drops.load(Ordering::Relaxed),
        "tail client observed more drops than collector health recorded".to_owned(),
        &mut failures,
    );
    check(
        !gap_query.gaps.is_empty(),
        "cursor gap was not reported".to_owned(),
        &mut failures,
    );
    check(
        health
            .evictions_by_reason
            .get(&proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted)
            .is_some_and(|count| *count > 0),
        "oldest-first eviction counter was zero".to_owned(),
        &mut failures,
    );
    let evicted_records = health
        .evictions_by_reason
        .get(&proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted)
        .copied()
        .unwrap_or(0);
    let evicted_by_class: u64 = health.evictions_by_class.values().sum();
    let evicted_by_component: u64 = health.evictions_by_component.values().sum();
    check(
        health.oldest_cursor == Some(evicted_records.saturating_add(1)),
        format!(
            "oldest cursor {:?} did not exactly follow {evicted_records} oldest-first evictions",
            health.oldest_cursor
        ),
        &mut failures,
    );
    check(
        evicted_by_class == evicted_records && evicted_by_component == evicted_records,
        format!(
            "eviction dimensions diverged: reason={evicted_records}, class={evicted_by_class}, component={evicted_by_component}"
        ),
        &mut failures,
    );
    let eviction_gap = gap_query.gaps.iter().find(|gap| {
        gap.reason == proliferate_diagnostics_protocol::v1::types::GapReasonV1::Evicted
    });
    check(
        eviction_gap.is_some_and(|gap| {
            gap.from_cursor == Some(2)
                && gap.to_cursor == Some(evicted_records)
                && gap.dropped_records.saturating_add(1) == evicted_records
        }),
        "cursor gap did not exactly match oldest-first eviction".to_owned(),
        &mut failures,
    );
    check(
        export_cancelled.load(Ordering::Relaxed)
            && export_cancellation_observed.load(Ordering::Relaxed),
        "cancelled export lifecycle evidence was absent".to_owned(),
        &mut failures,
    );
    check(
        health.exporter.state
            == proliferate_diagnostics_protocol::v1::types::ExporterStateV1::Disabled
            && health.exporter.dropped_records == 0,
        "standalone exporter health was not neutral".to_owned(),
        &mut failures,
    );
    check(
        health.fallback.state
            == proliferate_diagnostics_protocol::v1::types::FallbackStateV1::Inactive
            && health.fallback.bytes == 0
            && health.fallback.dropped_records == 0,
        "standalone fallback health was not neutral".to_owned(),
        &mut failures,
    );
    check(
        ingest_errors.load(Ordering::Relaxed) == 0
            && query_errors.load(Ordering::Relaxed) == 0
            && export_errors.load(Ordering::Relaxed) == 0,
        "one or more workload clients failed".to_owned(),
        &mut failures,
    );
    check(
        working_files == 0,
        "collector persisted files".to_owned(),
        &mut failures,
    );
    check(
        token_absent,
        "capability leaked into output".to_owned(),
        &mut failures,
    );
    check(
        !samples.is_empty(),
        "RSS sampler produced no samples".to_owned(),
        &mut failures,
    );

    let evidence = Evidence {
        target: args.target.clone(),
        runner_architecture: std::env::consts::ARCH.to_owned(),
        binary_sha256,
        profile_sha256,
        profile,
        attempted_records: attempted.load(Ordering::Relaxed),
        expected_oversized_records: expected_oversized,
        ingest_errors: ingest_errors.load(Ordering::Relaxed),
        query_errors: query_errors.load(Ordering::Relaxed),
        export_errors: export_errors.load(Ordering::Relaxed),
        export_cancellation_injected: export_cancelled.load(Ordering::Relaxed),
        export_cancellation_observed: export_cancellation_observed.load(Ordering::Relaxed),
        fast_tail_frames: fast_tail_frames.load(Ordering::Relaxed),
        slow_tail_frames: slow_tail_frames.load(Ordering::Relaxed),
        tail_reported_drops: tail_reported_drops.load(Ordering::Relaxed),
        max_response_micros: max_response_micros.load(Ordering::Relaxed),
        rss_samples: samples.len(),
        peak_rss_bytes,
        health,
        gap_query,
        cancelled_exports,
        child_working_directory_files: working_files,
        token_absent_from_descriptor_stdout_stderr_and_url: token_absent,
        pass: failures.is_empty(),
        failures,
    };
    let evidence_path = args
        .output_dir
        .join(format!("rss-profile-{}.json", args.target));
    std::fs::write(&evidence_path, serde_json::to_vec_pretty(&evidence)?)?;
    anyhow::ensure!(
        evidence.pass,
        "RSS profile failed; see {}",
        evidence_path.display()
    );
    println!("{}", evidence_path.display());
    Ok(())
}

async fn warm_up(
    http: &reqwest::Client,
    endpoint: &str,
    profile: &RssMeasurementProfileV1,
) -> anyhow::Result<()> {
    let batches = 200_u32;
    anyhow::ensure!(profile.warmup.records % batches == 0);
    let batch_records = profile.warmup.records / batches;
    let interval =
        Duration::from_secs_f64(f64::from(profile.warmup.duration_seconds) / f64::from(batches));
    let started = tokio::time::Instant::now();
    let mut sequence = 1_u64;
    for batch_index in 0..batches {
        let records = (0..batch_records)
            .map(|record_index| {
                let record = detailed_record(
                    "rss-warmup",
                    sequence,
                    format!("rss-warmup-{batch_index}-{record_index}"),
                    64,
                );
                sequence += 1;
                record
            })
            .collect();
        let receipt = send_ingest(http, endpoint, records).await?;
        anyhow::ensure!(receipt.accepted_count == batch_records as u16);
        tokio::time::sleep_until(started + interval * (batch_index + 1)).await;
    }
    Ok(())
}

async fn ingest_writer(
    http: reqwest::Client,
    endpoint: String,
    writer: u16,
    profile: RssMeasurementProfileV1,
    writer_records: u64,
    attempted: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
    max_response_micros: Arc<AtomicU64>,
    started: tokio::time::Instant,
) -> anyhow::Result<()> {
    let batch_records = 100_u64;
    anyhow::ensure!(writer_records % batch_records == 0);
    let batches = writer_records / batch_records;
    let interval =
        Duration::from_secs_f64(f64::from(profile.stress.duration_seconds) / batches as f64);
    let mut sequence = 1_u64;
    for batch_index in 0..batches {
        let mut expected_rejections = 0_u16;
        let mut records = Vec::with_capacity(batch_records as usize);
        for record_index in 0..batch_records {
            let global = attempted.fetch_add(1, Ordering::Relaxed) + 1;
            let oversized = global.is_multiple_of(u64::from(profile.stress.oversized_record_every));
            expected_rejections += u16::from(oversized);
            records.push(detailed_record(
                &format!("rss-writer-{writer}"),
                sequence,
                format!("rss-{writer}-{batch_index}-{record_index}"),
                if oversized { MAX_RECORD_BYTES } else { 96 },
            ));
            sequence += 1;
        }
        let request_started = Instant::now();
        match send_ingest(&http, &endpoint, records).await {
            Ok(receipt)
                if receipt.rejections.len() == usize::from(expected_rejections)
                    && receipt.accepted_count
                        == (batch_records as u16).saturating_sub(expected_rejections) => {}
            _ => {
                errors.fetch_add(1, Ordering::Relaxed);
            }
        }
        max_response_micros.fetch_max(
            request_started.elapsed().as_micros() as u64,
            Ordering::Relaxed,
        );
        tokio::time::sleep_until(started + interval.mul_f64((batch_index + 1) as f64)).await;
    }
    Ok(())
}

async fn query_reader(
    http: reqwest::Client,
    endpoint: String,
    errors: Arc<AtomicU64>,
    max_response_micros: Arc<AtomicU64>,
    mut stop: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let mut cursor = 0_u64;
    loop {
        if *stop.borrow() {
            return Ok(());
        }
        let started = Instant::now();
        match timed_query(
            &http,
            &endpoint,
            &format!("schema_version=1.1&after_cursor={cursor}&limit=500"),
            &max_response_micros,
        )
        .await
        {
            Ok(page) => {
                cursor = page.next_cursor.unwrap_or(cursor);
            }
            Err(_) => {
                errors.fetch_add(1, Ordering::Relaxed);
            }
        }
        max_response_micros.fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            _ = stop.changed() => {}
        }
    }
}

async fn tail_reader(
    http: reqwest::Client,
    endpoint: String,
    handshake_timeout: Duration,
    slow: bool,
    delay_ms: u32,
    frames: Arc<AtomicU64>,
    reported_drops: Arc<AtomicU64>,
    mut stop: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let mut cursor = 0_u64;
    loop {
        if *stop.borrow() {
            return Ok(());
        }
        let response = tokio::time::timeout(
            handshake_timeout,
            http.get(format!(
                "{endpoint}/v1/tail?schema_version=1.1&after_cursor={cursor}"
            ))
            .bearer_auth(CAPABILITY)
            .send(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("tail response headers exceeded handshake timeout"))??
        .error_for_status()?;
        let mut stream = response.bytes_stream();
        let mut pending = Vec::new();
        loop {
            tokio::select! {
                _ = stop.changed() => return Ok(()),
                chunk = stream.next() => {
                    let Some(chunk) = chunk else { break; };
                    pending.extend_from_slice(&chunk?);
                    while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                        let line: Vec<u8> = pending.drain(..=newline).collect();
                        let frame: proliferate_diagnostics_protocol::v1::types::TailFrameV1 =
                            serde_json::from_slice(&line[..line.len() - 1])?;
                        frames.fetch_add(1, Ordering::Relaxed);
                        match frame {
                            proliferate_diagnostics_protocol::v1::types::TailFrameV1::Records { cursor: next, .. } => cursor = next,
                            proliferate_diagnostics_protocol::v1::types::TailFrameV1::Gap { gap } => {
                                cursor = gap.to_cursor.unwrap_or(cursor);
                            }
                            proliferate_diagnostics_protocol::v1::types::TailFrameV1::Lag { dropped_frames, resume_after_cursor } => {
                                reported_drops.fetch_add(dropped_frames, Ordering::Relaxed);
                                cursor = resume_after_cursor;
                            }
                        }
                    }
                    if slow {
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(u64::from(delay_ms))) => {}
                            _ = stop.changed() => return Ok(()),
                        }
                    }
                }
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(10)) => {}
            _ = stop.changed() => return Ok(()),
        }
    }
}

async fn export_reader(
    http: reqwest::Client,
    endpoint: String,
    cancel_after: u64,
    attempted: Arc<AtomicU64>,
    errors: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
    cancellation_observed: Arc<AtomicBool>,
    mut stop: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    loop {
        if *stop.borrow() {
            return Ok(());
        }
        let request = serde_json::json!({
            "schema_version": CURRENT_SCHEMA_VERSION,
            "purpose": "internal_dogfood",
            "filters": {
                "components": [], "record_classes": [], "severities": [], "names": [], "outcomes": []
            },
            "record_limit": 5000,
            "byte_limit": 4 * 1024 * 1024,
            "include_health": true
        });
        match http
            .post(format!("{endpoint}/v1/export"))
            .bearer_auth(CAPABILITY)
            .json(&request)
            .send()
            .await
        {
            Ok(response)
                if !cancelled.load(Ordering::Relaxed)
                    && attempted.load(Ordering::Relaxed) >= cancel_after =>
            {
                drop(response);
                cancelled.store(true, Ordering::Relaxed);
                for _ in 0..20 {
                    let query = http
                        .get(format!(
                            "{endpoint}/v1/records?schema_version=1.1&name=collector.export&outcome=cancelled&limit=500"
                        ))
                        .bearer_auth(CAPABILITY)
                        .send()
                        .await;
                    if let Ok(response) = query {
                        if let Ok(response) = response.error_for_status() {
                            if let Ok(page) = response.json::<RecordsPageV1>().await {
                                if !page.records.is_empty() {
                                    cancellation_observed.store(true, Ordering::Relaxed);
                                    break;
                                }
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            }
            Ok(response) => {
                if response.error_for_status()?.text().await.is_err() {
                    errors.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(_) => {
                errors.fetch_add(1, Ordering::Relaxed);
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
            _ = stop.changed() => {}
        }
    }
}

async fn send_ingest(
    http: &reqwest::Client,
    endpoint: &str,
    records: Vec<serde_json::Value>,
) -> anyhow::Result<IngestReceiptV1> {
    Ok(http
        .post(format!("{endpoint}/v1/ingest"))
        .bearer_auth(CAPABILITY)
        .json(&serde_json::json!({
            "schema_version": CURRENT_SCHEMA_VERSION,
            "records": records,
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

async fn timed_query(
    http: &reqwest::Client,
    endpoint: &str,
    query: &str,
    max_response_micros: &AtomicU64,
) -> anyhow::Result<RecordsPageV1> {
    let started = Instant::now();
    let page = http
        .get(format!("{endpoint}/v1/records?{query}"))
        .bearer_auth(CAPABILITY)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    max_response_micros.fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
    Ok(page)
}

async fn timed_health(
    http: &reqwest::Client,
    endpoint: &str,
    max_response_micros: &AtomicU64,
) -> anyhow::Result<HealthResponseV1> {
    let started = Instant::now();
    let health = http
        .get(format!("{endpoint}/v1/health"))
        .bearer_auth(CAPABILITY)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    max_response_micros.fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
    Ok(health)
}

async fn sample_rss(
    pid: u32,
    interval_ms: u32,
    samples: Arc<Mutex<Vec<(u128, u64)>>>,
    mut stop: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let started = Instant::now();
    loop {
        let output = tokio::task::spawn_blocking(move || {
            Command::new("ps")
                .arg("-o")
                .arg("rss=")
                .arg("-p")
                .arg(pid.to_string())
                .output()
        })
        .await??;
        anyhow::ensure!(output.status.success(), "ps RSS sample failed");
        let kib: u64 = String::from_utf8(output.stdout)?.trim().parse()?;
        samples
            .lock()
            .expect("RSS sample mutex")
            .push((started.elapsed().as_millis(), kib * 1024));
        if *stop.borrow() {
            return Ok(());
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(u64::from(interval_ms))) => {}
            _ = stop.changed() => {}
        }
    }
}

fn detailed_record(
    producer_boot_id: &str,
    sequence: u64,
    operation_id: String,
    message_bytes: usize,
) -> serde_json::Value {
    serde_json::json!({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "source_timestamp": "2026-08-11T00:00:00.000Z",
        "producer_sequence": sequence,
        "producer_boot_id": producer_boot_id,
        "component": "desktop_tauri",
        "source": "tauri",
        "release": "rss-profile",
        "environment": "proof",
        "operation_id": operation_id,
        "name": "collector.rss.sample",
        "severity": "info",
        "arguments": [],
        "record_class": "detailed",
        "privacy": "operational",
        "redaction": "none",
        "detailed": {"kind": "message", "message": "x".repeat(message_bytes)}
    })
}

fn check(condition: bool, failure: String, failures: &mut Vec<String>) {
    if !condition {
        failures.push(failure);
    }
}

fn clear_cloexec(fd: i32) -> anyhow::Result<()> {
    // SAFETY: fcntl reads and updates flags for a valid inherited descriptor.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        anyhow::ensure!(flags >= 0, "F_GETFD failed");
        anyhow::ensure!(
            libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == 0,
            "F_SETFD failed"
        );
    }
    Ok(())
}

fn hash_file(path: &Path) -> anyhow::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher.finalize().as_slice()))
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex_digest(Sha256::digest(bytes).as_slice())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use axum::body::{Body, Bytes};
    use axum::response::Response;
    use axum::routing::get;
    use axum::Router;

    use super::*;

    const TEST_REQUEST_TIMEOUT: Duration = Duration::from_millis(200);
    const TEST_FRAME_DELAY: Duration = Duration::from_millis(500);

    async fn spawn_tail_server(
        frame: Bytes,
        frame_delay: Duration,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/v1/tail",
            get(move || {
                let frame = frame.clone();
                async move {
                    let delayed_frame = futures::stream::once(async move {
                        tokio::time::sleep(frame_delay).await;
                        Ok::<Bytes, Infallible>(frame)
                    });
                    let open_stream = delayed_frame
                        .chain(futures::stream::pending::<Result<Bytes, Infallible>>());
                    Response::new(Body::from_stream(open_stream))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind tail test server");
        let endpoint = format!(
            "http://{}",
            listener.local_addr().expect("tail server addr")
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve tail test response");
        });
        (endpoint, server)
    }

    #[tokio::test]
    async fn tail_stream_outlives_ordinary_timeout_and_exits_on_stop() {
        let frame = Bytes::from_static(b"{\"frame\":\"records\",\"records\":[],\"cursor\":7}\n");
        let (endpoint, server) = spawn_tail_server(frame, TEST_FRAME_DELAY).await;
        let HttpClients { request, tail } =
            build_http_clients(TEST_REQUEST_TIMEOUT).expect("build test clients");

        let ordinary = request
            .get(format!(
                "{endpoint}/v1/tail?schema_version=1.1&after_cursor=0"
            ))
            .send()
            .await
            .expect("ordinary response headers");
        let ordinary_error = ordinary
            .bytes_stream()
            .next()
            .await
            .expect("ordinary response body result")
            .expect_err("ordinary client must expire the long-lived response");
        assert!(ordinary_error.is_timeout(), "{ordinary_error:?}");

        let frames = Arc::new(AtomicU64::new(0));
        let reported_drops = Arc::new(AtomicU64::new(0));
        let (stop_tx, stop_rx) = watch::channel(false);
        let reader = tokio::spawn(tail_reader(
            tail,
            endpoint,
            TEST_REQUEST_TIMEOUT,
            false,
            0,
            Arc::clone(&frames),
            Arc::clone(&reported_drops),
            stop_rx,
        ));
        tokio::time::timeout(Duration::from_secs(3), async {
            while frames.load(Ordering::Relaxed) == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("streaming tail frame after ordinary timeout");
        assert_eq!(reported_drops.load(Ordering::Relaxed), 0);

        stop_tx.send(true).expect("signal tail stop");
        tokio::time::timeout(Duration::from_secs(1), reader)
            .await
            .expect("tail reader stop deadline")
            .expect("tail reader task")
            .expect("tail reader result");
        server.abort();
    }

    #[tokio::test]
    async fn tail_stream_errors_are_not_hidden_by_streaming_client() {
        let (endpoint, server) =
            spawn_tail_server(Bytes::from_static(b"not-json\n"), Duration::ZERO).await;
        let HttpClients { tail, .. } =
            build_http_clients(TEST_REQUEST_TIMEOUT).expect("build test clients");
        let (_stop_tx, stop_rx) = watch::channel(false);
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            tail_reader(
                tail,
                endpoint,
                TEST_REQUEST_TIMEOUT,
                false,
                0,
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
                stop_rx,
            ),
        )
        .await
        .expect("tail error deadline");
        assert!(result.is_err(), "malformed tail frame must be surfaced");
        server.abort();
    }
}
