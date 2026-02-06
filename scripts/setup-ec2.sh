#!/bin/bash
# Proliferate EC2 Setup Script
# Usage: curl -fsSL https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/setup-ec2.sh | bash

set -e

echo "=========================================="
echo "  Proliferate EC2 Setup"
echo "=========================================="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS. Please install dependencies manually."
    exit 1
fi

echo "Detected OS: $OS"

# Install Docker and dependencies
case $OS in
    amzn)
        echo "Installing on Amazon Linux..."
        sudo dnf update -y
        sudo dnf install -y docker git
        sudo systemctl start docker
        sudo systemctl enable docker
        ;;
    ubuntu)
        echo "Installing on Ubuntu..."
        sudo apt-get update
        sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release

        # Add Docker's official GPG key
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

        # Set up Docker repository
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        # Install Docker
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io git
        ;;
    debian)
        echo "Installing on Debian..."
        sudo apt-get update
        sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release

        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io git
        ;;
    *)
        echo "Unsupported OS: $OS"
        echo "Please install Docker and Docker Compose manually."
        exit 1
        ;;
esac

# Add current user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
echo "Installing Docker Compose..."
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
sudo curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
echo ""
echo "Verifying installations..."
docker --version
docker-compose --version
git --version

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "IMPORTANT: Log out and back in for Docker permissions to take effect."
echo ""
echo "Next steps:"
echo "  1. Log out: exit"
echo "  2. SSH back in"
echo "  3. Clone Proliferate:"
echo "     git clone https://github.com/proliferate-ai/cloud.git"
echo "     cd cloud"
echo "  4. Configure environment:"
echo "     cp .env.example .env"
echo "     nano .env"
echo "  5. Start Proliferate:"
echo "     docker-compose up -d"
echo ""
