const fs = require('fs');
const p = 'c:/xampp/htdocs/SysRepWeb/routes/cadastros.js';
let s = fs.readFileSync(p, 'utf8');
if (s.includes("plano-contas-modelo")) {
  console.log('already');
  process.exit(0);
}
const needle = "} = require('../config/plano-contas-schema');\n";
const add = "} = require('../config/plano-contas-schema');\nconst { seedPlanoContasModelo } = require('../config/plano-contas-modelo');\n";
if (!s.includes(needle)) {
  console.log('needle miss');
  process.exit(1);
}
s = s.replace(needle, add);
fs.writeFileSync(p, s);
console.log('ok');
