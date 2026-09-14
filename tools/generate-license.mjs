import fs from 'node:fs';
import crypto from 'node:crypto';

const [, , machineArg, expiresArg, licenseId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)] = process.argv;
if (!machineArg || !expiresArg) {
  console.error('用法: node generate-license.mjs <机器码> <到期日期或 ISO 时间> [授权编号]');
  process.exit(1);
}
const normalized = machineArg.replaceAll('-', '').trim().toUpperCase();
if (!/^[0-9A-F]{32}$/.test(normalized)) throw new Error('机器码格式不正确，应为插件复制的 32 位十六进制机器码。');
const cleanExpiresArg = String(expiresArg).trim().replace(/^['"]|['"]$/g, '');
const expiresAt = Date.parse(cleanExpiresArg);
const now = Date.now();
if (!Number.isFinite(expiresAt)) throw new Error(`到期时间无法解析：${cleanExpiresArg}。请使用 2099-09-01T22:06:05+08:00 格式。`);
if (expiresAt <= now) throw new Error(`到期时间已经过去：${new Date(expiresAt).toLocaleString('zh-CN')}；当前时间为：${new Date(now).toLocaleString('zh-CN')}。请检查电脑系统时间或填写未来日期。`);
const machineId = `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`.toLowerCase();
const payload = JSON.stringify({ product: '商品生图助手', machineId, issuedAt: Date.now(), expiresAt, licenseId });
const payloadPart = Buffer.from(payload).toString('base64url');
// 私钥放在扩展目录之外，避免 Edge 将整个目录识别为包含机密文件的扩展。
// 可通过 LICENSE_PRIVATE_KEY_PATH 显式指定；默认读取授权管理目录。
const configuredKeyPath = process.env.LICENSE_PRIVATE_KEY_PATH;
const defaultKeyPath = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}/商品生图助手授权管理/license-private-key.pem`
  : null;
const keyPath = configuredKeyPath || defaultKeyPath;
if (!keyPath || !fs.existsSync(keyPath)) {
  throw new Error(`未找到授权私钥：${keyPath || '请设置 LICENSE_PRIVATE_KEY_PATH'}`);
}
const signer = crypto.createSign('SHA256');
signer.update(payloadPart); signer.end();
const signature = signer.sign({ key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url');
console.log(`${payloadPart}.${signature}`);
console.error(`授权编号：${licenseId}`);
console.error(`机器码：${machineId}`);
console.error(`当前时间：${new Date(now).toLocaleString('zh-CN')}`);
console.error(`到期时间：${new Date(expiresAt).toLocaleString('zh-CN')}`);
