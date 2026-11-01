const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const validRun = {
  head_sha: 'tested-sha',
  head_repository: { full_name: 'owner/repo' },
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://example.test/run',
};
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
  ['missing repository', [{ ...validRun, head_repository: null }], false],
];

for (const workflow of ['build', 'release']) {
  const source = readFileSync(join(__dirname, `../.github/workflows/${workflow}.yml`), 'utf8');
  const match = source.match(/          script: \|\n((?:            [^\n]*\n|\n)+)/);
  assert.ok(match, `${workflow} must define its CI verification script`);
  const gate = new AsyncFunction('github', 'context', 'core', match[1].replace(/^ {12}/gm, ''));
  const triggers = ['workflow_dispatch', 'workflow_run'];

  for (const trigger of triggers) {
    for (const [name, runs, expected] of scenarios) {
      test(`${workflow}: ${trigger}: ${name}`, async () => {
        let failure;
        const outputs = {};
        const endpoint = () => {};
        const context = {
          repo: { owner: 'owner', repo: 'repo' },
          sha: trigger === 'workflow_run' ? 'newer-main-sha' : 'tested-sha',
          payload: trigger === 'workflow_run' ? { workflow_run: { head_sha: 'tested-sha' } } : {},
        };
        const github = {
          rest: {
            actions: { listWorkflowRuns: endpoint },
            repos: { getContent: async options => {
              assert.equal(options.ref, 'tested-sha');
              return { data: { content: Buffer.from('{"version":"0.2.0"}').toString('base64') } };
            } },
            git: { getRef: async options => {
              assert.equal(options.ref, 'tags/v0.2.0');
              return { data: { object: { type: 'commit', sha: 'tested-sha' } } };
            } },
          },
          paginate: async (actualEndpoint, options) => {
            assert.equal(actualEndpoint, endpoint);
            assert.equal(options.workflow_id, 'test.yml');
            assert.equal(options.head_sha, 'tested-sha');
            assert.equal(options.owner, 'owner');
            assert.equal(options.repo, 'repo');
            return runs;
          },
        };
        await gate(github, context, {
          setFailed: message => { failure = message; },
          setOutput: (key, value) => { outputs[key] = value; },
          info: () => {},
        });
        assert.equal(!failure, expected);
        assert.equal(outputs.sha, expected ? 'tested-sha' : undefined);
        if (workflow === 'release') assert.equal(outputs.tag, expected ? 'v0.2.0' : undefined);
      });
    }
  }
}

for (const workflow of ['build', 'release']) {
  const source = readFileSync(join(__dirname, `../.github/workflows/${workflow}.yml`), 'utf8');
  const condition = source.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1]
    .trim().slice(3, -2).trim();
  const route = new Function('github', 'contains', 'startsWith', 'fromJSON', `return (${condition});`);
  const cases = [
    ['regular commit', {}, workflow === 'build'],
    ['bump commit', { head_commit: { message: 'chore(release): bump version to 0.2.0' } }, workflow === 'release'],
    ['failed CI', { conclusion: 'failure' }, false],
    ['cancelled CI', { conclusion: 'cancelled' }, false],
    ['PR CI', { event: 'pull_request' }, false],
    ['fork CI', { head_repository: { full_name: 'fork/repo' } }, false],
  ];
  for (const [name, overrides, expected] of cases) {
    test(`${workflow}: routing: ${name}`, () => {
      const event = {
        conclusion: 'success', event: 'push', head_repository: { full_name: 'owner/repo' },
        head_commit: { message: 'fix: a regular commit' }, ...overrides,
      };
      assert.equal(route(
        { event_name: 'workflow_run', repository: 'owner/repo', event: { workflow_run: event } },
        (array, value) => array.includes(value), (value, prefix) => value.startsWith(prefix), JSON.parse,
      ), expected);
    });
  }
}

for (const [name, target, annotated, expected] of [
  ['lightweight tag', { type: 'commit', sha: 'tested-sha' }, null, true],
  ['annotated tag', { type: 'tag', sha: 'tag-object' }, { type: 'commit', sha: 'tested-sha' }, true],
  ['wrong commit', { type: 'commit', sha: 'other-sha' }, null, false],
  ['annotated wrong commit', { type: 'tag', sha: 'tag-object' }, { type: 'commit', sha: 'other-sha' }, false],
  ['non-commit tag', { type: 'tree', sha: 'tested-sha' }, null, false],
]) {
  test(`release: ${name}`, async () => {
    const source = readFileSync(join(__dirname, '../.github/workflows/release.yml'), 'utf8');
    const script = source.match(/          script: \|\n((?:            [^\n]*\n|\n)+)/)[1].replace(/^ {12}/gm, '');
    const gate = new AsyncFunction('github', 'context', 'core', script);
    let failure;
    const outputs = {};
    await gate({
      paginate: async () => [validRun],
      rest: {
        actions: { listWorkflowRuns() {} },
        repos: { getContent: async () => ({ data: { content: Buffer.from('{"version":"0.2.0"}').toString('base64') } }) },
        git: {
          getRef: async () => ({ data: { object: target } }),
          getTag: async options => {
            assert.equal(options.tag_sha, 'tag-object');
            return { data: { object: annotated } };
          },
        },
      },
    }, { repo: { owner: 'owner', repo: 'repo' }, sha: 'tested-sha', payload: {} }, {
      setFailed: message => { failure = message; },
      setOutput: (key, value) => { outputs[key] = value; },
      info() {},
    });
    assert.equal(!failure, expected);
    assert.equal(outputs.tag, expected ? 'v0.2.0' : undefined);
  });
}
