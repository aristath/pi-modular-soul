import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSoul, composeSoul, catalogue } from '../src/document.js';
import { section } from './helpers.js';

test('plain fallback preserves ordinary frontmatter, BOM, separators and newline bytes', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const text = '\uFEFF' + ['---', 'title: A synthetic plain document', '---', '', 'Body', '---', 'More prose', ''].join(newline);
    const doc = parseSoul(text);
    assert.equal(doc.format, 'plain'); assert.equal(composeSoul(doc, []).text, text); assert.deepEqual(catalogue(doc), []);
  }
  assert.equal(composeSoul(parseSoul(''), []).text, '');
});
test('optional bodies are verbatim, ordered, excluded until selected; preamble is retained', () => {
  const text = 'Preamble\n' + section('core', 'Core', true) + section('a', 'Alpha\n---\nordinary rule') + section('b', 'Beta');
  const doc = parseSoul(text);
  assert.deepEqual(catalogue(doc), [{ module: 'a', description: 'Use a' }, { module: 'b', description: 'Use b' }]);
  assert.equal(composeSoul(doc, []).text, 'Preamble\nCore\n');
  assert.equal(composeSoul(doc, ['b', 'a', 'a']).text, 'Preamble\nCore\nAlpha\n---\nordinary rule\nBeta\n');
  assert.deepEqual(composeSoul(doc, ['core', 'absent']).unavailable, ['absent']);
  for (const newline of ['\n', '\r\n', '\r']) {
    const parsed = parseSoul(text.replaceAll('\n', newline));
    assert.equal(composeSoul(parsed, ['a']).text, 'Preamble\nCore\nAlpha\n---\nordinary rule\n'.replaceAll('\n', newline));
  }
});
test('fenced section examples never create module boundaries', () => {
  for (const fence of ['```markdown', '~~~~markdown']) {
    const close = fence.startsWith('`') ? '````' : '~~~~';
    const body = `Keep this literal\n${fence}\n${section('literal', 'Literal body', true)}${close}\nAfter example`;
    const doc = parseSoul(section('core', 'Core', true) + section('a', body));
    assert.deepEqual(catalogue(doc).map(item => item.module), ['a']);
    assert.equal(composeSoul(doc, ['a']).text, `Core\n${body}\n`);
    assert.equal(composeSoul(doc, []).text, 'Core\n');
  }
});
test('invalid module headers fail safely rather than falling back or disclosing source', () => {
  const invalid = ['---\nmodule: a\n', '---\nmodule a\n---\n', '---\nmodule: [\n---\n', '---\nmodule: null\n---\n', '---\nmodule: a\nalways_load: maybe\n---\n', '---\nmodule: a\ndescription: 42\n---\n', section('a', 'one') + section('a', 'two')];
  for (const prefix of ['', section('core', 'Core', true)]) for (const text of invalid) {
    assert.throws(() => parseSoul(prefix + text + 'SYNTHETIC_SECRET_BODY'), error => !error.message.includes('SYNTHETIC_SECRET_BODY') && /SOUL metadata/.test(error.message));
  }
});
test('normal YAML frontmatter is retained, boolean strings normalize and IDs trim', () => {
  const front = '---\nlayout: simple\noptions:\n  module: illustration\n---\n';
  const doc = parseSoul(front + '---\nmodule: " core "\nalways_load: "true"\n---\nCore\n' + section('optional', 'Body'));
  assert.equal(composeSoul(doc, []).text, front + 'Core\n');
  assert.deepEqual(catalogue(doc).map(item => item.module), ['optional']);
});
