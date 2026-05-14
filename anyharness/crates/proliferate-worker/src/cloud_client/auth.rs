pub fn bearer_header(token: &str) -> String {
    format!("Bearer {token}")
}
