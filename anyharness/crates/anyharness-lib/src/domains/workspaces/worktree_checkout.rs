#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeCheckoutMode {
    NewBranch,
    DetachedRef,
}

impl Default for WorktreeCheckoutMode {
    fn default() -> Self {
        Self::NewBranch
    }
}

impl WorktreeCheckoutMode {
    pub fn creates_branch(self) -> bool {
        matches!(self, Self::NewBranch)
    }
}
