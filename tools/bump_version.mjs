// Troca a versao (?v=) de todos os arquivos do app de uma vez.
//
// O navegador guarda os .js/.css em cache. Para ele baixar a versao nova depois de
// uma mudanca, cada referencia leva ?v=CARIMBO. Este comando poe o MESMO carimbo em
// todas as referencias locais (imports dos modulos e <script>/<link> dos .html):
// assim nenhum arquivo fica velho e nenhum modulo e carregado duas vezes.
//
// Uso (na raiz do projeto):
//   node tools/bump_version.mjs           grava um carimbo novo (data e hora)
//   node tools/bump_version.mjs --check   so confere; sai com erro se algo estiver fora
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_FILES = ['index.html', 'agenda_publica.html'];

// import x from './a.js' | export ... from './a.js' | import './a.js' | import('./a.js')
const JS_REF = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.m?js)(\?[^'"]*)?\2/g;
// <script src="js/main.js"> | <link href="css/style.css">
const HTML_REF = /(\b(?:src|href)=)(["'])((?:js|css)\/[^"'?]+\.(?:m?js|css))(\?[^"']*)?\2/g;

export function listFiles(root = ROOT) {
  const jsDir = path.join(root, 'js');
  const js = fs.readdirSync(jsDir)
    .filter((name) => /\.m?js$/.test(name))
    .map((name) => ({ file: path.join(jsDir, name), pattern: JS_REF }));
  const html = HTML_FILES
    .map((name) => path.join(root, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, pattern: HTML_REF }));
  return [...js, ...html];
}

// Lista cada referencia local: arquivo, alvo e a versao atual (ou null se nao tiver).
export function scanReferences(root = ROOT) {
  const refs = [];
  for (const { file, pattern } of listFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      const version = /^\?v=([^&]+)$/.exec(m[4] || '');
      refs.push({ file: path.relative(root, file), target: m[3], query: m[4] || '', version: version ? version[1] : null });
    }
  }
  return refs;
}

// Problemas: referencia sem ?v=, ou com versoes diferentes entre si.
export function findProblems(refs) {
  const problems = refs
    .filter((r) => !r.version)
    .map((r) => `${r.file}: ${r.target}${r.query} sem ?v=`);
  const versions = [...new Set(refs.filter((r) => r.version).map((r) => r.version))];
  if (versions.length > 1) {
    const count = (v) => refs.filter((r) => r.version === v).length;
    problems.push(`versoes diferentes: ${versions.map((v) => `${v} (${count(v)}x)`).join(', ')}`);
  }
  return problems;
}

export function newStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`;
}

export function applyStamp(stamp, root = ROOT) {
  let changedFiles = 0;
  for (const { file, pattern } of listFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(pattern, (_, prefix, quote, target) => `${prefix}${quote}${target}?v=${stamp}${quote}`);
    if (next !== text) {
      fs.writeFileSync(file, next, 'utf8');
      changedFiles += 1;
    }
  }
  return changedFiles;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) {
    const refs = scanReferences();
    const problems = findProblems(refs);
    if (problems.length) {
      console.log(`Versoes fora do padrao (${problems.length}):`);
      problems.forEach((p) => console.log(`  - ${p}`));
      console.log('Corrija com: node tools/bump_version.mjs');
      process.exit(1);
    }
    console.log(`OK: ${refs.length} referencias com a versao ${refs[0]?.version || '-'}.`);
  } else {
    const stamp = newStamp();
    const changed = applyStamp(stamp);
    const problems = findProblems(scanReferences());
    console.log(`Versao ${stamp} gravada em ${changed} arquivo(s).`);
    if (problems.length) {
      problems.forEach((p) => console.log(`  - ${p}`));
      process.exit(1);
    }
  }
}
