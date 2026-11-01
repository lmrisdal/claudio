const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sources = Object.fromEntries(['build', 'release'].map(name => [
  name, readFileSync(join(__dirname, `../.github/workflows/${name}.yml`), 'utf8'),
]));
const gates = Object.fromEntries(Object.entries(sources).map(([name, source]) => [
  name, new AsyncFunction('github', 'context', 'core', 'setTimeout',
    source.match(/          script: \|\n((?:            [^\n]*\n|\n)+)/)[1].replace(/^ {12}/gm, '')),
]));
const validRun = {
  head_sha: 'tested-sha', head_repository: { full_name: 'owner/repo' },
  event: 'push', status: 'completed', conclusion: 'success', html_url: 'https://example.test/run',
};

async function verify(workflow, options = {}) {
  const outputs = {};
  let failure;
  let queries = 0;
  let sleeps = 0;
  const endpoint = () => {};
  const listTags = () => {};
  const eventName = options.eventName ?? (workflow === 'build' ? 'workflow_run' : 'push');
  const context = {
    repo: { owner: 'owner', repo: 'repo' }, eventName,
    ref: options.ref ?? 'refs/tags/v0.2.0',
    sha: eventName === 'workflow_run' ? 'newer-main-sha' : 'tested-sha',
    payload: eventName === 'workflow_run' ? { workflow_run: { head_sha: 'tested-sha' } } : {},
  };
  await gates[workflow]({
    rest: {
      actions: { listWorkflowRuns: endpoint },
      repos: {
        listTags,
        getContent: async parameters => {
          assert.equal(parameters.ref, 'tested-sha');
          return { data: { content: Buffer.from('{"version":"0.2.0"}').toString('base64') } };
        },
      },
      git: {
        getRef: async parameters => {
          assert.equal(parameters.ref, 'tags/v0.2.0');
          return { data: { object: options.target ?? { type: 'commit', sha: 'tested-sha' } } };
        },
        getTag: async parameters => {
          assert.equal(parameters.tag_sha, 'tag-object');
          return { data: { object: options.annotated } };
        },
      },
    },
    paginate: async (actualEndpoint, parameters) => {
      if (actualEndpoint === listTags) return options.tags ?? [];
      assert.equal(actualEndpoint, endpoint);
      assert.equal(parameters.workflow_id, 'test.yml');
      assert.equal(parameters.head_sha, 'tested-sha');
      assert.equal(parameters.owner, 'owner');
      assert.equal(parameters.repo, 'repo');
      queries++;
      return options.sequence
        ? options.sequence[Math.min(queries - 1, options.sequence.length - 1)]
        : options.runs ?? [validRun];
    },
  }, context, {
    setFailed: message => { failure = message; },
    setOutput: (key, value) => { outputs[key] = value; }, info() {},
  }, resolve => { sleeps++; resolve(); });
  return { outputs, failure, queries, sleeps };
}

const scenarios = [
  ['successful push', [validRun], true],
  ['successful manual CI', [{ ...validRun, event: 'workflow_dispatch' }], true],
  ['no CI', [], false],
  ['different commit', [{ ...validRun, head_sha: 'other-sha' }], false],
  ['failed CI', [{ ...validRun, conclusion: 'failure' }], false],
  ['cancelled CI', [{ ...validRun, conclusion: 'cancelled' }], false],
  ['skipped CI', [{ ...validRun, conclusion: 'skipped' }], false],
  ['unfinished CI', [{ ...validRun, status: 'in_progress', conclusion: null }], false],
  ['PR-only CI', [{ ...validRun, event: 'pull_request' }], false],
  ['fork CI', [{ ...validRun, head_repository: { full_name: 'fork/repo' } }], false],
];
for (const workflow of ['build', 'release']) {
  for (const [name, runs, expected] of scenarios) {
    test(`${workflow}: ${name}`, async () => {
      const result = await verify(workflow, { runs });
      assert.equal(!result.failure, expected);
      assert.equal(result.outputs.sha, expected ? 'tested-sha' : undefined);
    });
  }
}

