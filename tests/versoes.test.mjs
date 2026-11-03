import test from 'node:test';
import assert from 'node:assert/strict';
import { scanReferences, findProblems } from '../tools/bump_version.mjs';

test('todos os .js/.css do app usam a mesma versao (?v=)', () => {
  const refs = scanReferences();
  assert.ok(refs.length > 50, `poucas referencias encontradas: ${refs.length}`);
  const problems = findProblems(refs);
  assert.deepEqual(problems, [], `Rode: node tools/bump_version.mjs\n${problems.join('\n')}`);
});
