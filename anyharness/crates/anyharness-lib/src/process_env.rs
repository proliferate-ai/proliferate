const RUNTIME_PRIVATE_ENV: &[&str] = &[
    "ANYHARNESS_SENTRY_DSN",
    "ANYHARNESS_SENTRY_ENVIRONMENT",
    "ANYHARNESS_SENTRY_RELEASE",
    "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE",
    "PROLIFERATE_TARGET_SENTRY_DSN",
    "PROLIFERATE_TARGET_SENTRY_ENVIRONMENT",
    // Retired shared override (kept on the strip list defensively) plus the
    // component-specific overrides that replaced it.
    "PROLIFERATE_TARGET_SENTRY_RELEASE",
    "PROLIFERATE_WORKER_SENTRY_RELEASE",
    "PROLIFERATE_SUPERVISOR_SENTRY_RELEASE",
    "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE",
    "PROLIFERATE_ORG_ID",
    "PROLIFERATE_SANDBOX_ID",
    "PROLIFERATE_RUNTIME_ENV",
    "PROLIFERATE_USER_ID",
];

pub(crate) fn remove_runtime_private_env(command: &mut tokio::process::Command) {
    for key in RUNTIME_PRIVATE_ENV {
        command.env_remove(key);
    }
}

pub(crate) fn remove_runtime_private_pty_env(command: &mut portable_pty::CommandBuilder) {
    for key in RUNTIME_PRIVATE_ENV {
        command.env_remove(key);
    }
}
