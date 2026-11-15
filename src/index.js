import { Type } from 'typebox';
import { fileURLToPath } from 'node:url';
import { configFrom } from './config.js';
import { readSoul, catalogue, composeSoul } from './document.js';
import { STATE_TYPE, selection, readSelection, normalizeModules } from './state.js';
import { projectSoul } from './context.js';

export { STATE_TYPE, bindSoul, readSelection, selection } from './state.js';
const readme = fileURLToPath(new URL('../README.md', import.meta.url));
const guide = `Your SOUL may have optional modules. Call get_soul_catalogue to read the current module identifiers and descriptions, then load_soul({modules:[...]}) to set the COMPLETE optional selection. Omitted modules unload; [] keeps always-loaded content only. Read the catalogue again when needed: documents can change live. To author sections, read ${readme}.`;
const result = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], details: data, ...(isError ? { isError: true } : {}) });

export default function modularSoul(pi) {
  const snapshots = new Map();
  let runOptions, forced, forceCaptured = false, warning;
  const config = ctx => configFrom(pi.getSettings(), ctx.cwd);
  function report(ctx, message) {
    if (warning === message) return;
    warning = message;
    ctx.ui.notify(`Modular SOUL: ${message}`, 'warning');
  }
  function binding(ctx) {
    const current = readSelection(ctx.sessionManager);
    if (current) return current;
    const initial = pi.getFlag('soul') ?? config(ctx).defaultSoul;
    if (!initial) return undefined;
    const state = selection(initial);
    pi.appendEntry(STATE_TYPE, state);
    return state;
  }
  function source(ctx, state) {
    const path = config(ctx).documents.get(state.soul);
    if (!path) throw new Error('The selected SOUL is not configured; select a configured document with /soul');
    return path;
  }
  async function live(ctx, state) {
    const path = source(ctx, state);
    let document;
    try { document = await readSoul(path); }
    catch (error) {
      // Never put document contents or source snippets into diagnostics.
      if (error.code) throw new Error(`Cannot read the selected SOUL (${error.code}); the previous identity and selection are retained`);
      throw error;
    }
    snapshots.set(`${state.soul}\0${path}`, document);
    return { path, document, ...composeSoul(document, state.modules) };
  }
  async function context(ctx) {
    let state, path;
    try {
      state = binding(ctx);
      if (!state) return { text: '', guidance: `${guide}\nNo SOUL is selected. Configure modularSoul or select one with /soul.` };
      path = source(ctx, state);
      const current = await live(ctx, state);
      warning = undefined;
      if (current.unavailable.length) report(ctx, `Some selected modules no longer exist: ${current.unavailable.join(', ')}. Their old content is not loaded.`);
      return { text: current.text, guidance: guide };
    } catch (error) {
      report(ctx, error.message);
      const previous = state && path && snapshots.get(`${state.soul}\0${path}`);
      return { text: previous ? composeSoul(previous, state.modules).text : '', guidance: `${guide}\nThe selected SOUL is temporarily unavailable. ${previous ? 'The last readable identity is retained for this request.' : 'No other user’s SOUL has been substituted.'}` };
    }
  }

  pi.registerFlag('soul', { description: 'Initial named SOUL for a session without a saved selection', type: 'string' });
  pi.on('session_start', (_event, ctx) => {
    snapshots.clear(); warning = undefined;
    try { binding(ctx); } catch (error) { report(ctx, error.message); }
  });
  pi.on('before_agent_start', event => { runOptions = event.systemPromptOptions; forced = undefined; forceCaptured = false; });
  pi.on('agent_start', () => {
    if (forceCaptured || !runOptions) return;
    // All before_agent_start handlers have now run, including handlers loaded
    // after this package. Convert only the request projection; canonical prompt
    // sections remain Pi's. Future tool-loop copies cannot force away live SOUL.
    forced = runOptions.forceSystemPrompt;
    runOptions.forceSystemPrompt = undefined;
    forceCaptured = true;
  });
  pi.on('context_with_system', async (event, ctx) => {
    const current = await context(ctx);
    return { messages: projectSoul(event.messages, current.text, current.guidance, forced) };
  });

  pi.registerTool({
    name: 'get_soul_catalogue', label: 'SOUL catalogue', executionMode: 'sequential',
    description: `Read the selected SOUL file NOW for current optional module identifiers/descriptions, without loading their bodies. Always-loaded modules are omitted. Call again after document edits. Authoring instructions: ${readme}`,
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _args, _signal, _update, ctx) {
      try {
        const state = binding(ctx);
        if (!state) return result({ soul: null, modules: [], message: 'No SOUL selected. Use trusted configuration or /soul.' });
        const current = await live(ctx, state);
        return result({ soul: state.soul, path: current.path, format: current.document.format, modules: catalogue(current.document) });
      } catch (error) { return result({ error: error.message, catalogueAvailable: false }, true); }
    },
  });
  pi.registerTool({
    name: 'load_soul', label: 'Load SOUL modules', executionMode: 'sequential',
    description: `Set the COMPLETE optional-module selection for this chat. Omitted modules unload; [] keeps always-loaded content. Call get_soul_catalogue for live identifiers. This tool does not choose another user's SOUL. Authoring instructions: ${readme}`,
    parameters: Type.Object({ modules: Type.Array(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
    async execute(_id, args, _signal, _update, ctx) {
      try {
        const state = binding(ctx);
        if (!state) return result({ error: 'No SOUL selected; configure a default or use /soul', changed: false }, true);
        const requested = normalizeModules(args.modules);
        const current = await live(ctx, state);
        const next = composeSoul(current.document, requested);
        if (next.unavailable.length) return result({ soul: state.soul, modules: current.modules, always_loaded: current.alwaysLoaded, unavailable: next.unavailable, changed: false }, true);
        const saved = selection(state.soul, next.modules);
        pi.appendEntry(STATE_TYPE, saved);
        return result({ soul: saved.soul, modules: next.modules, always_loaded: next.alwaysLoaded, unavailable: [], changed: true });
      } catch (error) { return result({ error: error.message, changed: false }, true); }
    },
  });
  pi.registerCommand('soul', {
    description: 'Show current SOUL/modules, list configured documents, or select a named SOUL: /soul [list|NAME]',
    async handler(args, ctx) {
      try {
        const name = args.trim();
        if (name === 'list') { ctx.ui.notify([...config(ctx).documents.keys()].join('\n') || 'No SOUL documents configured', 'info'); return; }
        if (name) {
          const next = selection(name);
          await live(ctx, next);
          pi.appendEntry(STATE_TYPE, next);
        }
        const state = binding(ctx);
        if (!state) { ctx.ui.notify('No SOUL selected', 'info'); return; }
        const current = await live(ctx, state);
        ctx.ui.notify(JSON.stringify({ soul: state.soul, modules: current.modules, always_loaded: current.alwaysLoaded, unavailable: current.unavailable }), 'info');
      } catch (error) { report(ctx, error.message); }
    },
  });
}
