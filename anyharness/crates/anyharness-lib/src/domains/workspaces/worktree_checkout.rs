#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[derive(Default)]
pub enum WorktreeCheckoutMode {
    #[default]
    NewBranch,
    DetachedRef,
}


impl WorktreeCheckoutMode {
    pub fn creates_branch(self) -> bool {
        matches!(self, Self::NewBranch)
    }
}
