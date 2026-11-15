export const STATE_TYPE = 'pi-modular-soul:selection';
export function normalizeModules(modules) {
  if (!Array.isArray(modules) || modules.some(value => typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value))) throw new Error('modules must be an array of nonempty identifiers');
  return [...new Set(modules.map(value => value.trim()))];
}
export function selection(soul, modules = []) {
  if (typeof soul !== 'string' || !soul.trim() || /[\r\n\0]/.test(soul)) throw new Error('SOUL identifier must be nonempty text');
  return { version: 1, soul: soul.trim(), modules: normalizeModules(modules) };
}
export function readSelection(manager) {
  const entry = manager.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === STATE_TYPE);
  if (!entry) return undefined;
  if (entry.data?.version !== 1) throw new Error('The active branch has an unsupported SOUL selection record');
  return selection(entry.data.soul, entry.data.modules);
}
/** Trusted SDK host binding, before creating/binding the AgentSession. */
export function bindSoul(manager, soul, modules = []) {
  const state = selection(soul, modules);
  manager.appendCustomEntry(STATE_TYPE, state);
  return state;
}
