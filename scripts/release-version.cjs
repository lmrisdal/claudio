const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function validateVersion(versions, tag) {
  const version = versions.electron;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || version.length > 128 || match[4]?.split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error(`Invalid release version: ${version}. Use SemVer without build metadata.`);
  }
  for (const [name, actual] of Object.entries(versions)) {
    if (actual !== version) throw new Error(`${name} version ${actual} does not match ${version}`);
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not match application version v${version}`);
  }
  return { version, prerelease: Boolean(match[4]) };
}

function readVersions(root) {
  const packageVersion = directory => JSON.parse(readFileSync(join(root, 'src', directory, 'package.json'), 'utf8')).version;
  const core = readFileSync(join(root, 'src/claudio-desktop/core/Claudio.Core.csproj'), 'utf8').match(/<Version>([^<]+)<\/Version>/)?.[1];
  return { electron: packageVersion('claudio-desktop/app'), web: packageVersion('claudio-web'), core };
}

if (require.main === module) {
  const versions = readVersions(join(__dirname, '..'));
  const tag = process.env.GITHUB_EVENT_NAME === 'push' ? process.env.GITHUB_REF_NAME : undefined;
  if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error('Publishing requires a version tag');
  }
  const result = validateVersion(versions, tag);
  console.log(`Version: ${result.version}; prerelease: ${result.prerelease}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`);
  }
}

module.exports = { readVersions, validateVersion };
