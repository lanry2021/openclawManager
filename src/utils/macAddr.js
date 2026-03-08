const os = require('os');

/**
 * 获取本机第一块活跃网卡的 MAC 地址（小写，去空格）
 */
function getMacAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过 loopback 和无 MAC 的虚拟接口
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac.toLowerCase().replace(/\s/g, '');
      }
    }
  }
  return null;
}

module.exports = { getMacAddress };
