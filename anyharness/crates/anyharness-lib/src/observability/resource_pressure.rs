use std::path::Path;

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
pub struct RuntimeDiskPressure {
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
    pub disk: Option<RuntimeDiskPressure>,
    pub pressure_percent: Option<f64>,
    pub collected_at: String,
}

pub fn collect_resource_pressure(
    runtime_home: &Path,
    managed_worktrees_root: &Path,
) -> Option<RuntimeResourcePressure> {
    let cpu = collect_cpu_pressure();
    let memory = collect_memory_pressure();
    let disk = collect_disk_pressure(managed_worktrees_root, runtime_home);
    let pressure_percent = [
        cpu.as_ref().map(|cpu| cpu.normalized_percent),
        memory.as_ref().map(|memory| memory.percent),
        disk.as_ref().map(|disk| disk.percent),
    ]
    .into_iter()
    .flatten()
    .reduce(f64::max);
    let level = pressure_percent
        .map(pressure_level)
        .unwrap_or(RuntimePressureLevel::Unknown);

    if cpu.is_none() && memory.is_none() && disk.is_none() {
        return None;
    }

    Some(RuntimeResourcePressure {
        level,
        cpu,
        memory,
        disk,
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
    let percent = (used_bytes as f64 / total_bytes as f64) * 100.0;
    Some(RuntimeMemoryPressure {
        used_bytes,
        total_bytes,
        available_bytes,
        percent,
        ideal_max_percent: IDEAL_MAX_PERCENT,
    })
}

fn collect_disk_pressure(
    managed_worktrees_root: &Path,
    runtime_home: &Path,
) -> Option<RuntimeDiskPressure> {
    statvfs_disk_pressure(managed_worktrees_root).or_else(|| statvfs_disk_pressure(runtime_home))
}

#[cfg(unix)]
fn statvfs_disk_pressure(path: &Path) -> Option<RuntimeDiskPressure> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats = MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a NUL-terminated C string and `stats` points to valid,
    // writable storage. A successful call initializes the complete statvfs
    // value before `assume_init`.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: the successful `statvfs` call above initialized `stats`.
    let stats = unsafe { stats.assume_init() };
    let fragment_size = if stats.f_frsize > 0 {
        stats.f_frsize as u128
    } else {
        stats.f_bsize as u128
    };
    disk_pressure(
        stats.f_blocks as u128,
        stats.f_bavail as u128,
        fragment_size,
    )
}

#[cfg(not(unix))]
fn statvfs_disk_pressure(_path: &Path) -> Option<RuntimeDiskPressure> {
    None
}

fn disk_pressure(
    total_blocks: u128,
    available_blocks: u128,
    fragment_size: u128,
) -> Option<RuntimeDiskPressure> {
    if total_blocks == 0 || fragment_size == 0 {
        return None;
    }
    let total_bytes = byte_count(total_blocks, fragment_size);
    let available_bytes = byte_count(available_blocks.min(total_blocks), fragment_size);
    let used_bytes = total_bytes.saturating_sub(available_bytes);
    let percent = (used_bytes as f64 / total_bytes as f64) * 100.0;
    Some(RuntimeDiskPressure {
        used_bytes,
        total_bytes,
        available_bytes,
        percent,
        ideal_max_percent: IDEAL_MAX_PERCENT,
    })
}

fn byte_count(blocks: u128, fragment_size: u128) -> u64 {
    blocks
        .saturating_mul(fragment_size)
        .min(u128::from(u64::MAX)) as u64
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_pressure_reports_used_total_available_and_percent() {
        let pressure = disk_pressure(100, 25, 4096).expect("disk pressure");

        assert_eq!(pressure.total_bytes, 409_600);
        assert_eq!(pressure.available_bytes, 102_400);
        assert_eq!(pressure.used_bytes, 307_200);
        assert_eq!(pressure.percent, 75.0);
        assert_eq!(pressure.ideal_max_percent, 80.0);
    }

    #[test]
    fn disk_pressure_rejects_zero_capacity() {
        assert!(disk_pressure(0, 0, 4096).is_none());
        assert!(disk_pressure(100, 25, 0).is_none());
    }

    #[test]
    fn pressure_level_uses_memory_thresholds_for_disk_percent() {
        assert_eq!(pressure_level(63.9), RuntimePressureLevel::Nominal);
        assert_eq!(pressure_level(64.0), RuntimePressureLevel::Elevated);
        assert_eq!(pressure_level(79.9), RuntimePressureLevel::Elevated);
        assert_eq!(pressure_level(80.0), RuntimePressureLevel::Critical);
    }
}
