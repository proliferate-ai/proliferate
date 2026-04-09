use anyhow::Result;

pub fn run() -> Result<()> {
    let json = anyharness_lib::api::openapi::openapi_json();
    println!("{json}");
    Ok(())
}
