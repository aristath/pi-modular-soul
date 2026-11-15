import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Type } from 'typebox';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { bindSoul, readSelection, STATE_TYPE } from '../src/state.js';
import { fixture, open, request, output, call, section, document } from './helpers.js';

const toolResult = (seen, name) => seen.context.messages.findLast(message => message.role === 'toolResult' && message.toolName === name);
const text = message => message.content.map(item => item.text ?? '').join('');

test('live native tool loop loads, edits, discovers, replaces and unloads without persisting bodies', async t => {
  const f = fixture(t);
  const mutate = { name: 'synthetic_edit', label: 'Synthetic edit', description: 'Controlled fixture edit', parameters: Type.Object({}), async execute() {
    writeFileSync(f.first, section('core', 'SYNTHETIC_CORE_V2', true) + section('art', 'SYNTHETIC_ART_V2') + section('math', 'INACTIVE_EDIT') + section('new', 'SYNTHETIC_NEW', false, 'Fresh description') + section('extra', 'SYNTHETIC_ALWAYS_NEW', true));
    return { content: [{ type: 'text', text: 'Edited synthetic document' }] };
  } };
  const session = await open(t, f, { tools: [mutate] });
  const seen = await request(session, (input, turn) => {
    if (turn === 1) return output([call('get_soul_catalogue')]);
    if (turn === 2) return output([call('load_soul', { modules: ['art'] }, 'activate')]);
    if (turn === 3) return output([call('synthetic_edit')]);
    if (turn === 4) return output([call('get_soul_catalogue', {}, 'fresh')]);
    if (turn === 5) return output([call('load_soul', { modules: ['new'] }, 'replace')]);
    if (turn === 6) return output([call('load_soul', { modules: [] }, 'unload')]);
    return output();
  });
  assert.equal(seen.length, 7);
  assert.match(seen[0].prompt, /SYNTHETIC_CORE/); assert.doesNotMatch(seen[0].prompt, /SYNTHETIC_ART|SYNTHETIC_MATH/);
  assert.match(seen[2].prompt, /SYNTHETIC_ART/);
  assert.match(seen[3].prompt, /SYNTHETIC_ART_V2/); assert.match(seen[3].prompt, /SYNTHETIC_ALWAYS_NEW/);
  assert.equal(seen[3].prompt.includes('SYNTHETIC_CORE\n'), false); assert.doesNotMatch(seen[3].prompt, /INACTIVE_EDIT|SYNTHETIC_NEW\n/);
  assert.match(text(toolResult(seen[4], 'get_soul_catalogue')), /Fresh description/);
  assert.match(seen[5].prompt, /SYNTHETIC_NEW/); assert.doesNotMatch(seen[5].prompt, /SYNTHETIC_ART/);
  assert.doesNotMatch(seen[6].prompt, /SYNTHETIC_ART|SYNTHETIC_NEW\n/);
  assert.deepEqual(readSelection(session.sessionManager).modules, []);
  const stored = JSON.stringify(session.sessionManager.getEntries());
  assert.doesNotMatch(stored, /SYNTHETIC_CORE|SYNTHETIC_ART|SYNTHETIC_ALWAYS_NEW|INACTIVE_EDIT/);
  const entries = session.sessionManager.getBranch().filter(entry => entry.customType === STATE_TYPE);
  assert.ok(entries.length >= 4); assert.deepEqual(Object.keys(entries[0].data).sort(), ['modules', 'soul', 'version']);
});

test('unknown module requests are atomic; always modules are not optional flags', async t => {
  const f = fixture(t), session = await open(t, f);
  const seen = await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art', 'core', 'art'] }, 'yes')]) : turn === 2 ? output([call('load_soul', { modules: ['math', 'missing'] }, 'no')]) : output());
  const result = toolResult(seen[2], 'load_soul');
  assert.equal(result.isError, true); assert.equal(JSON.parse(text(result)).changed, false);
  assert.deepEqual(readSelection(session.sessionManager).modules, ['art']);
  assert.match(seen[2].prompt, /SYNTHETIC_ART/); assert.doesNotMatch(seen[2].prompt, /SYNTHETIC_MATH/);
});

