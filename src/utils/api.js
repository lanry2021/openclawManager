const https = require('https');
const http = require('http');

const BASE_URL = 'http://ulin.cc.cd';

/**
 * 调用授权验证接口
 * @param {string} mac - 机器 MAC 地址
 * @returns {Promise<object>} 接口返回的 JSON 对象
 */
function checkAuthorization(mac) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/api/mac/check?mac=${encodeURIComponent(mac)}`;
    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('接口返回数据格式错误'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时，请检查网络连接'));
    });
  });
}


/**
 * 按 MAC 地址查询 API Key
 * @param {string} mac - 机器 MAC 地址
 * @returns {Promise<object>} { ok, mac, apikey }
 */
function fetchApiKey(mac) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/api/mac/apikey?mac=${encodeURIComponent(mac)}`;
    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('接口返回数据格式错误'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时，请检查网络连接'));
    });
  });
}

module.exports = { checkAuthorization, fetchApiKey };

