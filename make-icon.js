const pngToIco = require('png-to-ico');
const fs = require('fs');
const path = require('path');

pngToIco(path.join(__dirname, 'assets/icon.png'))
  .then(buf => {
    fs.writeFileSync(path.join(__dirname, 'assets/icon.ico'), buf);
    console.log('✓ icon.ico 已成功生成（真正的 ICO 格式）');
  })
  .catch(err => {
    console.error('图标转换失败:', err.message);
  });
