import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export function configFrom(settings, cwd) {
  const config = settings.modularSoul ?? {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('modularSoul must be an object');
  const souls = config.souls ?? {};
  if (!souls || typeof souls !== 'object' || Array.isArray(souls)) throw new Error('modularSoul.souls must map names to document paths');
  const documents = new Map();
  for (const [id, path] of Object.entries(souls)) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('Each configured SOUL needs a nonempty path');
    documents.set(id, path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(cwd, path));
  }
  if (config.defaultSoul !== undefined && (typeof config.defaultSoul !== 'string' || !config.defaultSoul.trim())) throw new Error('modularSoul.defaultSoul must name a configured SOUL');
  return { documents, defaultSoul: config.defaultSoul?.trim() };
}
