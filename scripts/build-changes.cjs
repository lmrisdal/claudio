const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');

const webPaths = [
  'src/claudio-api/', 'src/claudio-web/', 'tests/', 'docker/',
];
const desktopPaths = [
  'src/claudio-desktop/', 'src/claudio-electron/', 'src/claudio-uninstaller/', 'src/claudio-web/',
];
const webFiles = new Set(['Directory.Build.props', 'Directory.Packages.props', 'Claudio.slnx']);
const desktopFiles = new Set(['Cargo.toml', 'Cargo.lock']);

function classifyChanges(files) {
  return {
    web: files.some(file => webPaths.some(prefix => file.startsWith(prefix)) || webFiles.has(file)),
    desktop: files.some(file => desktopPaths.some(prefix => file.startsWith(prefix)) || desktopFiles.has(file)),
  };
}

function changedFiles(before, sha, cwd = process.cwd()) {
  if (![before, sha].every(value => /^[a-f0-9]{40}$/.test(value))) {
    throw new Error('Invalid commit in tested push range');
  }
  const args = /^0+$/.test(before)
    ? ['ls-tree', '-r', '--name-only', '-z', sha]
    : ['diff', '--name-only', '--no-renames', '-z', before, sha];
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

if (require.main === module) {
  const { before, sha } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (sha !== process.env.BUILD_SHA) throw new Error('Push range does not match the tested build commit');
  const changes = classifyChanges(changedFiles(before, sha));
  appendFileSync(process.env.GITHUB_OUTPUT, `web=${changes.web}\ndesktop=${changes.desktop}\n`);
}

module.exports = { classifyChanges, changedFiles };
