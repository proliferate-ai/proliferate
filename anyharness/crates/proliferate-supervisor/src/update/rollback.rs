use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RollbackPlan {
    pub component: String,
    pub previous_path: PathBuf,
    pub staged_path: PathBuf,
}

impl RollbackPlan {
    pub fn new(component: impl Into<String>, previous_path: PathBuf, staged_path: PathBuf) -> Self {
        Self {
            component: component.into(),
            previous_path,
            staged_path,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::RollbackPlan;

    #[test]
    fn rollback_plan_records_previous_and_staged_paths() {
        let plan = RollbackPlan::new(
            "worker",
            PathBuf::from("/opt/proliferate/bin/worker"),
            PathBuf::from("/opt/proliferate/staged/worker"),
        );
        assert_eq!(plan.component, "worker");
        assert_eq!(
            plan.previous_path,
            PathBuf::from("/opt/proliferate/bin/worker")
        );
        assert_eq!(
            plan.staged_path,
            PathBuf::from("/opt/proliferate/staged/worker")
        );
    }
}
