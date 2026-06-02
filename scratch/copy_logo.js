const fs = require('fs');
const src = 'C:/Users/nilton.cesar/.gemini/antigravity/brain/a8e54b5b-e8ae-4937-bc58-5b6bba4c4d65/media__1778451419432.png';
const dst = 'c:/xampp/htdocs/SysRepWeb/public/assets/logo-pedidosweb.png';
fs.copyFileSync(src, dst);
console.log('Logo copiado com sucesso! Tamanho:', fs.statSync(dst).size, 'bytes');