test('release waits for CI to start and complete', async () => {
  const result = await verify('release', { sequence: [[], [{ ...validRun, status: 'in_progress', conclusion: null }], [validRun]] });
  assert.equal(result.failure, undefined);
  assert.equal(result.sleeps, 2);
  assert.equal(result.outputs.tag, 'v0.2.0');
});
test('release stops immediately after completed failed CI', async () => {
  const result = await verify('release', { runs: [{ ...validRun, conclusion: 'failure' }] });
  assert.match(result.failure, /failed or was cancelled/);
  assert.equal(result.sleeps, 0);
});
test('release wait has a finite timeout', async () => {
  const result = await verify('release', { runs: [] });
  assert.match(result.failure, /timed out/);
  assert.equal(result.queries, 90);
  assert.equal(result.sleeps, 89);
});
test('release rejects manual runs on branches, including bump commits', async () => {
  const result = await verify('release', { eventName: 'workflow_dispatch', ref: 'refs/heads/main' });
  assert.match(result.failure, /select a version tag/);
  assert.equal(result.queries, 0);
});
test('release rejects a tag that differs from the app version', async () => {
  assert.match((await verify('release', { ref: 'refs/tags/v0.3.0' })).failure, /does not match app version/);
});
for (const [name, target, annotated, expected] of [
  ['lightweight', { type: 'commit', sha: 'tested-sha' }, null, true],
  ['annotated', { type: 'tag', sha: 'tag-object' }, { type: 'commit', sha: 'tested-sha' }, true],
  ['wrong commit', { type: 'commit', sha: 'other-sha' }, null, false],
  ['annotated wrong commit', { type: 'tag', sha: 'tag-object' }, { type: 'commit', sha: 'other-sha' }, false],
]) {
  test(`release tag: ${name}`, async () => {
    assert.equal(!(await verify('release', { target, annotated })).failure, expected);
  });
}
for (const [name, tags, tagged] of [
  ['no tag', [], 'false'],
  ['release tag', [{ name: 'v0.2.0', commit: { sha: 'tested-sha' } }], 'true'],
  ['tag on another commit', [{ name: 'v0.2.0', commit: { sha: 'other-sha' } }], 'false'],
  ['dev tag', [{ name: 'dev', commit: { sha: 'tested-sha' } }], 'false'],
]) {
  test(`automatic development build: ${name}`, async () => {
    assert.equal((await verify('build', { tags })).outputs.tagged, tagged);
  });
}
test('manual development build verifies the requested commit', async () => {
  assert.equal((await verify('build', { eventName: 'workflow_dispatch' })).outputs.sha, 'tested-sha');
});

const { classifyChanges, changedFiles } = require('./build-changes.cjs');
for (const [name, files, expected] of [
  ['documentation only', ['README.md', 'docs/setup.md'], { web: false, desktop: false }],
  ['workflow only', ['.github/workflows/build.yml'], { web: false, desktop: false }],
  ['API source', ['src/claudio-api/Program.cs'], { web: true, desktop: false }],
  ['web source', ['src/claudio-web/src/App.tsx'], { web: true, desktop: true }],
  ['Electron source', ['src/claudio-electron/src/main.ts'], { web: false, desktop: true }],
  ['sidecar source', ['src/claudio-core/src/main.rs'], { web: false, desktop: true }],
  ['uninstaller source', ['src/claudio-uninstaller/src/main.rs'], { web: false, desktop: true }],
  ['Docker config', ['docker/Dockerfile'], { web: true, desktop: false }],
  ['Rust dependencies', ['Cargo.lock'], { web: false, desktop: true }],
  ['API build config', ['Directory.Build.props'], { web: true, desktop: false }],
  ['test source', ['tests/claudio-api/Test.cs'], { web: true, desktop: false }],
]) {
  test(`artifact paths: ${name}`, () => assert.deepEqual(classifyChanges(files), expected));
}

test('change detection covers the full push and ignores later commits', () => {
  const { execFileSync } = require('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync, renameSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const directory = mkdtempSync(join(tmpdir(), 'claudio-build-paths-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  const commit = message => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    writeFileSync(join(directory, 'README.md'), 'initial');
    const before = commit('initial');
    mkdirSync(join(directory, 'src/claudio-electron'), { recursive: true });
    writeFileSync(join(directory, 'src/claudio-electron/main.ts'), 'source');
    commit('source change');
    writeFileSync(join(directory, 'README.md'), 'docs');
    const tested = commit('docs change');
    mkdirSync(join(directory, 'src/claudio-api'), { recursive: true });
    writeFileSync(join(directory, 'src/claudio-api/Program.cs'), 'later source');
    commit('later main commit');
    assert.deepEqual(classifyChanges(changedFiles(before, tested, directory)), { web: false, desktop: true });
    assert.deepEqual(classifyChanges(changedFiles('0'.repeat(40), before, directory)), { web: false, desktop: false });
    renameSync(join(directory, 'src/claudio-electron/main.ts'), join(directory, 'moved.txt'));
    const renamed = commit('move source outside source tree');
    assert.ok(changedFiles(tested, renamed, directory).includes('src/claudio-electron/main.ts'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
