import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSession, SessionManager, DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt } from '@earendil-works/pi-ai';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const section = (id, body, always = false, description = `Use ${id}`) => `---\nmodule: ${id}\ndescription: ${description}\nalways_load: ${always}\n---\n${body}\n`;
export const document = () => section('core', 'SYNTHETIC_CORE', true) + section('art', 'SYNTHETIC_ART') + section('math', 'SYNTHETIC_MATH');
export const call = (name, args = {}, id = name) => ({ type: 'toolCall', id, name, arguments: args });
export function output(content = 'Synthetic reply') {
  return { role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
    api: 'openai-completions', provider: 'synthetic', model: 'default', timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: Array.isArray(content) && content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop' };
}
export function fakeStream(handler) {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const message = { ...await handler({ model, context, options, prompt: getCurrentSystemPrompt(context.messages) }), api: model.api, model: model.id, provider: model.provider };
        stream.push({ type: 'done', reason: message.stopReason, message }); stream.end(message);
      } catch (error) {
        const message = { ...output(''), stopReason: 'error', errorMessage: error.message };
        stream.push({ type: 'error', reason: 'error', error: message }); stream.end(message);
      }
    })();
    return stream;
  };
}
export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pms-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, 'agent'), workspace = join(root, 'workspace');
  mkdirSync(agentDir); mkdirSync(workspace);
  const first = join(root, 'first.md'), second = join(root, 'second.md');
  writeFileSync(first, document()); writeFileSync(second, section('core', 'SYNTHETIC_OTHER_USER', true) + section('notes', 'SYNTHETIC_OTHER_NOTES'));
  const settings = { defaultProvider: 'synthetic', defaultModel: 'default', cacheWarming: 'off', retry: { enabled: false },
    compaction: { enabled: false, keepRecentTokens: 64, reserveTokens: 128 }, skills: ['!**'],
    modularSoul: { defaultSoul: 'first', souls: { first, second } } };
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { synthetic: { api: 'openai-completions', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-fixture-value',
    models: [{ id: 'default', name: 'Synthetic', reasoning: false, input: ['text'], contextWindow: 262144, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const notices = [];
  return { root, first, second, agentDir, workspace, settings, notices,
    saveSettings() { writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings)); } };
}
export async function open(t, f, options = {}) {
  const settingsManager = SettingsManager.create(f.workspace, f.agentDir);
  const loader = new DefaultResourceLoader({ cwd: f.workspace, agentDir: f.agentDir, settingsManager,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: options.registered ? [] : [join(packageRoot, 'src/index.js')], extensionFactories: options.factories ?? [] });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
  const manager = options.manager ?? SessionManager.create(f.workspace, join(f.root, 'sessions'));
  const { session } = await createAgentSession({ cwd: f.workspace, agentDir: f.agentDir, settingsManager, resourceLoader: loader, sessionManager: manager, customTools: options.tools ?? [] });
  await session.bindExtensions({ mode: options.mode ?? 'rpc', uiContext: { notify: (text, type) => f.notices.push({ text, type }) }, onError: error => { throw new Error(error.error); } });
  session.agent.streamFunction = fakeStream(() => output());
  t.after(async () => { await session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); });
  return session;
}
export async function request(session, handler = () => output(), text = 'Synthetic question') {
  const seen = [];
  session.agent.streamFunction = fakeStream(async input => { seen.push(input); return handler(input, seen.length); });
  await session.prompt(text);
  if (session.agent.state.messages.at(-1)?.stopReason === 'error') throw new Error(session.agent.state.messages.at(-1).errorMessage);
  return seen;
}
