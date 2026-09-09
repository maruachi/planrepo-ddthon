#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const context = JSON.parse(input);
  if (context.sr.title === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); return; }
  if (context.sr.title === 'overflow') { process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000); return; }
  if (context.sr.title === 'fail') { process.stderr.write('SECRET MUST NEVER LEAK'); process.exitCode = 1; return; }
  const args = process.argv.slice(2);
  const flag = name => args[args.indexOf(name) + 1];
  if (flag('--tools') !== '' || flag('--setting-sources') !== 'user' || !args.includes('--strict-mcp-config') || !args.includes('--disable-slash-commands') || !args.includes('--no-session-persistence') || !JSON.parse(flag('--settings')).disableAllHooks) process.exit(2);
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { artifacts: [{ logicalKey: 'requirements', title: '계획', body: context.sr.description }], questions: [], summary: process.cwd() } }));
});
