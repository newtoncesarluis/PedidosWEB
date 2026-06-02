const fs = require('fs');
const files = [
  'public/pages/contas-pagar.html',
  'public/pages/contas-receber.html',
];

const onclickFns = new Set();
const definedFns = new Set();

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const scripts = [...s.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((t) => !/src\s*=/.test(t));

  scripts.forEach((code, i) => {
    try {
      new Function(code);
      console.log(`${f} script#${i + 1}: OK`);
    } catch (e) {
      console.log(`${f} script#${i + 1}: FAIL - ${e.message}`);
    }
    const fnDefs = code.matchAll(/(?:async\s+)?function\s+(\w+)/g);
    for (const m of fnDefs) definedFns.add(m[1]);
  });

  [...s.matchAll(/onclick="([^"]+)"/g)].forEach((m) => {
    const calls = m[1].match(/\b([a-zA-Z_][\w]*)\s*\(/g) || [];
    calls.forEach((c) => onclickFns.add(c.replace(/\s*\($/, '')));
  });
}

const htmlOnly = [...onclickFns].filter((fn) => !definedFns.has(fn) && !['event', 'alert', 'confirm', 'parseInt', 'parseFloat', 'JSON'].includes(fn));
if (htmlOnly.length) {
  console.log('\nPossíveis onclick sem function no mesmo arquivo:');
  htmlOnly.sort().forEach((fn) => console.log('  -', fn));
} else {
  console.log('\nTodos os onclick referenciam funções definidas no script.');
}
