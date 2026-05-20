pub mod mcp;
pub mod model;
pub mod registry;
pub mod session_extension;
pub mod skills;
pub mod validation;

pub use model::{
    SessionPlugin, SessionPluginBundle, SessionPluginCredentialBinding,
    SessionPluginCredentialBindingStatus, SessionPluginSkill, SessionPluginSkillResource,
};
pub use registry::PluginBundleRegistry;
pub use session_extension::PluginSessionLaunchExtension;
