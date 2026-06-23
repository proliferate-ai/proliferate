const IDEAL_MAX_PERCENT: f64 = 80.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimePressureLevel {
    Unknown,
    Nominal,
    Elevated,
    Critical,
}

#[derive(Debug, Clone)]
pub struct RuntimeCpuPressure {
    pub load_average_1m: f64,
    pub normalized_percent: f64,
    pub ideal_max_percent: f64,
    pub logical_core_count: u32,
}

#[derive(Debug, Clone)]
pub struct RuntimeMemoryPressure {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub percent: f64,
    pub ideal_max_percent: f64,
}

#[derive(Debug, Clone)]
pub struct RuntimeResourcePressure {
    pub level: RuntimePressureLevel,
    pub cpu: Option<RuntimeCpuPressure>,
    pub memory: Option<RuntimeMemoryPressure>,
    pub pressure_percent: Option<f64>,
    pub collected_at: String,
}

pub fn collect_resource_pressure() -> Option<RuntimeResourcePressure> {
    let cpu = collect_cpu_pressure();
    let memory = collect_memory_pressure();
    let pressure_percent = [
        cpu.as_ref().map(|cpu| cpu.normalized_percent),
        memory.as_ref().map(|memory| memory.percent),
    ]
    .into_iter()
    .flatten()
    .reduce(f64::max);
    let level = pressure_percent
        .map(pressure_level)
        .unwrap_or(RuntimePressureLevel::Unknown);

    if cpu.is_none() && memory.is_none() {
        return None;
    }

    Some(RuntimeResourcePressure {
        level,
        cpu,
        memory,
        pressure_percent,
        collected_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn pressure_level(percent: f64) -> RuntimePressureLevel {
    if percent >= IDEAL_MAX_PERCENT {
        RuntimePressureLevel::Critical
    } else if percent >= IDEAL_MAX_PERCENT * 0.8 {
        RuntimePressureLevel::Elevated
    } else {
        RuntimePressureLevel::Nominal
    }
}

fn collect_cpu_pressure() -> Option<RuntimeCpuPressure> {
    if cgroup_cpu_quota_present() {
        return None;
    }
    let raw = std::fs::read_to_string("/proc/loadavg").ok()?;
    let load_average_1m = raw.split_whitespace().next()?.parse::<f64>().ok()?;
    let logical_core_count = std::thread::available_parallelism()
        .ok()
        .and_then(|count| u32::try_from(count.get()).ok())
        .filter(|count| *count > 0)?;
    let normalized_percent = (load_average_1m / f64::from(logical_core_count)) * 100.0;
    Some(RuntimeCpuPressure {
        load_average_1m,
        normalized_percent,
        ideal_max_percent: IDEAL_MAX_PERCENT,
        logical_core_count,
    })
}

fn collect_memory_pressure() -> Option<RuntimeMemoryPressure> {
    collect_cgroup_v2_memory_pressure()
        .or_else(collect_cgroup_v1_memory_pressure)
        .or_else(collect_proc_memory_pressure)
}

fn collect_proc_memory_pressure() -> Option<RuntimeMemoryPressure> {
    let raw = std::fs::read_to_string("/proc/meminfo").ok()?;
    let total_bytes = meminfo_kib(&raw, "MemTotal:")?.saturating_mul(1024);
    let available_bytes = meminfo_kib(&raw, "MemAvailable:")?.saturating_mul(1024);
    memory_pressure(total_bytes.saturating_sub(available_bytes), total_bytes)
}

fn collect_cgroup_v2_memory_pressure() -> Option<RuntimeMemoryPressure> {
    let total_bytes = read_cgroup_u64("/sys/fs/cgroup/memory.max")?;
    let used_bytes = read_cgroup_u64("/sys/fs/cgroup/memory.current")?;
    memory_pressure(used_bytes, total_bytes)
}

fn collect_cgroup_v1_memory_pressure() -> Option<RuntimeMemoryPressure> {
    let total_bytes = read_cgroup_u64("/sys/fs/cgroup/memory/memory.limit_in_bytes")?;
    if total_bytes > (1_u64 << 60) {
        return None;
    }
    let used_bytes = read_cgroup_u64("/sys/fs/cgroup/memory/memory.usage_in_bytes")?;
    memory_pressure(used_bytes, total_bytes)
}

fn memory_pressure(used_bytes: u64, total_bytes: u64) -> Option<RuntimeMemoryPressure> {
    if total_bytes == 0 {
        return None;
    }
    let used_bytes = used_bytes.min(total_bytes);
    let available_bytes = total_bytes.saturating_sub(used_bytes);
    let used_bytes = total_bytes.saturating_sub(available_bytes);
    let percent = (used_bytes as f64 / total_bytes as f64) * 100.0;
    Some(RuntimeMemoryPressure {
        used_bytes,
        total_bytes,
        available_bytes,
        percent,
        ideal_max_percent: IDEAL_MAX_PERCENT,
    })
}

fn cgroup_cpu_quota_present() -> bool {
    cgroup_v2_cpu_quota_present() || cgroup_v1_cpu_quota_present()
}

fn cgroup_v2_cpu_quota_present() -> bool {
    let Ok(raw) = std::fs::read_to_string("/sys/fs/cgroup/cpu.max") else {
        return false;
    };
    let Some(quota) = raw.split_whitespace().next() else {
        return false;
    };
    quota != "max" && quota.parse::<u64>().ok().is_some_and(|value| value > 0)
}

fn cgroup_v1_cpu_quota_present() -> bool {
    read_cgroup_i64("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").is_some_and(|quota| quota > 0)
}

fn meminfo_kib(raw: &str, key: &str) -> Option<u64> {
    raw.lines()
        .find_map(|line| line.strip_prefix(key))
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|value| value.parse::<u64>().ok())
}

fn read_cgroup_u64(path: &str) -> Option<u64> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value = raw.trim();
    if value == "max" {
        return None;
    }
    value.parse::<u64>().ok()
}

fn read_cgroup_i64(path: &str) -> Option<i64> {
    std::fs::read_to_string(path)
        .ok()?
        .trim()
        .parse::<i64>()
        .ok()
}
