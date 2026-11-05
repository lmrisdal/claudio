const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { readVersions, validateVersion } = require('./release-version.cjs');

const versions = version => ({ electron: version, web: version, core: version });

for (const version of ['0.3.0', '1.0.0-beta.1', '2.0.0-rc.0']) {
  test(`validates version and prerelease status: ${version}`, () => {
    assert.deepEqual(validateVersion(versions(version), `v${version}`), {
      version, prerelease: version.includes('-'),
    });
  });
}

test('manual builds validate application versions without requiring a tag', () => {
  assert.deepEqual(validateVersion(versions('0.3.0')), { version: '0.3.0', prerelease: false });
});

for (const component of ['web', 'core']) {
  test(`rejects a mismatched ${component} version`, () => {
    assert.throws(() => validateVersion({ ...versions('0.3.0'), [component]: '0.2.0' }), /does not match/);
  });
}

for (const tag of ['v0.2.0', '0.3.0', 'dev', 'v0.3.0\nlatest']) {
  test(`rejects mismatched tag: ${JSON.stringify(tag)}`, () => {
    assert.throws(() => validateVersion(versions('0.3.0'), tag), /does not match/);
  });
}

for (const version of ['01.2.3', '1.2', '1.2.3-', '1.2.3-01', '1.2.3-beta.01', '1.2.3+build', '1.2.3\n', '1.2.3-$(echo bad)', undefined]) {
  test(`rejects invalid version: ${JSON.stringify(version)}`, () => {
    assert.throws(() => validateVersion(versions(version)), /Invalid release version/);
  });
}

test('reads the application versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'claudio-version-'));
  try {
    for (const name of ['claudio-desktop/core', 'claudio-desktop/app', 'claudio-web']) {
      mkdirSync(join(root, 'src', name), { recursive: true });
    }
    for (const name of ['claudio-desktop/app', 'claudio-web']) {
      writeFileSync(join(root, 'src', name, 'package.json'), JSON.stringify({ version: '0.3.0' }));
    }
    writeFileSync(join(root, 'src/claudio-desktop/core/Claudio.Core.csproj'), '<Project><PropertyGroup><Version>0.3.0</Version></PropertyGroup></Project>');
    assert.deepEqual(readVersions(root), versions('0.3.0'));
    writeFileSync(join(root, 'src/claudio-desktop/core/Claudio.Core.csproj'), '<Project><PropertyGroup><Version>0.2.0</Version></PropertyGroup></Project>');
    assert.throws(() => validateVersion(readVersions(root)), /does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release command rejects branch pushes', () => {
  const result = spawnSync(process.execPath, [join(__dirname, 'release-version.cjs')], {
    env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Publishing requires a version tag/);
});

for (const [version, prerelease, channel] of [
  ['0.2.3-beta.1', 'true', 'dev'],
  ['0.2.3', 'false', 'latest'],
]) {
  test(`publishes ${version} with the ${channel} container tag`, () => {
    const workflow = readFileSync(join(__dirname, '../.github/workflows/release.yml'), 'utf8');
    const script = workflow.match(/      - name: Publish tested container images\n        run: \|\n([\s\S]*?)(?=      - name:)/)[1].replace(/^ {10}/gm, '');
    const sha = 'a'.repeat(40);
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', `docker() { printf '%s\\n' "$*"; }\n${script}`], {
      env: { ...process.env, GITHUB_REPOSITORY: 'LMrisdal/Claudio', GITHUB_SHA: sha, VERSION: version, PRERELEASE: prerelease },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').at(-1).split(' '), [
      'buildx', 'imagetools', 'create',
      '--tag', `ghcr.io/lmrisdal/claudio:${version}`,
      '--tag', `ghcr.io/lmrisdal/claudio:${channel}`,
      `ghcr.io/lmrisdal/claudio:sha-${sha}-amd64`,
      `ghcr.io/lmrisdal/claudio:sha-${sha}-arm64`,
    ]);
  });
}