test('read/parse failure preserves same-source identity, refuses stale catalogue, and recovers live', async t => {
  const f = fixture(t), session = await open(t, f);
  await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] })]) : output());
  writeFileSync(f.first, section('core', 'UNSAFE_NEW_CORE', true) + '---\nmodule: invalid\nalways_load: [\n---\nDO_NOT_EXPOSE');
  const failed = await request(session, (_input, turn) => turn === 1 ? output([call('get_soul_catalogue')]) : output());
  assert.match(failed[0].prompt, /SYNTHETIC_ART/); assert.doesNotMatch(failed[0].prompt, /DO_NOT_EXPOSE|UNSAFE_NEW_CORE/);
  assert.equal(toolResult(failed[1], 'get_soul_catalogue').isError, true);
  assert.deepEqual(readSelection(session.sessionManager).modules, ['art']);
  renameSync(f.first, f.first + '.temporarily-missing');
  const missing = await request(session); assert.match(missing[0].prompt, /SYNTHETIC_CORE/);
  writeFileSync(f.first, section('core', 'RECOVERED_CORE', true) + section('art', 'RECOVERED_ART'));
  const recovered = await request(session); assert.match(recovered[0].prompt, /RECOVERED_CORE/); assert.doesNotMatch(recovered[0].prompt, /SYNTHETIC_CORE/);
  writeFileSync(f.first, section('core', 'LATEST_CORE', true));
  const removed = await request(session); assert.doesNotMatch(removed[0].prompt, /RECOVERED_ART/); assert.deepEqual(readSelection(session.sessionManager).modules, ['art']);
  assert.ok(f.notices.length > 0);
});

test('default autoload, trusted per-user binding and resumed state never mix identities', async t => {
  const f = fixture(t), first = await open(t, f);
  await request(first, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] })]) : output());
  const manager = SessionManager.create(f.workspace, f.root + '/other-sessions'); bindSoul(manager, 'second');
  const second = await open(t, f, { manager });
  const seen = await request(second); assert.match(seen[0].prompt, /SYNTHETIC_OTHER_USER/); assert.doesNotMatch(seen[0].prompt, /SYNTHETIC_ART|SYNTHETIC_CORE/);
  f.settings.modularSoul.defaultSoul = 'second'; f.saveSettings();
  const resumed = await open(t, f, { manager: SessionManager.open(first.sessionManager.getSessionFile()) });
  const current = await request(resumed); assert.match(current[0].prompt, /SYNTHETIC_CORE/); assert.match(current[0].prompt, /SYNTHETIC_ART/);
  const fresh = await open(t, f); assert.match((await request(fresh))[0].prompt, /SYNTHETIC_OTHER_USER/);
  await first.prompt('/soul second');
  assert.deepEqual(readSelection(first.sessionManager), { version: 1, soul: 'second', modules: [] });
  assert.match((await request(first))[0].prompt, /SYNTHETIC_OTHER_USER/);
});

test('native branch navigation and fork use the active branch rather than unrelated selections', async t => {
  const f = fixture(t), session = await open(t, f);
  await request(session);
  const branchPoint = session.sessionManager.getLeafId();
  await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] })]) : output());
  assert.deepEqual(readSelection(session.sessionManager).modules, ['art']);
  const forkManager = SessionManager.open(session.sessionManager.getSessionFile());
  const selectedFork = forkManager.createBranchedSession(forkManager.getLeafId());
  const selected = await open(t, f, { manager: SessionManager.open(selectedFork) });
  assert.deepEqual(readSelection(selected.sessionManager).modules, ['art']);
  assert.match((await request(selected))[0].prompt, /SYNTHETIC_ART/);
  await session.navigateTree(branchPoint, { summarize: false });
  assert.deepEqual(readSelection(session.sessionManager).modules, []);
  assert.doesNotMatch((await request(session))[0].prompt, /SYNTHETIC_ART/);
  const file = session.sessionManager.createBranchedSession(session.sessionManager.getLeafId());
  const loaded = await open(t, f, { manager: SessionManager.open(file) });
  assert.deepEqual(readSelection(loaded.sessionManager).modules, []);
  assert.doesNotMatch((await request(loaded))[0].prompt, /SYNTHETIC_ART/);
});

