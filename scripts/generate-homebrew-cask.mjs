#!/usr/bin/env node

import { writeFileSync } from "fs";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    parsed[args[i].replace(/^--/, "")] = args[i + 1];
  }
  return parsed;
}

const args = parseArgs();
const version = args.version;
const shaAarch64 = args["sha-aarch64"];
const shaX64 = args["sha-x64"];
const baseUrl = args["base-url"];
const output = args.output;
const minMacos = args["min-macos"] || "sonoma";
const homepage = args.homepage || "https://proliferate.com/";
const desc = args.desc || "Open-source AI IDE for running coding agents in parallel";

if (!version || !shaAarch64 || !shaX64 || !baseUrl || !output) {
  console.error(
    "Usage: generate-homebrew-cask.mjs --version <ver> --sha-aarch64 <sha> --sha-x64 <sha> --base-url <url> --output <file> [--min-macos <name>] [--homepage <url>] [--desc <text>]",
  );
  process.exit(1);
}

const SHA256_RE = /^[0-9a-f]{64}$/;
for (const [label, sha] of [
  ["aarch64", shaAarch64],
  ["x64", shaX64],
]) {
  if (!SHA256_RE.test(sha)) {
    console.error(`Invalid sha256 for ${label}: ${sha}`);
    process.exit(1);
  }
}

// `#{version}` / `#{arch}` are Ruby interpolations resolved by Homebrew at
// install time — they must remain literal in the emitted cask, so they are NOT
// interpolated here (JS only expands ${...}).
const cask = `cask "proliferate" do
  arch arm: "aarch64", intel: "x64"

  version "${version}"
  sha256 arm:   "${shaAarch64}",
         intel: "${shaX64}"

  url "${baseUrl}/Proliferate_#{version}_#{arch}.dmg"
  name "Proliferate"
  desc "${desc}"
  homepage "${homepage}"

  livecheck do
    url "${baseUrl}/installers.json"
    strategy :json do |json|
      json["version"]
    end
  end

  auto_updates true
  depends_on macos: :${minMacos}

  app "Proliferate.app"

  zap trash: [
    "~/Library/Application Support/com.proliferate.app",
    "~/Library/Caches/com.proliferate.app",
    "~/Library/Preferences/com.proliferate.app.plist",
    "~/Library/Saved Application State/com.proliferate.app.savedState",
  ]
end
`;

writeFileSync(output, cask);
console.log(`Generated ${output} for version ${version}`);
