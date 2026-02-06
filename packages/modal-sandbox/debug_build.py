"""Debug script to see BASE_IMAGE build logs"""
import modal

app = modal.App("sandbox-image-build-debug")

# Simplified image to debug the npm install
DEBUG_IMAGE = (
    modal.Image.from_registry("ubuntu:22.04")
    .env({"DEBIAN_FRONTEND": "noninteractive"})
    .apt_install("curl", "ca-certificates", "gnupg")
    # Check what node version apt would give us
    .run_commands(
        "echo '=== Checking apt nodejs version ==='",
        "apt-cache policy nodejs || true",
    )
    # Install Node 20 from NodeSource (not apt's ancient Node 12)
    .run_commands(
        "echo '=== Installing Node 20 from NodeSource ==='",
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "node -v",
        "npm -v",
    )
    # Try installing sandbox-mcp with verbose output
    .run_commands(
        "echo '=== Installing sandbox-mcp ==='",
        "npm config get registry",
        "npm install -g proliferate-sandbox-mcp@0.1.5 --unsafe-perm --loglevel verbose",
        "which sandbox-mcp",
        "sandbox-mcp --version",
        force_build=True,
    )
)

if __name__ == "__main__":
    print("Building image with output enabled...")
    with modal.enable_output():
        with app.run():
            DEBUG_IMAGE.build(app)
    print(f"Built image id: {DEBUG_IMAGE.object_id}")
