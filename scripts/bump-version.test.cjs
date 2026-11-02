const assert = require('node:assert/strict');
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

function fixture(t, { broken = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'claudio-bump-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo');
  mkdirSync(cwd);
  const run = (command, args, options = {}) => spawnSync(command, args, {
    cwd, encoding: 'utf8', ...options,
  });
  const success = (command, args, options) => {
    const result = run(command, args, options);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const git = (...args) => success('git', args);
  for (const directory of ['scripts', 'src/claudio-core/src', 'src/claudio-core-cs', 'src/claudio-web', 'src/claudio-electron']) {
    mkdirSync(join(cwd, directory), { recursive: true });
  }
  copyFileSync(join(__dirname, '../Makefile'), join(cwd, 'Makefile'));
  copyFileSync(join(__dirname, 'bump_version.cjs'), join(cwd, 'scripts/bump_version.cjs'));
  writeFileSync(join(cwd, '.gitignore'), '/target/\nartifacts/\nbin/\nobj/\n');
  writeFileSync(join(cwd, 'Cargo.toml'), '[workspace]\nmembers = ["src/claudio-core"]\nresolver = "3"\n');
  writeFileSync(join(cwd, 'src/claudio-core/Cargo.toml'), '[package]\nname = "claudio-core"\nversion = "0.2.1"\nedition = "2024"\n');
  writeFileSync(join(cwd, 'src/claudio-core/src/lib.rs'), broken ? 'invalid rust' : '');
  writeFileSync(join(cwd, 'src/claudio-core-cs/Claudio.Core.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><Version>0.2.1</Version></PropertyGroup></Project>');
  for (const name of ['claudio-web', 'claudio-electron']) {
    writeFileSync(join(cwd, 'src', name, 'package.json'), JSON.stringify({ version: '0.2.1' }));
  }
  success('cargo', ['generate-lockfile', '--offline']);
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.');
  git('commit', '-m', 'Initial fixture');
  return { root, cwd, run, success, git };
}

test('make bump commits the refreshed lockfile and tags the release commit', t => {
  const { cwd, success, git } = fixture(t);
  success('make', ['bump', '0.2.2'], { input: 'n\n' });
  const lock = git('show', 'HEAD:Cargo.lock');
  assert.match(lock, /name = "claudio-core"\nversion = "0\.2\.2"/);
  assert.match(readFileSync(join(cwd, 'src/claudio-core-cs/Claudio.Core.csproj'), 'utf8'), /<Version>0\.2\.2<\/Version>/);
  assert.match(git('show', 'HEAD:src/claudio-core-cs/Claudio.Core.csproj'), /<Version>0\.2\.2<\/Version>/);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse', 'v0.2.2^{commit}'), git('rev-parse', 'HEAD'));
  assert.equal(git('cat-file', '-t', 'v0.2.2'), 'tag');
  for (const name of ['claudio-web', 'claudio-electron']) {
    assert.equal(JSON.parse(readFileSync(join(cwd, 'src', name, 'package.json'), 'utf8')).version, '0.2.2');
  }
  success('cargo', ['check', '--workspace', '--locked', '--offline']);
});

test('a failed Cargo check stops before committing or tagging', t => {
  const { run, git } = fixture(t, { broken: true });
  const before = git('rev-parse', 'HEAD');
  const result = run('make', ['bump', '0.2.2'], { input: 'n\n' });
  assert.notEqual(result.status, 0);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('diff', '--cached', '--name-only'), '');
});

test('an invalid version stops before committing or tagging', t => {
  const { run, git } = fixture(t);
  const before = git('rev-parse', 'HEAD');
  assert.notEqual(run('make', ['bump', 'invalid'], { input: 'n\n' }).status, 0);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('tag', '--list'), '');
  assert.equal(git('status', '--porcelain'), '');
});

test('push=true publishes the commit and its release tag without pushing unrelated tags', t => {
  const { root, success, git } = fixture(t);
  const remote = join(root, 'remote.git');
  success('git', ['init', '--bare', remote]);
  git('remote', 'add', 'origin', remote);
  git('tag', 'unrelated');
  success('make', ['bump', '0.2.2', 'push=true'], { input: '' });
  const refs = git('ls-remote', '--refs', 'origin');
  assert.match(refs, /refs\/heads\/main/);
  assert.match(refs, /refs\/tags\/v0\.2\.2/);
  assert.doesNotMatch(refs, /unrelated/);
});
