#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tauriConfPath = path.join(root, "src/claudio-desktop/tauri.conf.json");
const cargoTomlPath = path.join(root, "src/claudio-desktop/Cargo.toml");
const frontendPackageJsonPath = path.join(root, "src/claudio-web/package.json");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function updateTauriConfig(version) {
  const config = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  const previous = String(config.version ?? "");
  config.version = version;
  fs.writeFileSync(tauriConfPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return previous;
}

function updateCargoToml(version) {
  const lines = fs.readFileSync(cargoTomlPath, "utf8").split(/\r?\n/);
  let inPackageSection = false;
  let replaced = false;
  let previous = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inPackageSection = trimmed === "[package]";
      continue;
    }

    if (!inPackageSection) {
      continue;
    }

    const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
    if (!match) {
      continue;
    }

    previous = match[1];
    lines[index] = `version = "${version}"`;
    replaced = true;
    break;
  }

  if (!replaced) {
    throw new Error("Could not find [package] version in Cargo.toml");
  }

  fs.writeFileSync(cargoTomlPath, `${lines.join("\n")}\n`, "utf8");
  return previous;
}

function updateFrontendPackageJson(version) {
  const packageJson = JSON.parse(fs.readFileSync(frontendPackageJsonPath, "utf8"));
  const previous = String(packageJson.version ?? "");
  packageJson.version = version;
  fs.writeFileSync(frontendPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return previous;
}

function main() {
  const version = process.argv[2]?.trim();
  if (!version) {
    console.error("Usage: node scripts/bump_desktop_version.cjs <version>");
    process.exit(1);
  }

  if (!semverPattern.test(version)) {
    console.error(`Invalid version '${version}'. Expected SemVer like 0.1.1 or 0.2.0-beta.1.`);
    process.exit(1);
  }

  const oldTauri = updateTauriConfig(version);
  const oldCargo = updateCargoToml(version);
  const oldFrontend = updateFrontendPackageJson(version);

  console.log(`Updated desktop version to ${version}`);
  console.log(`- tauri.conf.json: ${oldTauri} -> ${version}`);
  console.log(`- Cargo.toml: ${oldCargo} -> ${version}`);
  console.log(`- src/claudio-web/package.json: ${oldFrontend} -> ${version}`);
}

main();
