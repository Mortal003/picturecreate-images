(() => {
  const PRODUCT = "商品生图助手";
  const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiiTO1zR3Axr5HmuqdEzok9S0jZat
mBSAeaJ+TlVmjS0d8SPVycrJ3wayG2mUWOe1s3hLdMbxjAFALU0IDrYz7g==
-----END PUBLIC KEY-----`;
  let state = { valid: false, reason: "未激活" };
  function ensureUi() {
    if (document.getElementById("license-gate")) return;
    const gate = document.createElement("section");
    gate.id = "license-gate"; gate.className = "license-gate";
    gate.innerHTML = '<div class="license-card"><p class="eyebrow">PRODUCT LICENSE</p><h1>商品生图助手</h1><p class="license-subtitle">首次使用需要完成授权激活</p><label>本机机器码<div class="machine-row"><code id="machine-code">生成中...</code><button id="copy-machine" type="button" class="mini-button">复制</button></div></label><label>激活码<textarea id="license-input" rows="3" placeholder="粘贴你收到的激活码"></textarea></label><button id="activate-license" type="button" class="primary">激活插件</button><p id="license-message" class="license-message">请联系授权人员获取激活码。</p><small>授权按浏览器安装绑定，换浏览器或清除扩展数据后需要重新授权。</small></div>';
    document.body.prepend(gate);
    const style = document.createElement("style");
    style.textContent = '.license-gate{min-height:100vh;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:#f4f7f4;color:#1d252c}.license-gate[hidden]{display:none!important}.license-card{width:min(430px,100%);background:#fff;border:1px solid #dce3dd;border-radius:10px;padding:24px;box-shadow:0 12px 34px #193b2614}.license-card h1{margin:6px 0 4px;font-size:24px}.license-subtitle{color:#68756e;font-size:13px;margin:0 0 18px}.license-card label{display:block;font-size:12px;color:#526059;margin:12px 0}.machine-row{display:flex;gap:8px;align-items:center;margin-top:6px}.machine-row code{flex:1;padding:10px;background:#f1f5f1;border:1px solid #dce3dd;border-radius:5px;font-size:13px;letter-spacing:1px;word-break:break-all}.license-card textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #ccd8ce;border-radius:5px;resize:vertical;font:12px monospace}.license-card .primary{width:100%;margin-top:8px}.license-message{min-height:18px;color:#9a5d20;font-size:12px}.license-card small{display:block;color:#87938b;font-size:11px;line-height:1.5}.app[hidden]{display:none!important}';
    document.head.appendChild(style);
  }
  const enc = new TextEncoder();
  const fromB64u = value => { let s = String(value).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const raw = atob(s); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  const pemBytes = pem => fromB64u(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  const machineCode = id => { const compact = String(id || "").replace(/[^0-9a-f]/gi, "").toUpperCase(); return compact ? (compact.match(/.{1,4}/g) || [compact]).join("-") : "未生成"; };
  const getInstallId = async () => { const s = await chrome.storage.local.get("installId"); if (s.installId) return s.installId; const id = uuid(); await chrome.storage.local.set({ installId: id }); return id; };
  function normalizeToken(value) {
    const text = String(value || "").trim().replace(/^```(?:text|txt)?/i, "").replace(/```$/i, "").replace(/^['"\s]+|['"\s]+$/g, "");
    const match = text.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    return match ? match[0] : text.replace(/\s+/g, "");
  }
  function normalizeMachineId(value) {
    const compact = String(value || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    if (compact.length !== 32) return String(value || "").toLowerCase();
    return compact.slice(0, 8) + "-" + compact.slice(8, 12) + "-" + compact.slice(12, 16) + "-" + compact.slice(16, 20) + "-" + compact.slice(20);
  }
  async function verifyToken(token, installId) {
    try {
      const parts = normalizeToken(token).split(".");
      if (parts.length !== 2) return { valid: false, reason: "激活码格式不正确" };
      const payload = JSON.parse(new TextDecoder().decode(fromB64u(parts[0])));
      if (payload.product !== PRODUCT) return { valid: false, reason: "激活码产品不匹配" };
      if (normalizeMachineId(payload.machineId) !== normalizeMachineId(installId)) return { valid: false, reason: "激活码机器码不匹配：激活码为 " + machineCode(normalizeMachineId(payload.machineId)) + "，当前浏览器为 " + machineCode(normalizeMachineId(installId)) };
      const expires = Number(payload.expiresAt);
      const now = Date.now();
      if (!Number.isFinite(expires) || expires <= now) return { valid: false, reason: "激活码已过期" };
      const previous = await chrome.storage.local.get("lastLicenseCheck");
      if (previous.lastLicenseCheck && now + 10 * 60 * 1000 < Number(previous.lastLicenseCheck)) return { valid: false, reason: "检测到系统时间回退，请校准后重试" };
      const key = await crypto.subtle.importKey("spki", pemBytes(PUBLIC_KEY_PEM), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const signature = fromB64u(parts[1]);
      let ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, enc.encode(parts[0]));
      if (!ok && signature.length !== 64) return { valid: false, reason: "激活码签名格式不兼容" };
      if (!ok) return { valid: false, reason: "激活码签名无效，请确认使用当前版本发码工具" };
      await chrome.storage.local.set({ lastLicenseCheck: now });
      return { valid: true, payload };
    } catch (error) { return { valid: false, reason: "激活码校验异常：" + (error?.message || "格式无法解析") }; }
  }
  function setText(id, value) { const e = document.getElementById(id); if (e) e.textContent = value; }
  function showActivation(message) { ensureUi(); const gate = document.getElementById("license-gate"), app = document.querySelector("main.app"); if (gate) gate.hidden = false; if (app) app.hidden = true; if (message) setText("license-message", message); }
  function showApp() { ensureUi(); const gate = document.getElementById("license-gate"), app = document.querySelector("main.app"); if (gate) gate.hidden = true; if (app) app.hidden = false; }
  async function refresh() { const installId = await getInstallId(); setText("machine-code", machineCode(installId)); const saved = await chrome.storage.local.get("licenseState"); state = saved.licenseState?.token ? await verifyToken(saved.licenseState.token, installId) : { valid: false, reason: "尚未激活" }; if (state.valid) { state.token = saved.licenseState.token; showApp(); setText("license-badge", "已授权至 " + new Date(state.payload.expiresAt).toLocaleDateString("zh-CN")); } else { showActivation(state.reason); } return state; }
  async function activate() { const input = document.getElementById("license-input"), token = normalizeToken(input?.value); if (!token) return setText("license-message", "请先粘贴激活码。"); setText("license-message", "正在校验激活码…"); const installId = await getInstallId(); const checked = await verifyToken(token, installId); if (!checked.valid) return setText("license-message", checked.reason); await chrome.storage.local.set({ licenseState: { token, activatedAt: Date.now(), expiresAt: checked.payload.expiresAt, licenseId: checked.payload.licenseId || "" } }); state = { valid: true, payload: checked.payload, token }; showApp(); setText("license-message", "激活成功，已解锁插件。"); window.dispatchEvent(new CustomEvent("license-ready")); }
  async function init() { ensureUi(); const installId = await getInstallId(); setText("machine-code", machineCode(installId)); document.getElementById("copy-machine")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(machineCode(installId)); setText("license-message", "机器码已复制。"); } catch { setText("license-message", "复制失败，请手动选择机器码。"); } }); document.addEventListener("click", event => { if (event.target.closest("#activate-license")) { event.preventDefault(); activate(); } }, true); document.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.closest("#license-input")) { event.preventDefault(); activate(); } }); return refresh(); }
  window.License = { init, refresh, verify: async () => { const s = await chrome.storage.local.get("licenseState"); return s.licenseState?.token ? verifyToken(s.licenseState.token, await getInstallId()) : { valid: false, reason: "尚未激活" }; }, isValidSync: () => Boolean(state.valid), require: async () => { const next = await window.License.verify(); state = next; if (!next.valid) showActivation(next.reason); return next.valid; }, getState: () => state };
  ensureUi();
  init();
  document.addEventListener("click", async event => { const target = event.target.closest("#generate,#download-all,#replace-all"); if (!target || target.closest("#license-gate")) return; if (!(await window.License.require())) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
})();
