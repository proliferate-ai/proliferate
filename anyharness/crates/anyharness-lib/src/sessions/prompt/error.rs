#[derive(Debug, Clone)]
pub struct PromptValidationError {
    pub code: &'static str,
    pub detail: String,
}

impl PromptValidationError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new("PROMPT_INTERNAL_ERROR", detail)
    }
}
