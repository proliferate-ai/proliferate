#!/bin/bash
#
# Proliferate CLI Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/install.sh | bash -s 0.2.0  # specific version
#   curl -fsSL https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/install.sh | bash -s latest
#
# Optional mirror:
#   curl -fsSL https://proliferate.com/install.sh | bash
#
set -e

VERSION="${1:-latest}"
INSTALL_DIR="${PROLIFERATE_INSTALL_DIR:-$HOME/.proliferate/bin}"
REPO="proliferate-ai/cloud"
REPO_FALLBACK="proliferate-ai/cloud"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Platform detection
detect_platform() {
    local os arch

    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        darwin)
            os="darwin"
            ;;
        linux)
            os="linux"
            ;;
        mingw*|msys*|cygwin*)
            echo -e "${RED}Error: Windows is not supported.${NC}"
            echo -e "${DIM}Please use Windows Subsystem for Linux (WSL2) instead.${NC}"
            echo -e "${DIM}  https://docs.microsoft.com/en-us/windows/wsl/install${NC}"
            exit 1
            ;;
        *)
            echo -e "${RED}Error: Unsupported operating system: $os${NC}"
            exit 1
            ;;
    esac

    case "$arch" in
        x86_64|amd64)
            arch="x64"
            ;;
        aarch64|arm64)
            arch="arm64"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}"
            exit 1
            ;;
    esac

    echo "${os}-${arch}"
}

# Get download URL for a specific repo
get_download_url() {
    local repo="$1"
    local version="$2"
    local platform="$3"
    local binary_name="proliferate-${platform}"

    if [ "$version" = "latest" ]; then
        echo "https://github.com/$repo/releases/latest/download/${binary_name}.tar.gz"
    else
        echo "https://github.com/$repo/releases/download/cli-v${version}/${binary_name}.tar.gz"
    fi
}

# Main installation
main() {
    local platform download_url

    platform=$(detect_platform)

    echo "Installing Proliferate CLI..."
    echo -e "${DIM}  Platform: ${platform}${NC}"
    echo -e "${DIM}  Version:  ${VERSION}${NC}"
    echo ""

    # Create install directory (only bin/, preserve other files)
    mkdir -p "$INSTALL_DIR"

    # Try primary repo, then fallback
    echo -e "${DIM}Downloading...${NC}"
    local downloaded=false

    for repo in "$REPO" "$REPO_FALLBACK"; do
        download_url=$(get_download_url "$repo" "$VERSION" "$platform")
        if curl -fsSL "$download_url" -o /tmp/proliferate.tar.gz 2>/dev/null; then
            downloaded=true
            break
        fi
    done

    if [ "$downloaded" = false ]; then
        echo -e "${RED}Error: Failed to download Proliferate CLI${NC}"
        echo -e "${DIM}Please check that the version exists and try again.${NC}"
        exit 1
    fi

    # Extract to install directory
    tar -xzf /tmp/proliferate.tar.gz -C "$INSTALL_DIR"
    rm -f /tmp/proliferate.tar.gz

    # Rename platform-specific binary to 'proliferate'
    local binary_name="proliferate-${platform}"
    if [ -f "$INSTALL_DIR/$binary_name" ]; then
        mv "$INSTALL_DIR/$binary_name" "$INSTALL_DIR/proliferate"
    fi

    # Make executable
    chmod +x "$INSTALL_DIR/proliferate"

    # Check if already in PATH
    if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
        echo ""
        echo -e "${GREEN}Proliferate CLI updated successfully!${NC}"
        echo ""
        echo -e "  Location: ${DIM}$INSTALL_DIR/proliferate${NC}"
        echo -e "  Run ${DIM}proliferate --help${NC} to get started"
        echo ""
        return 0
    fi

    # Detect shell and add to PATH
    local shell_rc=""
    local shell_name=""

    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ] || [ "$SHELL" = "/usr/bin/zsh" ]; then
        shell_rc="$HOME/.zshrc"
        shell_name="zsh"
    elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ] || [ "$SHELL" = "/usr/bin/bash" ]; then
        shell_rc="$HOME/.bashrc"
        shell_name="bash"
    else
        shell_rc="$HOME/.profile"
        shell_name="profile"
    fi

    # Add to PATH
    {
        echo ""
        echo "# Proliferate CLI"
        echo "export PATH=\"$INSTALL_DIR:\$PATH\""
    } >> "$shell_rc"

    echo ""
    echo -e "${GREEN}Proliferate CLI installed successfully!${NC}"
    echo ""
    echo -e "  Location: ${DIM}$INSTALL_DIR/proliferate${NC}"
    echo ""
    echo -e "  Added to PATH in ${DIM}$shell_rc${NC}"
    echo -e "  Run: ${DIM}source $shell_rc${NC}"
    echo ""
    echo -e "  Then run ${DIM}proliferate --help${NC} to get started"
    echo ""
}

main