test('real Pi compaction retains native flags and live SOUL without copying bodies to canonical history', async t => {
  const f = fixture(t), session = await open(t, f);
  await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] })]) : output('Fictional conversation. '.repeat(100)));
  await request(session, () => output('More fictional conversation. '.repeat(100)));
  session.agent.streamFunction = (await import('./helpers.js')).fakeStream(() => output('A synthetic compacted summary.'));
  await session.compact();
  assert.ok(session.sessionManager.getEntries().some(entry => entry.type === 'compaction'));
  assert.deepEqual(readSelection(session.sessionManager).modules, ['art']);
  writeFileSync(f.first, section('core', 'POST_COMPACTION_CORE', true) + section('art', 'POST_COMPACTION_ART'));
  const seen = await request(session); assert.match(seen[0].prompt, /POST_COMPACTION_ART/); assert.doesNotMatch(seen[0].prompt, /SYNTHETIC_ART/);
  assert.doesNotMatch(JSON.stringify(session.sessionManager.getEntries()), /POST_COMPACTION_CORE|SYNTHETIC_CORE/);
});

test('plain fallback reaches the actual model request unchanged and yields no catalogue modules', async t => {
  const f = fixture(t), plain = '\uFEFF---\r\ntitle: A fictional identity\r\n---\r\nPlain identity\r\n'; writeFileSync(f.first, plain);
  const session = await open(t, f);
  const seen = await request(session, (_input, turn) => turn === 1 ? output([call('get_soul_catalogue')]) : output());
  const own = seen[0].context.messages.find(message => message.role === 'system').sections.pi_modular_soul;
  assert.equal(own, plain); assert.deepEqual(JSON.parse(text(toolResult(seen[1], 'get_soul_catalogue'))).modules, []);
});

test('unloading preserves other extension sections, tools, and legitimate quotations', async t => {
  const f = fixture(t);
  const other = pi => { pi.on('before_agent_start', event => { event.systemPromptOptions.appendSystemPrompt += '\nOTHER_EXTENSION_GUIDANCE'; }); };
  const session = await open(t, f, { factories: [other] });
  const seen = await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] }, 'a')]) : turn === 2 ? output([call('load_soul', { modules: [] }, 'b')]) : output(), 'A legitimate quotation: SYNTHETIC_ART');
  assert.match(seen[2].prompt, /OTHER_EXTENSION_GUIDANCE/); assert.doesNotMatch(seen[2].prompt, /SYNTHETIC_ART/);
  assert.match(JSON.stringify(seen[2].context.messages.filter(message => message.role === 'user')), /SYNTHETIC_ART/);
  assert.ok(seen[2].context.messages.some(message => message.role === 'toolResult'));
});

test('forced prompts coexist with live modular identity across tool calls', async t => {
  const f = fixture(t);
  const force = pi => pi.on('before_agent_start', () => ({ systemPrompt: 'SYNTHETIC_FORCED_PROMPT' }));
  const session = await open(t, f, { factories: [force] });
  const seen = await request(session, (_input, turn) => turn === 1 ? output([call('load_soul', { modules: ['art'] })]) : turn === 2 ? output([call('load_soul', { modules: [] }, 'unload')]) : output());
  for (const input of seen) { assert.match(input.prompt, /SYNTHETIC_FORCED_PROMPT/); assert.match(input.prompt, /SYNTHETIC_CORE/); }
  assert.match(seen[1].prompt, /SYNTHETIC_ART/); assert.doesNotMatch(seen[2].prompt, /SYNTHETIC_ART/);
});

test('fresh missing identity never falls back to another profile, and repaired file loads automatically', async t => {
  const f = fixture(t); renameSync(f.first, f.first + '.away');
  const session = await open(t, f);
  const seen = await request(session); assert.doesNotMatch(seen[0].prompt, /SYNTHETIC_OTHER_USER|SYNTHETIC_CORE/);
  writeFileSync(f.first, document()); assert.match((await request(session))[0].prompt, /SYNTHETIC_CORE/);
  assert.equal(readSelection(session.sessionManager).soul, 'first');
});
