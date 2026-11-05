#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronPackageJsonPath = path.join(root, "src/claudio-desktop/app/package.json");
const csprojPath = path.join(root, "src/claudio-desktop/core/Claudio.Core.csproj");
const frontendPackageJsonPath = path.join(root, "src/claudio-web/package.json");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function updateElectronPackageJson(version) {
  const packageJson = JSON.parse(fs.readFileSync(electronPackageJsonPath, "utf8"));
  const previous = String(packageJson.version ?? "");
  packageJson.version = version;
  fs.writeFileSync(electronPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return previous;
}

function updateCsproj(version) {
  const contents = fs.readFileSync(csprojPath, "utf8");
  const pattern = /<Version>([^<]+)<\/Version>/;
  const match = contents.match(pattern);
  if (!match) {
    throw new Error("Could not find <Version> in Claudio.Core.csproj");
  }
  fs.writeFileSync(csprojPath, contents.replace(pattern, `<Version>${version}</Version>`), "utf8");
  return match[1];
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
    console.error("Usage: node scripts/bump_version.cjs <version>");
    process.exit(1);
  }

  if (!semverPattern.test(version)) {
    console.error(`Invalid version '${version}'. Expected SemVer like 0.1.1 or 0.2.0-beta.1.`);
    process.exit(1);
  }

  const oldElectron = updateElectronPackageJson(version);
  const oldCsproj = updateCsproj(version);
  const oldFrontend = updateFrontendPackageJson(version);

  console.log(`Updated desktop version to ${version}`);
  console.log(`- src/claudio-desktop/app/package.json: ${oldElectron} -> ${version}`);
  console.log(`- Claudio.Core.csproj: ${oldCsproj} -> ${version}`);
  console.log(`- src/claudio-web/package.json: ${oldFrontend} -> ${version}`);
}

main();
