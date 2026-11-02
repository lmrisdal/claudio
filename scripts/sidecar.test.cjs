const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

const load = name => import(join(__dirname, name));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'claudio-stage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = { rustDir: join(root, 'rust'), csharpDir: join(root, 'cs'), uninstallerDir: join(root, 'un'), sevenZipDir: join(root, '7z'), output: join(root, 'out') };
  for (const dir of [dirs.rustDir, dirs.csharpDir, dirs.uninstallerDir, join(dirs.sevenZipDir)]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dirs.sevenZipDir, '7z2605-src.tar.xz'), 'source');
  for (const [dir, names] of [
    [dirs.rustDir, ['claudio-core', 'claudio-core.exe', 'claudio-game-uninstaller.exe', 'claudio-core.d', 'claudio-core.pdb']],
    [dirs.csharpDir, ['claudio-core', 'claudio-core.exe', 'claudio-core.dbg', 'claudio-core.pdb']],
    [dirs.uninstallerDir, ['claudio-game-uninstaller.exe', 'claudio-game-uninstaller.pdb']],
    [dirs.sevenZipDir, ['7zzs', '7za.exe', 'License.txt']],
  ]) for (const name of names) writeFileSync(join(dir, name), name);
  return dirs;
}

test('a rust package stages exactly the files it shipped before', async t => {
  const { stage } = await load('stage-sidecar.mjs');
  const dirs = fixture(t);
  assert.deepEqual(stage('rust', 'linux', dirs), ['claudio-core']);
  assert.deepEqual(readdirSync(dirs.output).sort(), ['claudio-core']);
  assert.deepEqual(stage('rust', 'win32', dirs), ['claudio-core.exe', 'claudio-game-uninstaller.exe']);
  assert.deepEqual(readdirSync(dirs.output).sort(), ['claudio-core.exe', 'claudio-game-uninstaller.exe']);
});

test('a csharp package adds 7-Zip and notices and leaves debug symbols out', async t => {
  const { stage } = await load('stage-sidecar.mjs');
  const dirs = fixture(t);
  stage('csharp', 'linux', dirs);
  assert.deepEqual(readdirSync(dirs.output).sort(), ['7-zip', 'THIRD-PARTY-NOTICES.md', 'claudio-core']);
  assert.deepEqual(readdirSync(join(dirs.output, '7-zip')).sort(), ['7za.exe', '7zzs', 'License.txt']);
  stage('csharp', 'win32', dirs);
  assert.deepEqual(readdirSync(dirs.output).sort(), ['7-zip', 'THIRD-PARTY-NOTICES.md', 'claudio-core.exe', 'claudio-game-uninstaller.exe']);
});

test('staging fails with a clear message when the sidecar was not built', async t => {
  const { stage } = await load('stage-sidecar.mjs');
  const dirs = fixture(t);
  rmSync(join(dirs.rustDir, 'claudio-core'));
  assert.throws(() => stage('rust', 'linux', dirs), /Build the rust sidecar first/);
  assert.throws(() => stage('go', 'linux', dirs), /Unknown sidecar/);
});

test('7-Zip downloads are rejected on any hash mismatch', async () => {
  const { download, FILES, sha256 } = await load('fetch-7zip.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'claudio-7z-'));
  try {
    const bad = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('tampered') });
    await assert.rejects(download(FILES.linux, dir, bad), /SHA-256 mismatch/);
    const missing = async () => ({ ok: false, status: 404 });
    await assert.rejects(download(FILES.linux, dir, missing), /HTTP 404/);
    assert.equal(sha256(Buffer.from('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(FILES.linux.sha256.length, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
