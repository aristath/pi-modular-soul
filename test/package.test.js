import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, open, request, packageRoot } from './helpers.js';

test('packed artifact installs cleanly and loads through normal Pi registration', async t => {
  const f = fixture(t), consumer = join(f.root, 'consumer'); mkdirSync(consumer);
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', f.root], { cwd: packageRoot, encoding: 'utf8' }));
  const artifact = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  const paths = artifact.files.map(file => file.path);
  for (const name of ['README.md', 'LICENSE', 'src/index.js', 'examples/SOUL.md']) assert.ok(paths.includes(name));
  assert.ok(paths.every(path => /^(?:src\/|examples\/|README\.md$|LICENSE$|package\.json$)/.test(path)));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@earendil-works/pi-coding-agent': '1.5.2', '@earendil-works/pi-ai': '1.5.2', typebox: '1.3.27' } }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumer, join(f.root, artifact.filename)], { encoding: 'utf8', timeout: 90000, stdio: 'pipe' });
  const installed = join(consumer, 'node_modules', 'pi-modular-soul');
  assert.ok(readFileSync(join(installed, 'README.md'), 'utf8').includes('Author a document'));
  execFileSync(process.execPath, [join(packageRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), 'install', installed], { cwd: f.workspace, env: { ...process.env, PI_CODING_AGENT_DIR: f.agentDir }, encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  const settings = JSON.parse(readFileSync(join(f.agentDir, 'settings.json'), 'utf8'));
  assert.ok(settings.packages.some(source => resolve(f.agentDir, source) === installed));
  const session = await open(t, f, { registered: true });
  assert.ok(session.getActiveToolNames().includes('load_soul'));
  assert.match((await request(session))[0].prompt, /SYNTHETIC_CORE/);
});
