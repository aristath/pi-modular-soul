import { readFile } from 'node:fs/promises';
import { parseDocument as parseYaml } from 'yaml';

export class SoulFormatError extends Error {}
const delimiter = line => /^\uFEFF? {0,3}---[ \t]*$/.test(line);
const keyLine = line => /^\s*(?:[\w-]+|"[^"]+"|'[^']+')\s*:/.test(line);
const moduleKey = line => /^\s*(?:module|"module"|'module')\s*:/.test(line);
const brokenModuleKey = line => /^\s*module(?:\s+[^:#]|\s*$)/.test(line);
const fenceStart = line => /^ {0,3}(`{3,}|~{3,})/.exec(line);
const metadataError = (line, problem) => new SoulFormatError(`SOUL metadata at line ${line}: ${problem}.`);

/** Parse boundaries while keeping original body bytes/newlines in string slices. */
export function parseSoul(text) {
  if (typeof text !== 'string') throw new TypeError('SOUL content must be text');
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ text: match[0].replace(/[\r\n]+$/, ''), start: match.index, end: match.index + match[0].length }));
  const sections = [];
  const names = new Set();
  let fence, preamble = '', bodyStart = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = fenceStart(line.text);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.text.slice(marker[0].length))) fence = undefined;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (!delimiter(line.text)) continue;
    let first = index + 1;
    while (first < lines.length && /^\s*(?:#.*)?$/.test(lines[first].text)) first++;
    if (first >= lines.length) continue;
    if (brokenModuleKey(lines[first].text)) throw metadataError(index + 1, 'module header requires module: identifier');
    if (!keyLine(lines[first].text)) continue;
    let end = index + 1;
    while (end < lines.length && !delimiter(lines[end].text)) end++;
    const headerLines = lines.slice(index + 1, end);
    const intent = headerLines.some(row => moduleKey(row.text));
    if (!intent) continue;
    if (end === lines.length) throw metadataError(index + 1, 'module header has no closing ---');
    const document = parseYaml(headerLines.map(row => row.text).join('\n'), { uniqueKeys: true, prettyErrors: false });
    if (document.errors.length) throw metadataError(index + 1, 'invalid YAML');
    let header;
    try { header = document.toJS({ maxAliasCount: 100 }); }
    catch { throw metadataError(index + 1, 'invalid YAML aliases'); }
    if (!header || typeof header !== 'object' || !Object.hasOwn(header, 'module')) continue;
    if (typeof header.module !== 'string' || !header.module.trim() || /[\r\n\0]/.test(header.module)) throw metadataError(index + 1, 'module must be a nonempty single-line identifier');
    const id = header.module.trim();
    if (names.has(id)) throw metadataError(index + 1, 'duplicate module identifier');
    if (header.description != null && typeof header.description !== 'string') throw metadataError(index + 1, 'description must be text');
    let always = header.always_load ?? false;
    if (typeof always === 'string' && /^(true|false)$/i.test(always.trim())) always = always.trim().toLowerCase() === 'true';
    if (typeof always !== 'boolean') throw metadataError(index + 1, 'always_load must be true or false');
    if (sections.length) sections.at(-1).body = text.slice(bodyStart, line.start);
    else preamble = text.slice(0, line.start);
    sections.push({ id, description: header.description ?? '', always, body: '' });
    names.add(id); bodyStart = lines[end].end; index = end;
  }
  if (!sections.length) return { format: 'plain', preamble: '', sections: [], text };
  sections.at(-1).body = text.slice(bodyStart);
  return { format: 'modular', preamble, sections };
}

export async function readSoul(path) { return parseSoul(await readFile(path, 'utf8')); }
export function catalogue(document) {
  return document.sections.filter(section => !section.always).map(section => ({ module: section.id, description: section.description }));
}
export function composeSoul(document, selection) {
  if (document.format === 'plain') return { text: document.text, modules: [], alwaysLoaded: [], unavailable: [...selection] };
  const selected = new Set(selection);
  const known = new Set(document.sections.map(section => section.id));
  const active = document.sections.filter(section => section.always || selected.has(section.id));
  return {
    text: document.preamble + active.map(section => section.body).join(''),
    modules: active.filter(section => !section.always).map(section => section.id),
    alwaysLoaded: active.filter(section => section.always).map(section => section.id),
    unavailable: selection.filter(id => !known.has(id)),
  };
}
