(() => {
  document.querySelector('main.app')?.setAttribute('hidden', '');
  const licenseLoader = document.createElement('script');
  licenseLoader.src = 'license.js';
  document.head.appendChild(licenseLoader);
  const $ = id => document.getElementById(id);
  let images = [], customImages = [], selected = new Set(), resultUrls = [], history = [], promptPresets = [], customModelPresets = [];
  let batchTasks = [], pollTimer = null, thinkingTimer = null, directoryHandle = null;
  let activeProvider = "agnes";
  let providerUiHydrated = false;
  let lastCustomKeyValue = "";
  const providerKeyName = provider => "apiKey_" + provider;
  const TASK_CATALOG_BASE_URL = "https://www.hfsyapi.cn";
  const CUSTOM_PROFILE_KEY = "customProviderProfilesV1";
  const providerModelName = provider => provider === "agnes" ? "agnesModel" : provider === "hfsy" ? "hfsyModel" : "customModel";
  const providerLabel = provider => ({ agnes: "Agnes", hfsy: "hfsyapi", custom: "自定义中转站" }[provider] || "当前中转站");
  const isRemoteImageUrl = value => typeof value === "string" && /^https?:\/\//i.test(value);
  const remoteImageUrls = values => (Array.isArray(values) ? values : []).filter(isRemoteImageUrl);
  const pageConnectionMessage = error => /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || "")) ? "当前页面尚未连接插件。扩展重新加载后请刷新商品编辑页，再重新扫描或上传。" : (error?.message || String(error || "操作失败"));
  const maskedKey = value => { const key = String(value || "").trim(); return key ? "已保存（后四位 " + key.slice(-4) + "）" : "未设置 API Key"; };
  async function keyFingerprint(value) { const bytes = new TextEncoder().encode(String(value || "").trim()); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24); }
  function setProviderSaveStatus(message, error = false) { const el = $("provider-save-status"); if (el) { el.textContent = message; el.classList.toggle("error", error); } }
  function customProfileSnapshot() { const cfg = customConfig(); return { customProtocol: cfg.protocol, customBaseUrl: cfg.base, customModel: cfg.model, customModelPreset: $("custom-model-preset")?.value || "", customGeneratePath: cfg.generatePath, customQueryPath: cfg.queryPath, customMode: cfg.mode, customInputMode: cfg.inputMode, customTaskIdPaths: cfg.taskIdPaths, customStatusPaths: cfg.statusPaths, customResultPaths: cfg.resultPaths, customSuccessStates: cfg.successStates, customFailureStates: cfg.failureStates, customAuthMode: cfg.authMode, customAuthHeader: cfg.authHeader, customQueryMethod: cfg.queryMethod, savedAt: Date.now() }; }
  async function saveCustomProfile(key) { if (activeProvider !== "custom" || !String(key || "").trim()) return; try { const fingerprint = await keyFingerprint(key); const state = await chrome.storage.local.get(CUSTOM_PROFILE_KEY); const profiles = state[CUSTOM_PROFILE_KEY] && typeof state[CUSTOM_PROFILE_KEY] === "object" ? state[CUSTOM_PROFILE_KEY] : {}; profiles[fingerprint] = customProfileSnapshot(); const recent = Object.entries(profiles).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)).slice(0, 20); await chrome.storage.local.set({ [CUSTOM_PROFILE_KEY]: Object.fromEntries(recent) }); } catch (error) { log("自定义密钥配置档案保存失败：" + (error.message || error), "error"); } }
  async function applyCustomProfileForKey(key, force = false) { if (activeProvider !== "custom") return false; const value = String(key || "").trim(); if (!value) return false; try { const fingerprint = await keyFingerprint(value); const state = await chrome.storage.local.get(CUSTOM_PROFILE_KEY); const profile = state[CUSTOM_PROFILE_KEY]?.[fingerprint]; if (!profile && !force) return false; if (profile) { $("custom-protocol").value = profile.customProtocol || "auto"; $("custom-base-url").value = profile.customBaseUrl || ""; $("custom-model").value = profile.customModel || "gpt-image-2"; $("custom-model-preset").value = profile.customModelPreset || ""; $("custom-generate-path").value = profile.customGeneratePath || "/images/generations"; $("custom-query-path").value = profile.customQueryPath || "/images/generations/{task_id}"; $("custom-mode").value = profile.customMode || "sync"; $("custom-input-mode").value = profile.customInputMode || "openai"; $("custom-task-id-path").value = profile.customTaskIdPaths || "task_id,data.task_id,id"; $("custom-status-path").value = profile.customStatusPaths || "status,data.status"; $("custom-result-path").value = profile.customResultPaths || "data[0].url,result_url,data.result_url,data[0].b64_json"; $("custom-success-states").value = profile.customSuccessStates || "SUCCESS,COMPLETED,SUCCEEDED,DONE,FINISHED"; $("custom-failure-states").value = profile.customFailureStates || "FAILURE,FAILED,ERROR,CANCELLED"; $("custom-auth-mode").value = profile.customAuthMode || "bearer"; $("custom-auth-header").value = profile.customAuthHeader || ""; $("custom-query-method").value = profile.customQueryMethod || "auto"; installCatalogModelControl(profile.customModelPreset || ""); updateCustomProviderUi(); return true; }
      $("custom-protocol").value = "auto"; $("custom-base-url").value = ""; $("custom-model").value = "gpt-image-2"; $("custom-model-preset").value = ""; $("custom-generate-path").value = "/images/generations"; $("custom-query-path").value = "/images/generations/{task_id}"; $("custom-mode").value = "sync"; $("custom-input-mode").value = "openai"; updateCustomProviderUi(); return false;
    } catch (error) { log("自定义密钥配置档案读取失败：" + (error.message || error), "error"); return false; } }
  async function handleCustomKeyBlur() { if (activeProvider !== "custom") return saveProviderConfig(false, activeProvider); const key = $("api-key")?.value.trim() || ""; if (key && lastCustomKeyValue && key !== lastCustomKeyValue) { const restored = await applyCustomProfileForKey(key, true); setProviderSaveStatus(restored ? "已恢复该密钥上次使用的模型配置" : "检测到新密钥，旧自定义模型配置已清空，请重新选择模型"); } lastCustomKeyValue = key; await saveProviderConfig(false, activeProvider); updateButton(); }
  async function readPromptPresets() { try { const state = await chrome.storage.local.get("promptPresetsV1"); promptPresets = Array.isArray(state.promptPresetsV1) ? state.promptPresetsV1.filter(item => item && item.name && typeof item.text === "string") : []; } catch (error) { promptPresets = []; log("提示词模板读取失败：" + (error.message || error), "error"); } renderPromptPresets(); }
  function renderPromptPresets() { const select = $("prompt-preset-select"); if (!select) return; select.innerHTML = '<option value="">选择已保存提示词</option>'; promptPresets.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN")).forEach(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; select.appendChild(option); }); }
  async function savePromptPreset() { const name = $("prompt-preset-name")?.value.trim() || "", textValue = $("prompt")?.value || ""; if (!name) return status("请先填写提示词名称。", true); if (!textValue.trim()) return status("提示词内容不能为空。", true); const old = promptPresets.find(item => item.name === name); const now = Date.now(); const next = { id: old?.id || "prompt-" + now, name, text: textValue, createdAt: old?.createdAt || now, updatedAt: now }; promptPresets = promptPresets.filter(item => item.name !== name).concat(next); await chrome.storage.local.set({ promptPresetsV1: promptPresets }); renderPromptPresets(); $("prompt-preset-select").value = next.id; status("提示词“" + name + "”已保存到本地。"); }
  function loadPromptPreset() { const id = $("prompt-preset-select")?.value, item = promptPresets.find(entry => entry.id === id); if (!item) return status("请先选择已保存的提示词。", true); $("prompt").value = item.text; chrome.storage.local.set({ prompt: item.text }).catch(() => {}); queueWorkspaceSave(); updateButton(); status("已载入提示词“" + item.name + "”。"); }
  async function deletePromptPreset() { const id = $("prompt-preset-select")?.value, item = promptPresets.find(entry => entry.id === id); if (!item) return status("请先选择要删除的提示词。", true); promptPresets = promptPresets.filter(entry => entry.id !== id); await chrome.storage.local.set({ promptPresetsV1: promptPresets }); renderPromptPresets(); status("已删除提示词“" + item.name + "”。"); }
  async function readCustomModelPresets() {
    try {
      const state = await chrome.storage.local.get("customModelPresetsV1");
      customModelPresets = Array.isArray(state.customModelPresetsV1) ? state.customModelPresetsV1.filter(item => item && item.name && typeof item === "object") : [];
    } catch (error) {
      customModelPresets = [];
      log("自定义模型预设读取失败：" + (error.message || error), "error");
    }
    renderCustomModelPresets();
  }
  function renderCustomModelPresets() {
    const select = $("custom-preset-select");
    if (!select) return;
    select.innerHTML = '<option value="">选择已保存模型</option>';
    customModelPresets.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN")).forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name + (item.model ? " (" + item.model + ")" : "");
      select.appendChild(option);
    });
  }
  async function saveCustomModelPreset() {
    const name = $("custom-preset-name")?.value.trim() || "";
    if (!name) return status("请先填写模型预设名称。", true);
    const key = $("api-key")?.value.trim() || "";
    const base = $("custom-base-url")?.value.trim() || "";
    const model = $("custom-model")?.value.trim() || "";
    if (!base && !model) return status("请先填写 Base URL 或模型名称后再保存。", true);
    const old = customModelPresets.find(item => item.name === name);
    const now = Date.now();
    const next = {
      id: old?.id || "model-preset-" + now,
      name,
      apiKey: key,
      base,
      model: model || "gpt-image-2",
      customModelPreset: $("custom-model-preset")?.value || "",
      protocol: $("custom-protocol")?.value || "auto",
      mode: $("custom-mode")?.value || "sync",
      generatePath: $("custom-generate-path")?.value || "/images/generations",
      queryPath: $("custom-query-path")?.value || "/images/generations/{task_id}",
      queryMethod: $("custom-query-method")?.value || "auto",
      authMode: $("custom-auth-mode")?.value || "bearer",
      authHeader: $("custom-auth-header")?.value || "",
      inputMode: $("custom-input-mode")?.value || "openai",
      taskIdPaths: $("custom-task-id-path")?.value || "task_id,data.task_id,id",
      statusPaths: $("custom-status-path")?.value || "status,data.status",
      resultPaths: $("custom-result-path")?.value || "data[0].url,result_url,data.result_url,data[0].b64_json",
      successStates: $("custom-success-states")?.value || "SUCCESS,COMPLETED,SUCCEEDED,DONE,FINISHED",
      failureStates: $("custom-failure-states")?.value || "FAILURE,FAILED,ERROR,CANCELLED",
      createdAt: old?.createdAt || now,
      updatedAt: now
    };
    customModelPresets = customModelPresets.filter(item => item.name !== name).concat(next);
    await chrome.storage.local.set({ customModelPresetsV1: customModelPresets });
    renderCustomModelPresets();
    $("custom-preset-select").value = next.id;
    status("模型预设“" + name + "”已保存，包含密钥与接口配置。");
    await saveProviderConfig(false, "custom");
  }
  async function loadCustomModelPreset() {
    const id = $("custom-preset-select")?.value;
    const item = customModelPresets.find(entry => entry.id === id);
    if (!item) return status("请先选择已保存的模型预设。", true);
    if (item.apiKey !== undefined && $("api-key")) $("api-key").value = item.apiKey;
    if ($("custom-base-url")) $("custom-base-url").value = item.base || "";
    if ($("custom-model")) $("custom-model").value = item.model || "";
    if ($("custom-model-preset")) $("custom-model-preset").value = item.customModelPreset || "";
    if ($("custom-protocol")) $("custom-protocol").value = item.protocol || "auto";
    if ($("custom-mode")) $("custom-mode").value = item.mode || "sync";
    if ($("custom-generate-path")) $("custom-generate-path").value = item.generatePath || "/images/generations";
    if ($("custom-query-path")) $("custom-query-path").value = item.queryPath || "/images/generations/{task_id}";
    if ($("custom-query-method")) $("custom-query-method").value = item.queryMethod || "auto";
    if ($("custom-auth-mode")) $("custom-auth-mode").value = item.authMode || "bearer";
    if ($("custom-auth-header")) $("custom-auth-header").value = item.authHeader || "";
    if ($("custom-input-mode")) $("custom-input-mode").value = item.inputMode || "openai";
    if ($("custom-task-id-path")) $("custom-task-id-path").value = item.taskIdPaths || "task_id,data.task_id,id";
    if ($("custom-status-path")) $("custom-status-path").value = item.statusPaths || "status,data.status";
    if ($("custom-result-path")) $("custom-result-path").value = item.resultPaths || "data[0].url,result_url,data.result_url,data[0].b64_json";
    if ($("custom-success-states")) $("custom-success-states").value = item.successStates || "SUCCESS,COMPLETED,SUCCEEDED,DONE,FINISHED";
    if ($("custom-failure-states")) $("custom-failure-states").value = item.failureStates || "FAILURE,FAILED,ERROR,CANCELLED";
    if ($("custom-preset-name")) $("custom-preset-name").value = item.name;
    installCatalogModelControl(item.customModelPreset || "");
    updateCustomProviderUi();
    lastCustomKeyValue = $("api-key")?.value.trim() || "";
    setProviderSaveStatus(maskedKey($("api-key").value));
    await saveProviderConfig(false, "custom");
    updateButton();
    status("已载入模型预设“" + item.name + "”。");
  }
  async function deleteCustomModelPreset() {
    const id = $("custom-preset-select")?.value;
    const item = customModelPresets.find(entry => entry.id === id);
    if (!item) return status("请先选择要删除的模型预设。", true);
    customModelPresets = customModelPresets.filter(entry => entry.id !== id);
    await chrome.storage.local.set({ customModelPresetsV1: customModelPresets });
    renderCustomModelPresets();
    if ($("custom-preset-name") && $("custom-preset-name").value === item.name) $("custom-preset-name").value = "";
    status("已删除模型预设“" + item.name + "”。");
  }
  function sanitizeRecord(record) {
    if (!record || typeof record !== "object") return record;
    const next = { ...record };
    if (Array.isArray(next["参考图片"])) next["参考图片"] = remoteImageUrls(next["参考图片"]);
    if (Array.isArray(next["生成文件"])) next["生成文件"] = next["生成文件"].map(item => ({ ...item, 图片URL: isRemoteImageUrl(item?.图片URL || item?.url) ? (item.图片URL || item.url) : "内嵌图片数据未写入扩展缓存" }));
    return next;
  }
  async function cleanupLegacyInlineImageData() {
    const keys = ["lastResults", "history", "batchTasks", "activeTask", "pendingSave"];
    const state = await chrome.storage.local.get(keys);
    const update = {};
    let changed = false;
    const lastResults = Array.isArray(state.lastResults) ? state.lastResults : [];
    if (Array.isArray(state.lastResults) && lastResults.length !== state.lastResults.length) { update.lastResults = lastResults; changed = true; }
    if (Array.isArray(state.history)) {
      const cleanHistory = state.history.filter(item => item && typeof item === "object" && (item.url || item.localFile || item.status)).map(item => ({ ...item, referenceImages: Array.isArray(item.referenceImages) ? item.referenceImages : [] }));
      if (JSON.stringify(cleanHistory) !== JSON.stringify(state.history)) { update.history = cleanHistory; changed = true; }
    }
    if (Array.isArray(state.batchTasks)) {
      const cleanTasks = state.batchTasks.map(task => { const next = { ...task }; if (!isRemoteImageUrl(next.url)) delete next.url; if (!isRemoteImageUrl(next.referenceImage)) delete next.referenceImage; return next; });
      if (JSON.stringify(cleanTasks) !== JSON.stringify(state.batchTasks)) { update.batchTasks = cleanTasks; changed = true; }
    }
    if (state.activeTask && typeof state.activeTask === "object") {
      const cleanTask = { ...state.activeTask };
      if (Array.isArray(cleanTask.resultUrls)) cleanTask.resultUrls = remoteImageUrls(cleanTask.resultUrls);
      if (JSON.stringify(cleanTask) !== JSON.stringify(state.activeTask)) { update.activeTask = cleanTask; changed = true; }
    }
    if (state.pendingSave && typeof state.pendingSave === "object") {
      const cleanPending = { ...state.pendingSave, urls: Array.isArray(state.pendingSave.urls) ? state.pendingSave.urls : [], record: sanitizeRecord(state.pendingSave.record) };
      if (!cleanPending.urls.length && !cleanPending.inlineResultCount) { await chrome.storage.local.remove("pendingSave"); changed = true; }
      else if (JSON.stringify(cleanPending) !== JSON.stringify(state.pendingSave)) { update.pendingSave = cleanPending; changed = true; }
    }
    if (Object.keys(update).length) await chrome.storage.local.set(update);
    return changed;
  }
  async function saveProviderConfig(showFeedback = true, providerOverride = null) {
    const provider = providerOverride || $("provider")?.value || activeProvider;
    const key = $("api-key")?.value.trim() || "";
    if (provider === "custom") {
      try { validateCustomConfig(resolvedCustomConfig(customConfig()), key); }
      catch (error) { setProviderSaveStatus("配置无效", true); if (showFeedback) status(error.message, true); return false; }
    }
    const payload = { provider, apiKey: key, [providerKeyName(provider)]: key, [providerModelName(provider)]: selectedProviderModel(provider) };
    if (provider === "custom") { const custom = customConfig(); Object.assign(payload, { customProtocol: custom.protocol, customBaseUrl: custom.base, customGeneratePath: custom.generatePath, customQueryPath: custom.queryPath, customModel: custom.model, customModelPreset: $("custom-model-preset")?.value || "", customMode: custom.mode, customInputMode: custom.inputMode, customTaskIdPaths: custom.taskIdPaths, customStatusPaths: custom.statusPaths, customResultPaths: custom.resultPaths, customSuccessStates: custom.successStates, customFailureStates: custom.failureStates, customAuthMode: custom.authMode, customAuthHeader: custom.authHeader, customQueryMethod: custom.queryMethod }); }
    try {
      await cleanupLegacyInlineImageData();
      await chrome.storage.local.set(payload);
      if (provider === "custom" && key) await saveCustomProfile(key);
      const message = providerLabel(provider) + "配置已保存至当前浏览器用户配置中的“商品生图助手”扩展本地数据，" + maskedKey(key) + "。";
      setProviderSaveStatus(maskedKey(key));
      if (showFeedback) status(message);
      return true;
    } catch (error) {
      const message = "中转站配置保存失败：" + (error?.message || "浏览器扩展存储不可用");
      setProviderSaveStatus("保存失败", true);
      if (showFeedback) status(message, true);
      return false;
    }
  }
  const storageCleanupReady = cleanupLegacyInlineImageData().catch(error => { console.warn("无法清理旧图片缓存", error); return false; });
  function providerModelOptions(provider) { if (provider === "agnes") return [["agnes-image-2.5-flash", "Agnes Image 2.5 Flash"], ["agnes-image-2.1-flash", "Agnes Image 2.1 Flash"], ["agnes-image-2.0-flash", "Agnes Image 2.0 Flash"]]; if (provider === "hfsy") return [["gpt-image-2", "GPT-image-2"], ["gpt-image-2.5", "GPT-image-2.5"]]; return []; }
  function installProviderModelControl(provider, value) { const settings = document.querySelector(".settings"); if (!settings) return; let label = $("provider-model-control"); if (!label) { label = document.createElement("label"); label.id = "provider-model-control"; label.textContent = "模型 "; const select = document.createElement("select"); select.id = "provider-model"; label.appendChild(select); const key = $("api-key"); key?.parentElement?.insertAdjacentElement("afterend", label); select.onchange = async () => { setProviderSaveStatus("模型已更改，正在保存…"); await saveProviderConfig(false, activeProvider); setProviderSaveStatus("模型已保存：" + select.value); updateButton(); }; } const select = $("provider-model"), options = providerModelOptions(provider); const visible = options.length > 0; label.hidden = !visible; label.style.display = visible ? "" : "none"; if (!select || !visible) { updateCustomProviderUi(); return; } select.innerHTML = options.map(([id, text]) => '<option value="' + id + '">' + text + '</option>').join(""); const valid = options.some(([id]) => id === value); select.value = valid ? value : options[0][0]; updateCustomProviderUi(); }
  async function switchProviderConfig(next) { if (!next) return; if (activeProvider && $("api-key")) await saveProviderConfig(false, activeProvider); activeProvider = next; await chrome.storage.local.set({ provider: next }); const state = await chrome.storage.local.get([providerKeyName(next), providerModelName(next), "customModelPreset"]); $("api-key").value = state[providerKeyName(next)] || ""; if (next === "custom") { lastCustomKeyValue = $("api-key").value.trim(); installCatalogModelControl(state.customModelPreset || ""); } else setCatalogSizeOptions(null); installProviderModelControl(next, state[providerModelName(next)]); if ($("custom-provider-panel")) $("custom-provider-panel").hidden = next !== "custom"; updateCustomProviderUi(); setProviderSaveStatus(maskedKey($("api-key").value)); queueWorkspaceSave(); updateButton(); }
  const providerAwareFetch = window.fetch;
  window.fetch = (input, init = {}) => { const url = String(input || ""); if (init.body && (activeProvider === "agnes" && /apihub\.agnes-ai\.com/.test(url) || activeProvider === "hfsy" && /hfsyapi\.cn/.test(url))) { try { const body = JSON.parse(init.body); body.model = selectedProviderModel(activeProvider); return providerAwareFetch(input, { ...init, body: JSON.stringify(body) }); } catch {} } return providerAwareFetch(input, init); };
  function saveMode() { return $("save-mode")?.value === "downloads" ? "downloads" : "local"; }
  function selectedProviderModel(provider) { if (provider === "custom") return $("custom-model")?.value.trim() || "gpt-image-2"; const value = $("provider-model")?.value; return value || (provider === "agnes" ? "agnes-image-2.5-flash" : "gpt-image-2"); }
  const customProtocolHints = {
    auto: "必填：Base URL、API Key、模型名称。识别 Agnes / hfsyapi 域名；其他地址按 OpenAI 图像协议处理。",
    agnes: "示例：Base URL 填 https://apihub.agnes-ai.com，模型填 agnes-image-2.5-flash。其余参数自动处理。",
    hfsy: "示例：Base URL 填 https://www.hfsyapi.cn，模型填 gpt-image-2 或 gpt-image-2.5。其余参数自动处理。",
    "hfsy-task-catalog": "内置任务目录模型使用 /v1/image/create 和 POST /v1/image/query/{task_id}，选择模型后会自动填写这些字段。",
    openai: "通用 OpenAI 图像协议会自动处理 /images/generations、图片字段和 data[0].url。",
     advanced: "高级字段覆盖自动协议默认值。仅在接口文档与常见协议不同时修改。"
   };
  function customAiTemplate() {
    return [
      "我需要配置一个浏览器插件的自定义图像中转站，请根据下面的接口文档和脱敏 JSON 示例，告诉我每个字段应该怎么填写。",
      "",
      "安全要求：不要输出或要求真实 API Key；只使用 <API_KEY_REDACTED>。",
      "",
      "接口根地址：<BASE_URL>",
      "模型名称：<MODEL_NAME>",
      "接口文档：",
      "<粘贴文档，删除真实密钥>",
      "",
      "请求示例：",
      "<粘贴 curl 或请求 JSON，删除真实密钥>",
      "",
      "返回示例：",
      "<粘贴完整 JSON，删除 URL 中的敏感参数>",
      "",
      "请严格按以下格式输出，不要猜测：",
      "协议：auto / agnes / hfsy / openai / advanced",
      "Base URL：",
      "模型名称：",
      "生成接口路径：",
      "查询接口路径：如果不是异步，写‘不需要’",
      "请求模式：同步返回 / 异步任务",
      "图片输入字段：openai / reference / image / both",
      "任务 ID 字段路径：",
      "状态字段路径：",
      "图片结果字段路径：",
      "成功状态：",
      "失败状态：",
      "查询请求方法：auto / get / post",
      "API Key 认证方式：bearer / x-api-key / api-key / custom-header",
      "自定义 Header 名称（如适用）：",
      "仍然缺失的信息："
    ].join("\n");
  }
  function updateCustomProviderUi() {
    const provider = $("provider")?.value;
    const isCustom = provider === "custom";
    const keyLabel = $("api-key-label");
    const customCore = $("custom-core-fields");
    const standardKeyHost = $("standard-key-host");
    const standardSaveRow = $("standard-save-row");
    if (isCustom) {
      if (keyLabel && customCore && keyLabel.parentElement !== customCore) {
        customCore.insertBefore(keyLabel, $("custom-model")?.parentElement || null);
      }
      if (standardSaveRow) standardSaveRow.hidden = true;
    } else {
      if (keyLabel && standardKeyHost && keyLabel.parentElement !== standardKeyHost) {
        standardKeyHost.appendChild(keyLabel);
      }
      if (standardSaveRow) standardSaveRow.hidden = false;
    }
    const apiKey = $("api-key");
    if (apiKey?.parentElement) apiKey.parentElement.firstChild.nodeValue = isCustom ? "自定义 API Key " : "API Key ";
    const panel = $("custom-provider-panel");
    if (panel) panel.hidden = !isCustom;
    const protocol = $("custom-protocol")?.value || "auto";
    const authHeaderRow = $("custom-auth-header-row");
    if (authHeaderRow) authHeaderRow.hidden = !isCustom || protocol !== "advanced" || ($("custom-auth-mode")?.value || "bearer") !== "custom-header";
    const hint = $("custom-protocol-hint");
    if (hint) hint.textContent = isCustom ? (customProtocolHints[protocol] || customProtocolHints.auto) : "";
    const modelControl = $("provider-model-control");
    if (modelControl && isCustom) { modelControl.hidden = true; modelControl.style.display = "none"; }
    const summary = $("custom-config-summary");
    if (summary && isCustom) {
      const cfg = customConfig();
      summary.textContent = "当前生效协议：" + (cfg.protocol === "auto" ? "智能识别" : cfg.protocol) + " · 接口模式：" + (cfg.mode === "sync" ? "同步生成" : "异步任务") + " · 认证：" + (cfg.authMode === "bearer" ? "Bearer" : cfg.authMode);
    }
    const template = $("custom-ai-template");
    if (template && !template.value) template.value = customAiTemplate();
  }
  function updateSaveModeUi() { const mode = saveMode(); const button = $("choose-folder"), label = $("folder-status"); if (button) button.disabled = mode !== "local"; if (label && mode === "downloads") label.textContent = "当前使用浏览器下载目录：商品生图/"; else if (label && mode === "local" && !directoryHandle) label.textContent = "尚未选择本地文件夹，请先选择"; }
  function installSaveModeControl(value) { const host = document.querySelector(".save-location"); if (!host || $("save-mode")) return; const label = document.createElement("label"); label.className = "save-mode-label"; label.textContent = "保存方式 "; const select = document.createElement("select"); select.id = "save-mode"; select.innerHTML = '<option value="local">指定本地文件夹</option><option value="downloads">浏览器下载目录</option>'; select.value = value === "downloads" ? "downloads" : "local"; label.appendChild(select); host.insertBefore(label, host.firstChild); select.onchange = () => { updateSaveModeUi(); chrome.storage.local.set({ saveMode: select.value }); status(select.value === "local" ? "已切换为指定本地文件夹模式。" : "已切换为浏览器下载模式。"); }; updateSaveModeUi(); }
  async function persistHfsySubmissionSnapshot(startedAt, model, total) {
    const succeeded = batchTasks.filter(task => task.status === "SUCCESS").length;
    const failed = batchTasks.filter(task => task.status === "FAILURE").length;
    const snapshot = { batch: true, provider: "hfsy", model, total, startedAt, updatedAt: Date.now(), status: "POLLING", finished: succeeded + failed, succeeded, failed, resultUrls: remoteImageUrls(resultUrls), failures: batchTasks.filter(task => task.status === "FAILURE").map(task => ({ taskId: task.taskId || "", imageIndex: task.imageIndex, error: task.error || "生成失败" })) };
    try {
      await chrome.storage.local.set({ activeTask: snapshot, batchTasks });
    } catch (error) {
      log("hfsyapi 任务快照保存失败：" + (error?.message || error), "error");
    }
  }
  let thinkingStartedAt = 0;
  // hfsyapi 文档使用 /v1/images/generations；兼容旧代码中的 /async 路径，避免提交到不兼容的异步端点。
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, ...args) => {
    if (typeof input === "string" && input.includes("https://www.hfsyapi.cn/v1/images/generations/async")) {
      input = input.replace("/v1/images/generations/async", "/v1/images/generations");
    }
    return nativeFetch(input, ...args);
  };
  let executionLog = [];
  const log = (message, level = "info") => { executionLog.unshift({time:new Date().toLocaleTimeString("zh-CN"), message, level}); executionLog = executionLog.slice(0,100); chrome.storage.local.set({executionLog}).catch(() => {}); renderLog(); };
  const renderLog = () => { const e=$("execution-log-list"); if(e) e.innerHTML=executionLog.length?executionLog.map(x=>`<div class="log-item ${x.level}"><time>${x.time}</time><span>${String(x.message).replaceAll("<","&lt;")}</span></div>`).join(""):"<p class=\"muted\">暂无执行记录</p>"; };
  const status = (m, error = false) => { const e = $("status"); if (e) { e.textContent = m || ""; e.className = "status" + (error ? " error" : ""); } if(m) log(m,error?"error":"info"); };
  const refs = () => images.concat(customImages.map(src => ({ src, custom: true })));
  const selectedRefs = () => [...selected].map(i => refs()[i]?.src).filter(Boolean);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
  const WORKSPACE_KEY = "workspaceStateV1";
  const CURRENT_TASK_KEY = "currentTask";
  const CACHE_DB = "image-workflow-cache";
  const CACHE_STORE = "blobs";
  let workspaceSaveTimer = null;
  let workspaceHydrated = false;
  let currentTask = null;
  const taskFailures = () => batchTasks.filter(t => t.status === "FAILURE").map((t, index) => ({ taskId: t.taskId || "", imageIndex: Number.isInteger(t.imageIndex) ? t.imageIndex : index, error: t.error || "生成失败" }));
  function taskSummary(task) { const failed = Number(task?.failed ?? task?.failures?.length ?? 0), success = Number(task?.succeeded ?? Math.max(0, (task?.finished || 0) - failed)); if (!task) return "当前没有运行任务"; if (task.status === "GENERATING") return "正在提交第 " + Math.min((task.finished || 0) + 1, task.total || 1) + " / " + (task.total || 0) + " 张"; if (task.status === "POLLING") return "已提交，等待中转站返回；已完成 " + (task.finished || 0) + " / " + (task.total || 0) + " 张"; if (task.status === "COMPLETE") return "生成完成，成功 " + success + " 张，失败 " + failed + " 张"; if (task.status === "FAILED") return "任务失败，已完成 " + (task.finished || 0) + " 张"; return "上次任务中断，已完成 " + (task.finished || 0) + " 张，可查看已返回结果"; }
  function renderCurrentTask(task = currentTask) { const box = $("task-state"), badge = $("task-state-badge"), title = $("task-state-title"), detail = $("task-state-detail"); if (box) box.dataset.state = String(task?.status || "IDLE").toLowerCase(); if (badge) badge.textContent = ({GENERATING:"生成中",POLLING:"等待返回",COMPLETE:"已完成",FAILED:"失败",INTERRUPTED:"已中断"}[task?.status] || "等待开始"); const text = taskSummary(task); if (title) title.textContent = text; if (detail) detail.textContent = task?.error || (task?.model ? providerLabel(task.provider) + " · " + task.model : ""); if (task && $("thinking-text")) $("thinking-text").textContent = text; }
  async function writeCurrentTask(patch = {}, options = {}) { try { const now = Date.now(); const next = { version: 1, provider: "", model: "", status: "GENERATING", startedAt: now, updatedAt: now, total: 0, finished: 0, succeeded: 0, failed: 0, resultUrls: [], resultCacheIds: [], failures: [], error: "", prompt: "", ...(currentTask || {}), ...patch, updatedAt: now }; next.total = Math.max(0, Number(next.total) || 0); next.finished = Math.min(next.total || Number(next.finished) || 0, Math.max(0, Number(next.finished) || 0)); next.failures = Array.isArray(next.failures) ? next.failures : []; next.failed = Math.min(next.finished, Number(next.failed ?? next.failures.length) || 0); next.succeeded = Math.min(next.finished, Math.max(0, Number(next.succeeded ?? (next.finished - next.failed)) || 0)); currentTask = next; await chrome.storage.local.set({ [CURRENT_TASK_KEY]: currentTask }); if (options.render !== false) renderCurrentTask(); } catch (error) { log("任务状态保存失败：" + (error?.message || error), "error"); } return currentTask; }
  function syncCurrentTask(statusOverride) { const failures = taskFailures(); const total = currentTask?.total || batchTasks.length || resultUrls.length; const finished = Math.min(total, resultUrls.length + failures.length); return writeCurrentTask({ status: statusOverride || currentTask?.status || "GENERATING", finished, succeeded: Math.min(total, resultUrls.length), failed: Math.min(total, failures.length), resultUrls: remoteImageUrls(resultUrls), failures }); }
  function taskError(stage, error, imageIndex = null) { const err = error instanceof Error ? error : Error(String(error || "未知错误")); return { provider: currentTask?.provider || $("provider")?.value || "", batchId: currentTask?.startedAt || Date.now(), imageIndex: Number.isInteger(imageIndex) ? imageIndex : null, stage, message: err.message || String(err), stack: err.stack || "" }; }
  function logTaskError(stage, error, imageIndex = null) { const detail = taskError(stage, error, imageIndex); log("[" + stage + "] " + detail.message + (detail.imageIndex === null ? "" : "（第 " + (detail.imageIndex + 1) + " 张）"), "error"); return detail; }
  async function restoreCurrentTask() { try { const state = await chrome.storage.local.get([CURRENT_TASK_KEY, "batchTasks"]); currentTask = state[CURRENT_TASK_KEY] || null; if (!currentTask || currentTask.version !== 1) return; if (currentTask.provider === "hfsy") return; if (Array.isArray(state.batchTasks) && state.batchTasks.length) batchTasks = state.batchTasks; const cached = []; for (const id of (currentTask.resultCacheIds || [])) { const blob = await readCachedBlob(id); if (blob) cached.push(URL.createObjectURL(blob)); } if (cached.length) resultUrls = remoteImageUrls(currentTask.resultUrls).concat(cached); else if (currentTask.resultUrls?.length) resultUrls = currentTask.resultUrls; if (["GENERATING","POLLING","INTERRUPTED","FAILED","COMPLETE"].includes(currentTask.status)) { $("thinking").hidden = false; setProgress(currentTask.status === "COMPLETE" ? 100 : Math.max(5, Math.min(95, currentTask.total ? currentTask.finished / currentTask.total * 92 : 5))); renderCurrentTask(); } if (resultUrls.length) renderResults(); } catch (error) { log("任务状态恢复失败：" + (error.message || "存储不可用"), "error"); } }
  async function readHfsyTaskState() {
    try {
      let response = await chrome.runtime.sendMessage({ type: "GET_HFSY_TASK_STATE" });
      if (!response?.ok || !response.activeTask || response.activeTask.provider !== "hfsy") return false;
      const key = $("api-key")?.value.trim() || "";
      if (response.activeTask.status === "POLLING" && key) {
        await chrome.runtime.sendMessage({ type: "POLL_HFSY_NOW", apiKey: key });
        response = await chrome.runtime.sendMessage({ type: "GET_HFSY_TASK_STATE" });
      }
      const activeTask = response.activeTask;
      batchTasks = Array.isArray(response.batchTasks) ? response.batchTasks : [];
      const successUrls = batchTasks.filter(task => task.status === "SUCCESS" && task.url).map(task => task.url);
      resultUrls = [...new Set(remoteImageUrls([...(response.lastResults || []), ...(activeTask.resultUrls || []), ...successUrls]))];
      const total = Math.max(Number(activeTask.total) || 0, batchTasks.length, resultUrls.length);
      const succeeded = batchTasks.filter(task => task.status === "SUCCESS").length;
      const failed = batchTasks.filter(task => task.status === "FAILURE").length;
      const finished = Math.min(total, succeeded + failed);
      const statusName = activeTask.status === "COMPLETE" ? (succeeded ? "COMPLETE" : "FAILED") : "POLLING";
      const failures = batchTasks.filter(task => task.status === "FAILURE").map((task, index) => ({ taskId: task.taskId || "", imageIndex: Number.isInteger(task.imageIndex) ? task.imageIndex : index, error: task.error || "生成失败" }));
      await writeCurrentTask({ provider: "hfsy", model: activeTask.model || selectedProviderModel("hfsy"), status: statusName, startedAt: Number(activeTask.startedAt) || Date.now(), total, finished, succeeded, failed, resultUrls: remoteImageUrls(resultUrls), failures, error: failures.length && !succeeded ? failures[0].error : "" }, { render: false });
      $("thinking").hidden = false;
      setProgress(statusName === "COMPLETE" || statusName === "FAILED" ? 100 : (total ? Math.round(finished / total * 92) : 5));
      renderCurrentTask();
      if (resultUrls.length) renderResults();
      if (statusName === "POLLING") status("已提交，后台处理中");
      return true;
    } catch (error) {
      log("后台任务状态恢复失败：" + (error?.message || error), "error");
      return false;
    }
  }
  function cacheDb() { return new Promise((resolve, reject) => { const request = indexedDB.open(CACHE_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function cacheBlob(blob, id = crypto.randomUUID()) { const db = await cacheDb(); await new Promise((resolve, reject) => { const tx = db.transaction(CACHE_STORE, "readwrite"); tx.objectStore(CACHE_STORE).put(blob, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); return id; }
  async function readCachedBlob(id) { const db = await cacheDb(); const blob = await new Promise((resolve, reject) => { const tx = db.transaction(CACHE_STORE, "readonly"); const req = tx.objectStore(CACHE_STORE).get(id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); db.close(); return blob || null; }
  async function dataUrlBlob(value) { const response = await fetch(value); return response.blob(); }
  function workspaceSnapshot(extra = {}) { return { version: 1, provider: $("provider")?.value || activeProvider, model: selectedProviderModel($("provider")?.value || activeProvider), prompt: $("prompt")?.value.trim() || "", pageUrl: location.href, selectedIndexes: [...selected], selectedCount: selected.size, batchTasks: batchTasks.map(t => ({ taskId: t.taskId, status: t.status, url: isRemoteImageUrl(t.url) ? t.url : "", error: t.error || "", referenceImage: isRemoteImageUrl(t.referenceImage) ? t.referenceImage : "" })), resultUrls: remoteImageUrls(resultUrls), progress: Number($("progress-bar")?.dataset.progress || 0), thinkingText: $("thinking-text")?.textContent || "", updatedAt: Date.now(), ...extra }; }
  function queueWorkspaceSave(extra = {}) { clearTimeout(workspaceSaveTimer); workspaceSaveTimer = setTimeout(async () => { try { await chrome.storage.local.set({ [WORKSPACE_KEY]: workspaceSnapshot(extra) }); } catch (error) { log("工作区状态保存失败：" + (error.message || "存储不可用"), "error"); } }, 120); }
  async function persistCustomImageCache(values) { try { const ids = []; for (const value of values) ids.push(await cacheBlob(await dataUrlBlob(value))); await chrome.storage.local.set({ workspaceCustomImageIds: ids }); return ids; } catch (error) { log("本地参考图缓存失败，将只保留当前窗口预览：" + (error.message || "IndexedDB 不可用"), "error"); return []; } }
  async function restoreCustomImageCache() { try { const state = await chrome.storage.local.get("workspaceCustomImageIds"); const restored = []; for (const id of (state.workspaceCustomImageIds || [])) { const blob = await readCachedBlob(id); if (blob) restored.push(URL.createObjectURL(blob)); } if (restored.length) { customImages = restored; renderImages(); } } catch (error) { log("本地参考图缓存恢复失败：" + (error.message || "IndexedDB 不可用"), "error"); } }
  async function restoreWorkspace() { if (workspaceHydrated) return; workspaceHydrated = true; try { const state = await chrome.storage.local.get([WORKSPACE_KEY, "workspaceResultCacheIds"]); const ws = state[WORKSPACE_KEY]; if (!ws || ws.version !== 1) return; if (ws.pageUrl && ws.pageUrl !== location.href) return; if (ws.prompt && $("prompt") && !$('prompt').value) $("prompt").value = ws.prompt; if (Array.isArray(ws.resultUrls) && ws.resultUrls.length) resultUrls = ws.resultUrls; const cachedResults = []; for (const id of (state.workspaceResultCacheIds || [])) { const blob = await readCachedBlob(id); if (blob) cachedResults.push(URL.createObjectURL(blob)); } if (cachedResults.length) resultUrls = cachedResults; if (Array.isArray(ws.batchTasks) && ws.batchTasks.length) batchTasks = ws.batchTasks; if (Array.isArray(ws.selectedIndexes)) selected = new Set(ws.selectedIndexes.filter(Number.isInteger)); if (ws.progress) setProgress(ws.progress); if (ws.thinkingText && $("thinking-text")) $("thinking-text").textContent = ws.thinkingText; if (resultUrls.length) renderResults(); if (selected.size) renderImages(); log("已恢复上次侧边栏工作区状态。", "info"); } catch (error) { log("工作区恢复失败：" + (error.message || "存储不可用"), "error"); } }
  function referenceInfo(value) {
    const text = String(value || "");
    if (/^https?:\/\//i.test(text)) return { kind: "url", value: text };
    if (/^blob:/i.test(text)) return { kind: "blob", value: text };
    const match = text.match(/^data:(image\/[\w.+-]+);base64,(.+)$/i);
    if (!match) return { kind: "unsupported", value: text };
    const bytes = Math.floor(match[2].length * 3 / 4) - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
    return { kind: "data", value: text, mime: match[1].toLowerCase(), bytes };
  }
  async function blobUrlToDataUri(value) {
    const response = await fetch(value);
    if (!response.ok) throw Error("读取本地图片失败（HTTP " + response.status + "）");
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type)) throw Error("本地图片格式不是 image/*（" + (blob.type || "未知") + "）");
    if (blob.size > MAX_REFERENCE_BYTES) throw Error("本地图片超过 5 MB，hfsyapi 不接受。");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || Error("本地图片读取失败"));
      reader.readAsDataURL(blob);
    });
  }
  async function normalizeReferenceImages(values) {
    const valid = [], failures = [];
    for (const [index, value] of values.entries()) {
      try {
        const info = referenceInfo(value);
        if (info.kind === "blob") valid.push(await blobUrlToDataUri(info.value));
        else if (info.kind === "unsupported") failures.push({ index, message: "第 " + (index + 1) + " 张参考图不是公开 URL、Blob URL 或图片 Data URI。" });
        else if (info.kind === "data" && info.bytes > MAX_REFERENCE_BYTES) failures.push({ index, message: "第 " + (index + 1) + " 张本地图片超过 5 MB，hfsyapi 不接受。" });
        else valid.push(info.value);
      } catch (error) {
        failures.push({ index, message: "第 " + (index + 1) + " 张参考图转换失败：" + (error?.message || error) });
      }
    }
    return { valid, failures };
  }
  function validateReferenceImages(values) {
    const valid = [], failures = [];
    values.forEach((value, index) => {
      const info = referenceInfo(value);
      if (info.kind === "unsupported" || info.kind === "blob") failures.push({ index, message: "第 " + (index + 1) + " 张参考图需要在提交前转换。" });
      else if (info.kind === "data" && info.bytes > MAX_REFERENCE_BYTES) failures.push({ index, message: "第 " + (index + 1) + " 张本地图片超过 5 MB，hfsyapi 不接受。" });
      else valid.push(value);
    });
    return { valid, failures };
  }
  function responseImage(data) {
    const candidates = [data?.result_url, data?.data?.result_url, data?.data?.[0]?.url, data?.output?.url, data?.output?.[0]?.url, data?.images?.[0]?.url, data?.data?.[0]?.b64_json, data?.data?.[0]?.b64_data];
    for (const value of candidates) {
      if (typeof value !== "string" || !value) continue;
      if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
      if (value.length > 100) return "data:image/png;base64," + value;
    }
    return "";
  }
  function isQueueFullError(message) { return /队列满|queue\s*(is\s*)?full|too many requests|capacity|overloaded/i.test(String(message || "")); }
  async function fetchAgnesWithRetry(options, index) {
    const waits = [0, 5000, 10000, 20000];
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (waits[attempt]) { log("Agnes 第 " + (index + 1) + " 张遇到队列繁忙，等待 " + (waits[attempt] / 1000) + " 秒后重试。", "info"); await sleep(waits[attempt]); }
      const response = await fetch("https://apihub.agnes-ai.com/v1/images/generations", options);
      const raw = await response.text();
      let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
      if (response.ok) return data;
      const message = data.error?.message || data.message || ("HTTP " + response.status);
      const requestId = response.headers.get("x-request-id") || data.request_id || data.error?.request_id || "";
      if (!isQueueFullError(message) || attempt === waits.length - 1) throw Error(message + (requestId ? " (request id: " + requestId + ")" : ""));
    }
    throw Error("Agnes 请求失败");
  }
  const ensureLicensed = async () => !window.License || await window.License.require();
  const handleDb = () => new Promise((resolve, reject) => { const r = indexedDB.open("image-workflow-settings", 1); r.onupgradeneeded = () => r.result.createObjectStore("handles"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  async function persistHandle(handle) { try { const db = await handleDb(); await new Promise((resolve, reject) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(handle, "saveFolder"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); } catch {} }
  async function restoreHandle() { try { const db = await handleDb(); const handle = await new Promise((resolve, reject) => { const tx = db.transaction("handles", "readonly"), r = tx.objectStore("handles").get("saveFolder"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); if (handle) { directoryHandle = handle; const perm = await handle.queryPermission({ mode: "readwrite" }); $("folder-status").textContent = perm === "granted" ? "已恢复本地文件夹授权" : "已记住文件夹，需重新授权"; } } catch {} }
  async function importLocalHistory() {
    if (!directoryHandle) return;
    try {
      if (await directoryHandle.queryPermission({ mode: "readwrite" }) !== "granted") return;
      const known = new Set(history.map(x => x.url).filter(Boolean));
      const imported = [];
      const readRecord = async (fileHandle, folderName) => {
        try {
          const file = await fileHandle.getFile();
          if (file.size > 12 * 1024 * 1024) return;
          const record = JSON.parse(await file.text());
          const files = Array.isArray(record["生成文件"]) ? record["生成文件"] : [];
          const createdAt = Date.parse(String(record["生成时间"] || "")) || Date.now();
          for (const item of files) {
            const url = item?.["图片URL"] || item?.url;
            if (!url || known.has(url)) continue;
            known.add(url);
            imported.push({ id: "local-" + createdAt + "-" + imported.length, url, prompt: record["提示词"] || "", provider: record["供应商"] || "", model: record["模型"] || "", createdAt, batchCount: Number(record["本批图片数量"]) || files.length, batchIndex: imported.length + 1, localFolder: folderName, recovered: true });
          }
        } catch {}
      };
      for await (const [name, handle] of directoryHandle.entries()) {
        if (handle.kind === "file" && name.toLowerCase().endsWith(".json")) await readRecord(handle, name);
        if (handle.kind !== "directory") continue;
        for await (const [childName, child] of handle.entries()) {
          if (child.kind === "file" && childName.toLowerCase().endsWith(".json")) await readRecord(child, name);
        }
      }
      if (!imported.length) return;
      history = history.concat(imported).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-200);
      await chrome.storage.local.set({ history });
      renderHistory();
      log("已从本地生成记录恢复 " + imported.length + " 条历史图片。");
    } catch (e) { log("读取本地历史记录失败：" + (e.message || "无法读取保存目录"), "error"); }
  }
  async function getPageTab() { const ts = await chrome.tabs.query({ active: true, currentWindow: true }); return ts.find(t => t.id && t.url && !/^chrome/.test(t.url)) || null; }
  async function removeCustomImage(customIndex) {
    if (customIndex < 0 || customIndex >= customImages.length) return;
    const oldRefs = refs();
    const removedGlobalIndex = images.length + customIndex;
    customImages.splice(customIndex, 1);
    const nextSelected = new Set();
    for (const selectedIndex of selected) {
      if (selectedIndex === removedGlobalIndex) continue;
      nextSelected.add(selectedIndex > removedGlobalIndex ? selectedIndex - 1 : selectedIndex);
    }
    selected = nextSelected;
    try { await persistCustomImageCache(customImages); } catch (error) { log("删除本地参考图后更新缓存失败：" + (error.message || error), "error"); }
    queueWorkspaceSave();
    renderImages();
    status("已删除第 " + (customIndex + 1) + " 张本地参考图。");
  }
  function renderImages() {
    const grid = $("image-grid"); if (!grid) return;
    const all = refs(); grid.innerHTML = ""; $("image-count").textContent = all.length ? all.length + " 张可用" : "";
    const done = new Set(history.flatMap(x => x.referenceImages || []));
    all.slice(0, 60).forEach((image, index) => {
      const b = document.createElement("div"); b.className = "image-option-wrap";
      const option = document.createElement("button"); option.type = "button"; option.className = "image-option" + (selected.has(index) ? " selected" : "") + (done.has(image.src) ? " processed" : "");
      const img = document.createElement("img"); img.src = image.src; option.appendChild(img);
      if (image.custom || done.has(image.src)) { const tag = document.createElement("span"); tag.className = "processed-badge"; tag.textContent = image.custom ? "本地" : "已处理"; b.appendChild(tag); }
      option.onclick = () => { if (!selected.has(index) && selected.size >= 6) return status("一次最多只能选择 6 张参考图。", true); selected.has(index) ? selected.delete(index) : selected.add(index); option.classList.toggle("selected"); queueWorkspaceSave(); updateButton(); };
      b.appendChild(option);
      if (image.custom) { const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-custom-image"; remove.textContent = "删除"; remove.title = "删除这张本地参考图"; remove.onclick = event => { event.stopPropagation(); removeCustomImage(index - images.length); }; b.appendChild(remove); }
      grid.appendChild(b);
    }); updateButton();
  }
  function updateButton() { if ($("generate")) $("generate").disabled = !selected.size || !$("prompt").value.trim() || !$("api-key").value.trim(); if ($("selection-note")) $("selection-note").textContent = "当前选择了 " + selected.size + " 张照片（本次最多 6 张）"; queueWorkspaceSave(); }
  async function scanImages() { status("正在扫描图片…"); try { const t = await getPageTab(); if (!t) throw Error("请切换到可读取的网页标签页。"); const r = await chrome.tabs.sendMessage(t.id, { type: "LIST_IMAGES", includePlaceholders: !$("filter-placeholders").checked }); images = r?.images || []; selected.clear(); renderImages(); status(""); } catch (e) { images = []; renderImages(); status(pageConnectionMessage(e), true); } }
  function setProgress(value) { const bar=$("progress-bar"), label=$("progress-percent"); const prev=Number(bar?.dataset.progress||0); const next=Math.max(prev,Math.min(100,Number(value)||0)); if(bar){bar.dataset.progress=String(next);bar.style.width=next+"%";} if(label) label.textContent=Math.round(next)+"%"; return next; }
  function thinking(on) { const box = $("thinking"); if (!box) return; box.hidden = !on; clearInterval(thinkingTimer); if (!on) { setProgress(100); thinkingStartedAt = 0; return; } const bar=$("progress-bar"); if(bar) delete bar.dataset.progress; thinkingStartedAt = Date.now(); setProgress(5); $("thinking-text").textContent = "任务已提交，等待中转站返回…"; thinkingTimer = setInterval(() => { const elapsed = Date.now() - thinkingStartedAt; const p = Math.min(90, 5 + (elapsed / 55000) * 80); setProgress(p); const shown = Number($("progress-bar")?.dataset.progress || p); $("thinking-text").textContent = shown < 22 ? "正在读取参考图…" : shown < 48 ? "正在理解提示词…" : shown < 78 ? "中转站生成中（通常需要 35–70 秒）…" : "等待图片返回与整理结果…"; }, 1000); }
  function filename(i, b) { const n = new Date(), x = b || {}, day = (x.day || n.toISOString().slice(0, 10)).replaceAll("-", ""), tm = (x.time || n.toTimeString().slice(0, 8)).replaceAll(":", ""), seq = String(x.seq || 1).padStart(3, "0"), count = x.count || resultUrls.length; return day + "-" + tm + "_" + count + "张_" + seq + "_" + String(i + 1).padStart(2, "0") + ".png"; }
  async function downloadFile(url, filename) { if (!(await ensureLicensed())) throw Error("当前插件未激活或授权已过期，请先完成激活。"); return new Promise((resolve, reject) => { chrome.downloads.download({ url, filename, saveAs: false }, id => { const err = chrome.runtime.lastError; if (err) reject(Error(err.message)); else resolve(id); }); }); }
  async function ensureLocalFolderReady() {
    if (saveMode() !== "local") return true;
    if (!directoryHandle) { const ok = confirm("当前保存方式为指定本地文件夹，但尚未选择文件夹。现在选择吗？"); if (!ok) { status("未选择本地保存文件夹，已取消操作。", true); return false; } await chooseFolder(); }
    if (!directoryHandle) { status("必须选择本地保存文件夹，或切换为浏览器下载模式。", true); return false; }
    try { const permission = await directoryHandle.queryPermission({ mode: "readwrite" }); if (permission !== "granted" && await directoryHandle.requestPermission({ mode: "readwrite" }) !== "granted") { status("本地文件夹尚未授权，已取消保存。", true); return false; } return true; } catch (e) { status("无法确认本地文件夹授权：" + (e.message || e), true); return false; }
  }
  async function saveBatch(force = false) {
    if (!resultUrls.length) { log("没有可保存的图片结果", "error"); return false; }
    const signature = resultUrls.map((url, index) => isRemoteImageUrl(url) ? url : "inline-result-" + index + "-" + String(url).length).join("|"), old = await chrome.storage.local.get(["lastSavedBatchSignature", "pendingSave"]);
    if (!force && old.lastSavedBatchSignature === signature && !old.pendingSave) return true;
    const pending = old.pendingSave && old.pendingSave.signature === signature ? old.pendingSave : null;
    const mode = pending?.saveMode === "local" || pending?.saveMode === "downloads" ? pending.saveMode : saveMode();
    if (mode === "local" && !(await ensureLocalFolderReady())) return false;
    const now = new Date(), day = now.toISOString().slice(0, 10), st = await chrome.storage.local.get("dailyBatchCounter"), c = st.dailyBatchCounter?.date === day ? st.dailyBatchCounter : { date: day, sequence: 0 };
    let batch, folder, record;
    if (pending) { batch = pending.batch; folder = pending.folder; record = pending.record; }
    else { c.sequence++; batch = { day, time: now.toTimeString().slice(0, 8), seq: c.sequence, count: resultUrls.length }; folder = day.replaceAll("-", "") + "-" + batch.time.replaceAll(":", "") + "_" + batch.count + "张_" + String(batch.seq).padStart(3, "0"); record = { 记录类型: "商品生图生成", 生成时间: now.toLocaleString("zh-CN"), 批次序号: c.sequence, 本批图片数量: resultUrls.length, 提示词: $("prompt").value.trim(), 参考图片: remoteImageUrls(selectedRefs()), 生成文件: resultUrls.map((u, i) => ({ 文件名: filename(i, batch), 图片URL: isRemoteImageUrl(u) ? u : "内嵌图片数据未写入记录" })) }; }
    await chrome.storage.local.set({ dailyBatchCounter: c, pendingSave: { signature, saveMode: mode, folder, batch, record, urls: remoteImageUrls(resultUrls), inlineResultCount: resultUrls.length - remoteImageUrls(resultUrls).length } });
    if (mode === "local") {
      try { const dir = await directoryHandle.getDirectoryHandle(folder, { create: true }); for (let i = 0; i < resultUrls.length; i++) { const blob = await (await fetch(resultUrls[i])).blob(); const f = await dir.getFileHandle(filename(i, batch), { create: true }); const w = await f.createWritable(); await w.write(blob); await w.close(); } const jf = await dir.getFileHandle(folder + ".json", { create: true }); const jw = await jf.createWritable(); await jw.write(JSON.stringify(record, null, 2)); await jw.close(); await chrome.storage.local.set({ lastSavedBatchSignature: signature }); await chrome.storage.local.remove("pendingSave"); status("已保存到指定本地文件夹：" + folder); log("已写入指定本地文件夹：" + folder); return true; } catch (e) { status("指定文件夹写入失败，未切换下载目录：" + (e.message || e), true); log("本地保存失败，未自动切换下载模式。", "error"); return false; }
    }
    try { const base = "商品生图/" + folder; for (let i = 0; i < resultUrls.length; i++) await downloadFile(resultUrls[i], base + "/" + filename(i, batch)); const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json;charset=utf-8" }), jurl = URL.createObjectURL(blob); await downloadFile(jurl, base + "/" + folder + ".json"); setTimeout(() => URL.revokeObjectURL(jurl), 10000); await chrome.storage.local.set({ lastSavedBatchSignature: signature }); await chrome.storage.local.remove("pendingSave"); status("已保存到浏览器下载目录的 商品生图/" + folder); log("已保存到浏览器下载目录：商品生图/" + folder); return true; } catch (e) { status("浏览器下载保存失败：" + (e.message || e), true); return false; }
  }
  function customValue(id, fallback = "") { return $(id)?.value.trim() || fallback; }
  function catalogEntry(model) { return (Array.isArray(window.MODEL_CATALOG) ? window.MODEL_CATALOG : []).find(item => item.id === model) || null; }
  const DEFAULT_SIZE_HTML = [
    '<optgroup label="1K 标清电商主图">',
    '  <option value="1024x1024">1:1 · 1024×1024 标清正方形</option>',
    '  <option value="1280x720">16:9 · 1280×720 横版宽屏</option>',
    '  <option value="720x1280">9:16 · 720×1280 竖版海报</option>',
    '  <option value="768x1024">3:4 · 768×1024 竖版主图</option>',
    '  <option value="1024x768">4:3 · 1024×768 横版主图</option>',
    '</optgroup>',
    '<optgroup label="2K 高清电商主图">',
    '  <option value="2048x2048">1:1 · 2048×2048 2K正方形</option>',
    '  <option value="2560x1440">16:9 · 2560×1440 2K横版</option>',
    '  <option value="1440x2560">9:16 · 1440×2560 2K竖版</option>',
    '  <option value="1536x2048">3:4 · 1536×2048 2K竖版</option>',
    '  <option value="2048x1536">4:3 · 2048×1536 2K横版</option>',
    '</optgroup>',
    '<optgroup label="4K 超清细节">',
    '  <option value="4096x4096">1:1 · 4096×4096 4K正方形</option>',
    '  <option value="3840x2160">16:9 · 3840×2160 4K横版</option>',
    '  <option value="2160x3840">9:16 · 2160×3840 4K竖版</option>',
    '  <option value="3072x4096">3:4 · 3072×4096 4K竖版</option>',
    '  <option value="4096x3072">4:3 · 4096×3072 4K横版</option>',
    '</optgroup>',
    '<optgroup label="纯尺寸代号">',
    '  <option value="1K">1K · 极简代号</option>',
    '  <option value="2K">2K · 极简代号</option>',
    '  <option value="4K">4K · 极简代号</option>',
    '</optgroup>'
  ].join("");
  function setCatalogSizeOptions(item) {
    const size = $("size");
    if (!size) return;
    const current = size.value;
    if (item && Array.isArray(item.sizes) && item.sizes.length) {
      size.innerHTML = item.sizes.map(value => '<option value="' + value + '">' + value + '</option>').join("");
      size.value = item.sizes.includes(current) ? current : item.sizes[0];
    } else {
      size.innerHTML = DEFAULT_SIZE_HTML;
      const exists = Array.from(size.options).some(opt => opt.value === current);
      size.value = exists ? current : "1024x1024";
    }
  }
  function installCatalogModelControl(value) {
    const select = $("custom-model-preset"); if (!select) return;
    const catalog = Array.isArray(window.MODEL_CATALOG) ? window.MODEL_CATALOG : [];
    select.innerHTML = '<option value="">自定义模型（手动填写）</option>' + catalog.map(item => '<option value="' + item.id.replaceAll('"', '&quot;') + '">' + item.name.replaceAll('<', '&lt;') + '</option>').join("");
    select.value = catalog.some(item => item.id === value) ? value : "";
    const update = () => {
      const item = catalogEntry(select.value), hint = $("custom-model-hint"), model = $("custom-model");
      if (!item) { setCatalogSizeOptions(null); if (hint) hint.hidden = true; return; }
      setCatalogSizeOptions(item);
      if (model) model.value = item.model;
      $("custom-protocol").value = item.protocol; $("custom-base-url").value = item.base;
      $("custom-generate-path").value = item.generatePath; $("custom-query-path").value = item.queryPath;
      $("custom-mode").value = item.mode; $("custom-input-mode").value = item.inputMode;
      $("custom-task-id-path").value = item.taskIdPaths; $("custom-status-path").value = item.statusPaths;
      $("custom-result-path").value = item.resultPaths; $("custom-success-states").value = item.successStates; $("custom-failure-states").value = item.failureStates;
      if (hint) { hint.hidden = false; hint.textContent = "单个任务最多参考图：" + item.maxReferenceImages + " 张；支持尺寸：" + item.sizes.join("、") + "。" + item.note; }
      updateCustomProviderUi();
    };
    select.onchange = async () => { update(); setProviderSaveStatus("内置模型配置已载入，请点击保存"); queueWorkspaceSave(); };
    update();
  }
  const CUSTOM_RESULT_PATHS = "data[0].url,data[0].b64_json,data[0].b64_data,result_url,data.result_url,output.url,output[0].url,images[0].url";
  function customConfig() { return { protocol: $("custom-protocol")?.value || "auto", base: cleanCustomBaseUrl(customValue("custom-base-url")), generatePath: customValue("custom-generate-path", "/images/generations"), queryPath: customValue("custom-query-path", "/images/generations/{task_id}"), model: customValue("custom-model", "gpt-image-2"), mode: $("custom-mode")?.value || "sync", inputMode: $("custom-input-mode")?.value || "openai", taskIdPaths: customValue("custom-task-id-path", "task_id,data.task_id,id"), statusPaths: customValue("custom-status-path", "status,data.status"), resultPaths: customValue("custom-result-path", CUSTOM_RESULT_PATHS), successStates: customValue("custom-success-states", "SUCCESS,COMPLETED,SUCCEEDED,DONE,FINISHED"), failureStates: customValue("custom-failure-states", "FAILURE,FAILED,ERROR,CANCELLED"), authMode: $("custom-auth-mode")?.value || "bearer", authHeader: customValue("custom-auth-header"), queryMethod: $("custom-query-method")?.value || "auto", catalog: catalogEntry($("custom-model-preset")?.value) }; }
  function resolveCustomProtocol(cfg) {
    if (cfg.protocol && cfg.protocol !== "auto") return cfg.protocol;
    let hostname = "";
    try { hostname = new URL(cfg.base).hostname.toLowerCase(); } catch {}
    if (hostname === "agnes-ai.com" || hostname.endsWith(".agnes-ai.com")) return "agnes";
    if (hostname === "hfsyapi.cn" || hostname.endsWith(".hfsyapi.cn")) return "hfsy";
    return "openai";
  }
  function cleanCustomBaseUrl(base) {
    let clean = String(base || "").trim().replace(/\/+$/, "");
    clean = clean.replace(/\/(images\/generations|image\/create|image\/query|images|v1\/image\/create|v1\/images\/generations)$/i, "");
    return clean.replace(/\/+$/, "");
  }
  function joinCustomUrl(base, path) {
    const root = cleanCustomBaseUrl(base);
    let suffix = String(path || "").trim() || "/";
    if (!suffix.startsWith("/")) suffix = "/" + suffix;
    if (/\/v1$/i.test(root) && /^\/v1(?:\/|$)/i.test(suffix)) suffix = suffix.slice(3) || "/";
    return root + suffix;
  }
  function resolvedCustomConfig(rawConfig) {
    const cfg = { ...rawConfig, protocol: resolveCustomProtocol(rawConfig), catalog: rawConfig.catalog || catalogEntry(rawConfig.model) };
    if (cfg.catalog) return { ...cfg, base: cfg.base || cfg.catalog.base || TASK_CATALOG_BASE_URL, protocol: "hfsy-task-catalog", generatePath: cfg.catalog.generatePath, queryPath: cfg.catalog.queryPath, queryMethod: cfg.catalog.queryMethod || "GET", mode: cfg.catalog.mode, inputMode: cfg.catalog.inputMode, taskIdPaths: cfg.catalog.taskIdPaths, statusPaths: cfg.catalog.statusPaths, resultPaths: cfg.catalog.resultPaths, successStates: cfg.catalog.successStates, failureStates: cfg.catalog.failureStates, catalogSize: cfg.catalog.sizes.includes($("size")?.value) ? $("size").value : cfg.catalog.sizes[0] };
    if (cfg.protocol === "hfsy-task-catalog") return { ...cfg, base: cfg.base || TASK_CATALOG_BASE_URL, generatePath: "/v1/image/create", queryPath: "/v1/image/query/{task_id}", queryMethod: "GET", mode: "async", inputMode: "reference", taskIdPaths: "task_id,id,data.task_id", statusPaths: "status,data.status,task_status,data.task_status", resultPaths: CUSTOM_RESULT_PATHS + ",images[0].url,data.images[0].url", successStates: "COMPLETED,SUCCESS,SUCCEEDED,DONE,FINISHED", failureStates: "FAILURE,FAILED,ERROR,CANCELLED" };
    if (cfg.protocol === "agnes") return { ...cfg, generatePath: "/v1/images/generations", mode: "sync", inputMode: "openai", resultPaths: "data[0].url,data[0].b64_json", authMode: "bearer", queryMethod: "auto" };
    if (cfg.protocol === "hfsy") return { ...cfg, generatePath: "/v1/images/generations", queryPath: "/v1/images/generations/{task_id}", mode: "async", inputMode: "reference", taskIdPaths: "task_id,data.task_id,id", statusPaths: "status,data.status", resultPaths: "result_url,data.result_url," + CUSTOM_RESULT_PATHS, successStates: "SUCCESS,COMPLETED", failureStates: "FAILURE,FAILED,ERROR,CANCELLED", authMode: "bearer", queryMethod: "auto" };
    if (cfg.protocol === "openai") return { ...cfg, generatePath: "/images/generations", mode: "auto", inputMode: "openai", resultPaths: CUSTOM_RESULT_PATHS, authMode: "bearer", queryMethod: "auto" };
    return { ...cfg, resultPaths: cfg.resultPaths || CUSTOM_RESULT_PATHS, queryMethod: cfg.queryMethod || "auto", mode: cfg.mode || "sync" };
  }
  function inferStoredCustomProtocol(state) {
    if (["auto", "agnes", "hfsy", "hfsy-task-catalog", "openai", "advanced"].includes(state.customProtocol)) return state.customProtocol;
    const changedMapping = state.customInputMode && state.customInputMode !== "openai" || state.customMode && state.customMode !== "sync" || state.customTaskIdPaths && state.customTaskIdPaths !== "task_id,data.task_id,id" || state.customStatusPaths && state.customStatusPaths !== "status,data.status" || state.customResultPaths && state.customResultPaths !== "data[0].url,result_url,data.result_url,data[0].b64_json";
    return changedMapping ? "advanced" : "auto";
  }
  function customPathValue(data, path) { const parts = String(path || "").trim().replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean); let value = data; for (const part of parts) { if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) return undefined; value = value[part]; } return value; }
  function customFirstValue(data, paths) { for (const path of String(paths || "").split(",").map(item => item.trim()).filter(Boolean)) { const value = customPathValue(data, path); if (value !== undefined && value !== null && value !== "") return { value, path }; } return { value: undefined, path: "" }; }
  function findImageDeep(value, key = "") {
    if (!value) return "";
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
      if (/b64|base64/i.test(key) && value.length > 100) return "data:image/png;base64," + value;
      return "";
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findImageDeep(item, key);
        if (found) return found;
      }
      return "";
    }
    if (typeof value === "object") {
      for (const k of ["url", "result_url", "image_url", "output_url", "download_url", "b64_json", "base64"]) {
        if (value[k]) {
          const found = findImageDeep(value[k], k);
          if (found) return found;
        }
      }
      for (const [k, v] of Object.entries(value)) {
        if (/result|output|image|url|file|content|data/i.test(k) && !/reference|input|source|prompt|error|message|status|task|model/i.test(k)) {
          const found = findImageDeep(v, k);
          if (found) return found;
        }
      }
    }
    return "";
  }
  function findTaskIdDeep(value) {
    if (!value || typeof value !== "object") return "";
    for (const key of ["task_id", "taskId", "id", "taskID"]) {
      if (value[key] && (typeof value[key] === "string" || typeof value[key] === "number")) return String(value[key]);
    }
    if (value.data && typeof value.data === "object") {
      for (const key of ["task_id", "taskId", "id"]) {
        if (value.data[key]) return String(value.data[key]);
      }
    }
    return "";
  }
  function customImageValue(data, paths) { const found = customFirstValue(data, paths); if (typeof found.value === "string") { if (/^https?:\/\//i.test(found.value) || /^data:image\//i.test(found.value)) return found.value; if (/b64|base64/i.test(found.path) && found.value.length > 100) return "data:image/png;base64," + found.value; } return responseImage(data) || findImageDeep(data); }
  function customErrorMessage(data, fallback) { return data?.error?.message || data?.data?.error?.message || data?.fail_reason || data?.data?.fail_reason || data?.message || fallback; }
  function hfsyFailureMessage(data, status, taskId) { const reason = data?.fail_reason || data?.data?.fail_reason || data?.error?.message || data?.data?.error?.message || data?.message || ("中转站任务失败（" + status + "）"); if (/do request failed/i.test(String(reason))) return "hfsyapi 上游服务失败（任务 " + (taskId || "未知") + "，HTTP " + status + "，quota=0，未扣费）：" + reason; return reason; }
  function customRequestBody(cfg, ref, overrides = {}) {
    const prompt = overrides.prompt ?? $("prompt").value.trim(), size = overrides.size ?? $("size").value;
    if (cfg.protocol === "agnes") {
      const ratio = { "1024x1024": "1:1", "1280x720": "16:9", "1024x768": "4:3", "768x1024": "3:4" };
      const body = { model: cfg.model, prompt, size: "1K", ratio: ratio[size] || "1:1" }; if (ref) body.extra_body = { image: [ref], response_format: "url" }; return body;
    }
    if (cfg.protocol === "hfsy") { const body = { model: cfg.model, prompt, size, n: 1, response_format: "b64_json" }; if (ref) body.reference_images = [ref]; return body; }
    if (cfg.protocol === "hfsy-task-catalog") { const body = { model: cfg.model, prompt, size: cfg.catalogSize || "1K" }; if (ref) body.reference_images = [ref]; return body; }
    const body = { model: cfg.model, prompt, size };
    if (ref) { if (cfg.inputMode === "reference") body.reference_images = [ref]; else if (cfg.inputMode === "image") body.image = [ref]; else { body.extra_body = { image: [ref], response_format: "url" }; if (cfg.inputMode === "both") body.reference_images = [ref]; } }
    return body;
  }
  async function customRequest(url, options, stage) { let response; try { response = await fetch(url, options); } catch (error) { throw Error(stage + "网络请求失败：" + (error?.message || "Failed to fetch") + "。请检查 Base URL、扩展站点权限和中转站可访问性。"); } const raw = await response.text(); let data; try { data = raw ? JSON.parse(raw) : {}; } catch { throw Error(stage + "返回不是 JSON（HTTP " + response.status + "）：" + raw.slice(0, 160)); } if (!response.ok) throw Error(customErrorMessage(data, stage + "失败（HTTP " + response.status + "）")); return data; }
  function customAuthHeaders(cfg, key) { const headers = { "Content-Type": "application/json" }; if (cfg.authMode === "x-api-key") headers["x-api-key"] = key; else if (cfg.authMode === "api-key") headers["api-key"] = key; else if (cfg.authMode === "custom-header" && cfg.authHeader) headers[cfg.authHeader] = key; else headers.Authorization = "Bearer " + key; return headers; }
  function validateCustomConfig(cfg, key) { if (!cfg.base) throw Error("Base URL 不能为空。"); let url; try { url = new URL(cfg.base); } catch { throw Error("Base URL 必须是有效的 http:// 或 https:// 地址。"); } if (!["http:", "https:"].includes(url.protocol)) throw Error("Base URL 只支持 http:// 或 https://。"); if (url.username || url.password || url.search || url.hash) throw Error("Base URL 不能包含账号、API Key、查询参数或片段。"); if (!key) throw Error("API Key 不能为空。"); if (!cfg.model) throw Error("模型名称不能为空。"); if (cfg.protocol === "advanced") { if (cfg.mode === "async" && !String(cfg.queryPath).includes("{task_id}")) throw Error("异步查询路径必须包含 {task_id}。"); if (!cfg.resultPaths || !cfg.taskIdPaths || !cfg.statusPaths) throw Error("高级配置的返回字段不能为空。"); const success = new Set(String(cfg.successStates).split(",").map(x => x.trim().toUpperCase()).filter(Boolean)); if (String(cfg.failureStates).split(",").map(x => x.trim().toUpperCase()).some(x => success.has(x))) throw Error("成功状态和失败状态不能重复。"); if (cfg.authMode === "custom-header" && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cfg.authHeader || "")) throw Error("自定义 Header 名称无效。"); } return url; }
  async function testCustomConfig() {
    const result = $("custom-test-result"), button = $("test-custom-config"), key = $("api-key")?.value.trim() || "";
    try { validateCustomConfig(resolvedCustomConfig(customConfig()), key); } catch (error) { if (result) { result.textContent = error.message; result.className = "custom-test-result error"; } return; }
    if (!confirm("测试配置会真实调用中转站，可能产生费用。是否继续？")) return;
    if (button) button.disabled = true; if (result) { result.textContent = "正在测试…"; result.className = "custom-test-result"; }
    try { const cfg = resolvedCustomConfig(customConfig()); const tested = await generateCustom(cfg, selectedRefs().slice(0, 1), key, { test: true, prompt: "Create a simple blue geometric icon on a clean white background.", size: "1024x1024" }); if (result) { result.textContent = tested.urls?.length ? "测试成功 · " + cfg.protocol + " · " + cfg.model : "测试未通过 · " + (tested.failures?.[0] || "没有返回图片"); result.className = "custom-test-result" + (tested.urls?.length ? " success" : " error"); } } catch (error) { if (result) { result.textContent = "测试失败 · " + (error?.message || error); result.className = "custom-test-result error"; } } finally { if (button) button.disabled = false; }
  }
  async function customQueryRequest(cfg, url, headers, taskId) {
    if (!/^https?:\/\//i.test(url)) throw Error("查询地址不是完整 URL：" + url);
    const preferred = String(cfg.queryMethod || "auto").toLowerCase() === "post" ? "POST" : "GET";
    const request = method => customRequest(url, { method, headers }, "任务 " + taskId + " 查询（" + method + "）");
    try { return await request(preferred); }
    catch (error) {
      const message = String(error?.message || error);
      const incompatible = /Invalid URL\s*\(\s*(GET|POST)|method not allowed|HTTP\s*(405|501)|不支持.*方法/i.test(message);
      if (String(cfg.queryMethod || "auto").toLowerCase() === "auto" && incompatible) {
        const fallback = preferred.toUpperCase() === "GET" ? "POST" : "GET";
        log("任务 " + taskId + " 查询接口拒绝 " + preferred.toUpperCase() + "，兼容尝试 " + fallback + "。", "info");
        return await request(fallback);
      }
      throw error;
    }
  }
  async function generateCustom(rawConfig, refs, key, options = {}) {
    const cfg = resolvedCustomConfig({ ...customConfig(), ...rawConfig });
    if (!cfg.base) throw Error("请先填写自定义中转站 Base URL，或重新选择一个内置模型预设。");
    try { const probe = new URL(joinCustomUrl(cfg.base, cfg.generatePath)); if (!/^https?:$/i.test(probe.protocol)) throw Error("Base URL 必须以 http:// 或 https:// 开头"); } catch (error) { throw Error("自定义中转站 Base URL 无效：" + (error.message || error)); }
    const headers = customAuthHeaders(cfg, key);
    const urls = [], failures = [];
    const inputRefs = refs.length ? refs : (options.test ? [""] : []);
    const recordFailure = (index, stage, error) => { const message = "第 " + (index + 1) + " 张" + stage + "失败：" + (error?.message || error); failures.push(message); log(message, "error"); };
    if (cfg.mode === "sync") {
      for (let index = 0; index < inputRefs.length; index++) {
        try { log("自定义中转站：正在请求第 " + (index + 1) + " / " + inputRefs.length + " 张同步结果。"); const data = await customRequest(joinCustomUrl(cfg.base, cfg.generatePath), { method: "POST", headers, body: JSON.stringify(customRequestBody(cfg, inputRefs[index], options)) }, "同步生成请求"); const url = customImageValue(data, cfg.resultPaths + "," + CUSTOM_RESULT_PATHS); if (!url) throw Error("未在结果字段中找到图片。当前字段：" + cfg.resultPaths); urls.push(url); }
        catch (error) { recordFailure(index, "同步生成", error); }
      }
    } else {
      const tasks = [];
      for (let index = 0; index < inputRefs.length; index++) {
        try { log("自定义中转站：正在提交第 " + (index + 1) + " / " + inputRefs.length + " 张异步任务。"); const data = await customRequest(joinCustomUrl(cfg.base, cfg.generatePath), { method: "POST", headers, body: JSON.stringify(customRequestBody(cfg, inputRefs[index], options)) }, "异步任务提交"); const directUrl = customImageValue(data, cfg.resultPaths + "," + CUSTOM_RESULT_PATHS); if (directUrl) { urls.push(directUrl); log("自定义中转站：第 " + (index + 1) + " 张已直接返回图片。"); continue; } const task = customFirstValue(data, cfg.taskIdPaths); const taskId = task.value || findTaskIdDeep(data); if (!taskId) throw Error("未在任务 ID 字段中找到任务编号。当前字段：" + cfg.taskIdPaths); tasks.push({ id: String(taskId), index }); log("自定义中转站：第 " + (index + 1) + " 张已提交，任务 ID：" + taskId); }
        catch (error) { recordFailure(index, "异步提交", error); }
      }
      const successStates = new Set(cfg.successStates.split(",").map(value => value.trim().toUpperCase()).filter(Boolean));
      const failureStates = new Set(cfg.failureStates.split(",").map(value => value.trim().toUpperCase()).filter(Boolean));
      for (const task of tasks) {
        const startedAt = Date.now(); let complete = false;
        while (!complete && Date.now() - startedAt < 600000) {
          try { const path = cfg.queryPath.replace("{task_id}", encodeURIComponent(task.id)); const data = await customQueryRequest(cfg, joinCustomUrl(cfg.base, path), headers, task.id); const state = String(customFirstValue(data, cfg.statusPaths).value || data?.status || data?.data?.status || data?.task_status || "").toUpperCase(); const url = customImageValue(data, cfg.resultPaths + "," + CUSTOM_RESULT_PATHS); if (url) { urls.push(url); log("自定义中转站：任务 " + task.id + " 已返回图片。"); complete = true; break; } if (failureStates.has(state)) throw Error(customErrorMessage(data, "状态为 " + state)); if (successStates.has(state)) throw Error("任务状态为 " + state + "，但结果字段未找到图片。当前字段：" + cfg.resultPaths); if (state) log("自定义中转站：任务 " + task.id + " 当前状态 " + state + "，继续等待。"); }
          catch (error) { recordFailure(task.index, "异步查询", error); complete = true; break; }
          await sleep(2500);
        }
        if (!complete) recordFailure(task.index, "异步查询", "等待超过 10 分钟，已停止查询。");
      }
    }
    if (options.test) return { urls, failures, protocol: cfg.protocol, model: cfg.model };
    generateCustom.lastFailures = failures;
    if (!urls.length && failures.length) throw Error("自定义中转站没有成功图片，请查看执行日志。");
    if (failures.length) log("自定义中转站本批完成：成功 " + urls.length + " 张，失败 " + failures.length + " 张。", "error");
    return urls;
  }
  async function generate() {
    const rawRefs = selectedRefs(), key = $("api-key").value.trim(), provider = $("provider").value;
    if (!rawRefs.length) return;
    const checked = await normalizeReferenceImages(rawRefs);
    checked.failures.forEach(item => log(item.message, "error"));
    if (!checked.valid.length) { status("没有可提交的参考图片，请检查图片格式和大小。", true); return; }
    const rs = checked.valid;
    if (saveMode() === "local") { if (!directoryHandle) { const ok = confirm("尚未选择本地保存文件夹，是否现在选择？"); if (!ok) { status("未选择本地保存文件夹，已取消生成。", true); return; } await chooseFolder(); if (!directoryHandle) { status("必须选择本地保存文件夹后才能生成。", true); return; } } try { const perm = await directoryHandle.queryPermission({ mode: "readwrite" }); if (perm !== "granted") { const granted = await directoryHandle.requestPermission({ mode: "readwrite" }); if (granted !== "granted") { status("本地文件夹尚未授权，已取消生成。", true); return; } } } catch (e) { status("无法确认本地文件夹授权：" + e.message, true); return; } }
    $("generate").disabled = true; thinking(true); resultUrls = []; batchTasks = []; currentTask = null; await writeCurrentTask({ provider, model: selectedProviderModel(provider), status: "GENERATING", startedAt: Date.now(), total: rs.length, finished: 0, resultUrls: [], resultCacheIds: [], failures: [], error: "", prompt: $("prompt").value.trim() }); queueWorkspaceSave({ status: "GENERATING" });
    try {
      if (provider === "custom") {
        const cfg = customConfig(); resultUrls.push(...await generateCustom(cfg, rs, key)); const customFailures = Array.isArray(generateCustom.lastFailures) ? generateCustom.lastFailures : []; batchTasks = rs.map((ref, index) => index < resultUrls.length ? ({ taskId: "custom-" + (index + 1), status: "SUCCESS", url: resultUrls[index], referenceImage: ref, imageIndex: index }) : ({ taskId: "custom-" + (index + 1), status: "FAILURE", error: customFailures[index - resultUrls.length] || "未返回图片", referenceImage: ref, imageIndex: index })); await syncCurrentTask(); setProgress(92); await finish("自定义中转站生成完成，共 " + resultUrls.length + " 张。");
      } else if (provider === "agnes") {
        const ratio = { "1024x1024": "1:1", "1280x720": "16:9", "1024x768": "4:3", "768x1024": "3:4" }, model = selectedProviderModel("agnes");
        for (let i = 0; i < rs.length; i++) {
          try {
            const data = await fetchAgnesWithRetry({ method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: $("prompt").value.trim(), size: "1K", ratio: ratio[$("size").value] || "1:1", extra_body: { image: [rs[i]], response_format: "url" } }) }, i);
            const url = responseImage(data); if (!url) throw Error("Agnes 返回中没有图片"); resultUrls.push(url); batchTasks.push({ taskId: "agnes-" + (i + 1), status: "SUCCESS", url, referenceImage: rs[i] }); setProgress(Math.round((i + 1) / rs.length * 92)); await syncCurrentTask();
          } catch (e) { batchTasks.push({ taskId: "agnes-" + (i + 1), status: "FAILURE", error: e.message || String(e), referenceImage: rs[i] }); log("Agnes 第 " + (i + 1) + " 张失败：" + (e.message || e), "error"); await syncCurrentTask(); }
        }
        if (resultUrls.length) await finish("Agnes 生成完成，共 " + resultUrls.length + " 张。"); else throw Error("Agnes 没有成功返回图片，请查看执行日志。");
      } else {
        const model = selectedProviderModel("hfsy"), tasks = [], startedAt = Date.now();
        let backgroundStarted = false;
        await persistHfsySubmissionSnapshot(startedAt, model, rs.length);
        for (let i = 0; i < rs.length; i++) {
          try {
            const response = await fetch("https://www.hfsyapi.cn/v1/images/generations", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: $("prompt").value.trim(), size: $("size").value, response_format: "b64_json", reference_images: [rs[i]], n: 1 }) });
            const raw = await response.text(); let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
            const direct = responseImage(data);
            if (response.ok && direct) { resultUrls.push(direct); batchTasks.push({ provider: "hfsy", imageIndex: i, updatedAt: Date.now(), taskId: "direct-" + (i + 1), status: "SUCCESS", url: direct, referenceImage: rs[i] }); await persistHfsySubmissionSnapshot(startedAt, model, rs.length); log("hfsyapi 第 " + (i + 1) + " 张已直接返回图片。"); await syncCurrentTask(); continue; }
            if (!response.ok) throw Error(data.error?.message || data.message || "提交任务失败（HTTP " + response.status + "）");
            const id = data.task_id || data.id || data.data?.task_id; if (!id) throw Error("接口未返回 task_id 或图片结果");
            tasks.push({ provider: "hfsy", imageIndex: i, updatedAt: Date.now(), taskId: String(id), status: "QUEUED", referenceImage: rs[i] });
            batchTasks.push(tasks[tasks.length - 1]);
            await persistHfsySubmissionSnapshot(startedAt, model, rs.length);
            if (!backgroundStarted) {
              backgroundStarted = true;
              chrome.runtime.sendMessage({ type: "START_HFSY_POLL", apiKey: key }).catch(error => log("后台轮询接管启动失败：" + (error?.message || error), "error"));
            }
          } catch (e) { const msg = e.message || "提交任务异常"; batchTasks.push({ provider: "hfsy", imageIndex: i, updatedAt: Date.now(), taskId: "submit-" + (i + 1), status: "FAILURE", error: msg, referenceImage: rs[i] }); await persistHfsySubmissionSnapshot(startedAt, model, rs.length); log("hfsyapi 第 " + (i + 1) + " 张失败：" + msg, "error"); await syncCurrentTask(); }
        }
        batchTasks = batchTasks.filter((task, index, list) => list.findIndex(item => item.taskId === task.taskId) === index);
        if (tasks.length) { await chrome.storage.local.set({ activeTask: { batch: true, provider: "hfsy", model, total: rs.length, startedAt, updatedAt: Date.now(), status: "POLLING", resultUrls: remoteImageUrls(resultUrls) }, batchTasks }); await syncCurrentTask("POLLING"); queueWorkspaceSave({ status: "POLLING" }); await pollHfsy(key); }
        else if (resultUrls.length) await finish("hfsyapi 生成完成，共 " + resultUrls.length + " 张。");
        else throw Error("hfsyapi 没有成功返回图片，请查看执行日志。");
      }
    } catch (e) { const partial = resultUrls.length > 0; thinking(false); logTaskError("finish", e); await writeCurrentTask({ status: partial ? "COMPLETE" : "FAILED", error: partial ? "结果已返回，但收尾步骤失败：" + (e.message || e) : (e.message || String(e)), finished: Math.min(currentTask?.total || 0, resultUrls.length + taskFailures().length), succeeded: resultUrls.length, failed: taskFailures().length, resultUrls: remoteImageUrls(resultUrls), failures: taskFailures() }); $("thinking").hidden = false; renderCurrentTask(); status(partial ? "结果已返回，但收尾步骤失败，请查看执行日志。" : e.message, true); if (partial) { try { renderResults(); } catch (renderError) { logTaskError("finish", renderError); } } }
    finally { updateButton(); }
  }
  async function pollHfsy(key) { const check = async () => { let done = 0, failed = 0; for (const t of batchTasks) { if (t.status === "SUCCESS" || t.status === "FAILURE") { t.status === "SUCCESS" ? done++ : failed++; continue; } try { const response = await fetch("https://www.hfsyapi.cn/v1/images/generations/" + encodeURIComponent(t.taskId), { headers: { Authorization: "Bearer " + key } }); const raw = await response.text(); let d = {}; try { d = raw ? JSON.parse(raw) : {}; } catch { d = { message: raw }; } const apiError = d.error || d.data?.error; const state = String(d.status || d.data?.status || (apiError ? "FAILURE" : "")).toUpperCase(); const image = responseImage(d); if (response.ok && image) { t.status = "SUCCESS"; t.url = image; done++; log("任务 " + t.taskId + " 已返回图片", "info"); continue; } if (!response.ok || apiError || ["FAILURE", "FAILED", "ERROR", "CANCELLED"].includes(state)) { t.status = "FAILURE"; t.error = apiError?.message || d.fail_reason || d.data?.fail_reason || d.message || "中转站任务失败"; failed++; log("任务 " + t.taskId + " 失败：" + t.error, "error"); continue; } if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(state)) { t.status = "FAILURE"; t.error = "任务成功但没有图片结果"; failed++; log("任务 " + t.taskId + " 成功但缺少图片结果", "error"); } } catch (e) { log("任务 " + t.taskId + " 查询异常，继续等待：" + (e.message || "网络错误"), "error"); } } const total = batchTasks.length, finished = done + failed; resultUrls = batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url); await syncCurrentTask("POLLING"); setProgress(total ? Math.round(finished / total * 92) : 92); $("thinking-text").textContent = "已完成 " + finished + " / " + total + " 张，成功 " + done + " 张，失败 " + failed + " 张…"; if (finished >= total) { clearInterval(pollTimer); await finish("生成完成：成功 " + resultUrls.length + " 张，失败 " + failed + " 张。"); } }; await check(); if (batchTasks.some(t => !["SUCCESS", "FAILURE"].includes(t.status))) pollTimer = setInterval(check, 2500); }
  async function pollHfsySafe(key) {
    const startedAt = Date.now();
    let finished = false;
    const finishOnce = async (message) => {
      if (finished) return;
      finished = true;
      clearInterval(pollTimer);
      pollTimer = null;
      resultUrls = batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url);
      await chrome.storage.local.set({ batchTasks, lastResults: remoteImageUrls(resultUrls), activeTask: null });
      await finish(message);
    };
    const check = async () => {
      if (finished) return;
      let done = 0, failed = 0;
      for (const t of batchTasks) {
        if (t.status === "SUCCESS") { done++; continue; }
        if (t.status === "FAILURE") { failed++; continue; }
        try {
          const response = await fetch("https://www.hfsyapi.cn/v1/images/generations/" + encodeURIComponent(t.taskId), { headers: { Authorization: "Bearer " + key } });
          const d = await response.json();
          const findImage = (value, key = "") => {
            if (!value) return "";
            if (typeof value === "string") {
              if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
              if (/b64|base64/i.test(key) && value.length > 100) return "data:image/png;base64," + value;
              return "";
            }
            if (Array.isArray(value)) { for (const item of value) { const found = findImage(item, key); if (found) return found; } return ""; }
            if (typeof value === "object") {
              for (const k of ["url", "result_url", "image_url", "output_url", "download_url", "b64_json", "base64"]) { const found = findImage(value[k], k); if (found) return found; }
              for (const [k, v] of Object.entries(value)) { if (/result|output|image|url|file|content|data/i.test(k) && !/reference|input|source|prompt|error|message|status|task|model/i.test(k)) { const found = findImage(v, k); if (found) return found; } }
            }
            return "";
          };
          const imageUrl = responseImage(d) || findImage(d);
          const apiError = d.error || d.data?.error;
          const state = String(d.status || d.data?.status || (apiError ? "FAILURE" : "")).toUpperCase();
          if (imageUrl && response.ok) {
            t.status = "SUCCESS";
            t.url = imageUrl;
            log("任务 " + t.taskId + " 已返回图片", "info");
          } else if (!response.ok || apiError || ["FAILURE", "FAILED", "ERROR"].includes(state)) {
            t.status = "FAILURE";
            t.error = hfsyFailureMessage(d, response.status, t.taskId);
            log("任务 " + t.taskId + " 失败：" + t.error, "error");
          } else if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(state)) {
            t.status = "FAILURE";
            t.error = "任务成功但没有返回图片 URL";
            log("任务 " + t.taskId + " 成功但缺少图片 URL", "error");
          } else if (state && !["QUEUED", "PENDING", "PROCESSING", "RUNNING", "IN_PROGRESS", "CREATED"].includes(state)) {
            log("任务 " + t.taskId + " 返回未知状态：" + state, "error");
          }
        } catch (e) {
          log("任务 " + t.taskId + " 查询异常，继续等待：" + (e.message || "网络错误"), "error");
        }
        if (t.status === "SUCCESS") done++;
        else if (t.status === "FAILURE") failed++;
      }
      await chrome.storage.local.set({ batchTasks });
      const total = batchTasks.length;
      const unresolved = batchTasks.filter(t => !["SUCCESS", "FAILURE"].includes(t.status));
      setProgress(total ? Math.round((done + failed) / total * 92) : 92);
      $("thinking-text").textContent = "已完成 " + (done + failed) + " / " + total + " 张，成功 " + done + " 张，失败 " + failed + " 张…";
      if (!unresolved.length) return finishOnce("生成结束：成功 " + done + " 张，失败 " + failed + " 张。");
      if (Date.now() - startedAt >= 600000) {
        unresolved.forEach(t => { t.status = "FAILURE"; t.error = "查询超时，已停止等待（不会重新扣费）"; });
        log("部分任务查询超时，已停止等待并保留已成功图片。", "error");
        return finishOnce("生成结束：成功 " + done + " 张，失败 " + (failed + unresolved.length) + " 张，未完成任务已停止等待。");
      }
    };
    await check();
    if (!finished && batchTasks.some(t => !["SUCCESS", "FAILURE"].includes(t.status))) pollTimer = setInterval(check, 2500);
  }
  async function watchHfsyInBackground(key) {
    let completed = false;
    const sync = async () => {
      if (completed) return true;
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: "POLL_HFSY_NOW", apiKey: key });
      } catch (e) {
        log("后台轮询连接失败，改用当前窗口继续查询：" + (e.message || "Failed to fetch"), "error");
        completed = true;
        await pollHfsySafe(key);
        return true;
      }
      if (!response?.ok) {
        log("后台轮询暂时无法查询，改用当前窗口继续查询：" + (response?.error || "后台未返回状态"), "error");
        completed = true;
        await pollHfsySafe(key);
        return true;
      }
      const state = await chrome.storage.local.get(["batchTasks", "activeTask", "lastResults"]);
      if (!Array.isArray(state.batchTasks) || !state.batchTasks.length) return false;
      batchTasks = state.batchTasks;
      resultUrls = Array.isArray(state.lastResults) ? state.lastResults : batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url);
      const total = batchTasks.length;
      const done = batchTasks.filter(t => t.status === "SUCCESS").length;
      const failed = batchTasks.filter(t => t.status === "FAILURE").length;
      setProgress(total ? Math.round((done + failed) / total * 92) : 92);
      $("thinking-text").textContent = "已完成 " + (done + failed) + " / " + total + " 张，成功 " + done + " 张，失败 " + failed + " 张…";
      if (batchTasks.every(t => ["SUCCESS", "FAILURE"].includes(t.status))) {
        completed = true;
        resultUrls = batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url);
        await finish("生成结束：成功 " + done + " 张，失败 " + failed + " 张。");
        return true;
      }
      return false;
    };
    if (await sync()) return;
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => { try { if (await sync()) { clearInterval(pollTimer); pollTimer = null; } } catch (e) { log("读取后台任务状态失败：" + (e.message || "网络错误"), "error"); } }, 2500);
  }
  async function persistHistory() {
    const persistableUrls = resultUrls.filter(value => isRemoteImageUrl(value) || /^data:image\//i.test(String(value || "")));
    if (!persistableUrls.length) { if (resultUrls.length) log("本次结果没有可识别的图片地址，未写入插件历史记录。", "info"); return; }
    const signature = JSON.stringify({ urls: persistableUrls, prompt: $("prompt")?.value.trim() || "", provider: $("provider")?.value || "", model: selectedProviderModel($("provider")?.value || "agnes"), tasks: batchTasks.map(t => t.taskId) });
    const current = await chrome.storage.local.get('lastHistoryBatchSignature');
    if (current.lastHistoryBatchSignature === signature) return;
    const now = Date.now();
    const refsUsed = selectedRefs().length ? remoteImageUrls(selectedRefs()) : remoteImageUrls([...new Set(batchTasks.map(t => t.referenceImage).filter(Boolean))]);
    const promptText = $("prompt")?.value.trim() || "";
    const entries = persistableUrls.map((url, index) => ({
      id: now + '-' + index,
      url: isRemoteImageUrl(url) ? url : "",
      hasInlineImage: /^data:image\//i.test(url),
      prompt: promptText,
      provider: $("provider")?.value || "",
      model: selectedProviderModel($("provider")?.value || "agnes"),
      referenceImages: refsUsed,
      createdAt: now,
      batchCount: resultUrls.length,
      batchIndex: index + 1,
      failedCount: batchTasks.filter(t => t.status === "FAILURE").length
    }));
    history = history.concat(entries).slice(-200);
    await chrome.storage.local.set({ history, lastHistoryBatchSignature: signature });
  }
  async function finish(message) {
    const successful = resultUrls.slice();
    const failures = taskFailures();
    const total = currentTask?.total || Math.max(successful.length + failures.length, batchTasks.length);
    const terminalError = successful.length ? "" : (failures[0]?.error || "任务没有返回图片");
    const inlineIds = [];
    for (let index = 0; index < successful.length; index++) {
      const value = successful[index];
      if (!/^data:image\//i.test(String(value || ""))) continue;
      try { inlineIds.push(await cacheBlob(await dataUrlBlob(value))); }
      catch (error) { logTaskError("persist", error, index); }
    }
    // P0.1 A: storage first. A rendering problem must never erase successful results.
    try {
      await chrome.storage.local.set({ lastResults: remoteImageUrls(successful), workspaceResultCacheIds: inlineIds, activeTask: null });
      await writeCurrentTask({ status: successful.length ? "COMPLETE" : "FAILED", finished: Math.min(total, successful.length + failures.length), succeeded: successful.length, failed: failures.length, resultUrls: remoteImageUrls(successful), resultCacheIds: inlineIds, failures, error: terminalError }, { render: false });
    } catch (error) {
      logTaskError("persist", error);
      try { await writeCurrentTask({ status: successful.length ? "COMPLETE" : "FAILED", finished: Math.min(total, successful.length + failures.length), succeeded: successful.length, failed: failures.length, resultUrls: remoteImageUrls(successful), resultCacheIds: inlineIds, failures, error: successful.length ? "结果已返回，但状态持久化失败" : (error.message || String(error)) }, { render: false }); } catch (stateError) { logTaskError("persist", stateError); }
    }
    try { await persistHistory(); } catch (error) { logTaskError("persist", error); }
    let saved = true;
    if ($("auto-save")?.checked) { try { saved = await saveBatch(true); } catch (error) { saved = false; logTaskError("save", error); } }
    else log("已关闭自动保存，本次结果仅展示在插件中。", "info");
    if (!saved) log("结果已返回，但本地保存未完成。", "error");
    if (document.querySelector('input[name="upload-mode"]:checked')?.value === "auto" && successful.length) {
      try { status(message + " 正在自动上传到店小秘…"); await replaceToDianxiaomi(); }
      catch (error) { logTaskError("upload", error); status(message + " 但自动上传失败，请查看执行日志。", true); }
    }
    try {
      thinking(false); $("thinking").hidden = false; setProgress(100); renderCurrentTask(); renderResults();
      status(saved ? message : message + " 但保存未完成，请查看执行日志。", !saved);
      renderHistory();
      renderImages();
    } catch (error) { logTaskError("render", error); }
  }
  async function replaceToDianxiaomi() { const t = await getPageTab(); if (!t || t.url.indexOf("dianxiaomi.com/web/amazon/edit") < 0) return status("请先切换到店小秘产品编辑页。", true); const us = resultUrls.filter(u => /^https?:\/\//i.test(u)); if (!us.length) return status("没有可追加的图片 URL，原有图片保持不变。", true); status("正在追加图片到店小秘…"); try { const r = await chrome.tabs.sendMessage(t.id, { type: "AUTO_REPLACE_DIANXIAOMI", urls: us, secondsPerImage: 1000 }); if (!r?.ok) throw Error(r?.error || "自动追加上传失败"); status("网络图片追加并校验成功：新增 " + (r.added || us.length) + " 张，当前共 " + r.uploaded + " 张图片。"); } catch (e) { status(pageConnectionMessage(e), true); } }
  function renderResults() { const grid = $("result-grid"); grid.innerHTML = ""; $("results").hidden = false; const head = $("download-all").parentElement; if (!$("replace-all")) { const b = document.createElement("button"); b.id = "replace-all"; b.className = "text-button"; b.textContent = "全部上传到店小秘"; b.onclick = replaceToDianxiaomi; head.appendChild(b); } resultUrls.forEach((url, index) => { const c = document.createElement("div"); c.className = "result-card"; const im = document.createElement("img"); im.src = url; const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.download = filename(index); a.textContent = "打开/下载"; c.append(im, a); grid.appendChild(c); }); }
  function renderHistory() { const list = $("history-list"); list.innerHTML = history.length ? history.slice().reverse().map(x => { const image = x.url ? '<img src="' + x.url + '">' : '<div class="history-placeholder">已保存图片</div>'; const link = x.url ? '<a target="_blank" href="' + x.url + '">打开</a>' : '<span class="muted">本地文件或内嵌结果</span>'; return '<div class="history-item">' + image + '<div><p>' + String(x.prompt || "").replaceAll("<", "&lt;") + '</p><time>' + new Date(x.createdAt).toLocaleString() + '</time></div>' + link + '</div>'; }).join("") : '<p class="muted">暂无生成记录</p>'; }
  async function chooseFolder() { if (!window.showDirectoryPicker) return status("当前浏览器不支持选择文件夹，无法使用本地文件夹模式。", true); try { directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" }); await persistHandle(directoryHandle); $("folder-status").textContent = "已选择本地文件夹，生成后直接保存"; status("本地文件夹已授权并持久化。"); } catch (e) { if (e.name !== "AbortError") status("选择文件夹失败：" + e.message, true); } }
  function bind() { $("refresh").onclick = scanImages; $("rescan").onclick = scanImages; $("filter-placeholders").onchange = scanImages; $("generate").onclick = generate; $("prompt").oninput = updateButton; $("api-key").oninput = () => { updateButton(); setProviderSaveStatus("密钥已更改，请点击保存"); }; $("save-provider-config").onclick = () => saveProviderConfig(true); $("save-custom-provider-config")?.addEventListener("click", () => saveProviderConfig(true, "custom")); $("upload-custom").onclick = () => $("custom-images").click(); $("custom-images").onchange = async e => { const added = await Promise.all([...e.target.files].map(f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }))); customImages.push(...added); customImages = customImages.slice(-30); await persistCustomImageCache(customImages); e.target.value = ""; renderImages(); status("已添加本地参考图 " + added.length + " 张，请在列表中选择。"); }; $("choose-folder").onclick = chooseFolder; $("download-all").onclick = () => saveBatch(true); $("clear-log").onclick = async () => { executionLog=[]; await chrome.storage.local.set({executionLog:[]}); renderLog(); }; $("clear-history").onclick = async () => { history = []; await chrome.storage.local.set({ history: [] }); renderHistory(); renderImages(); }; document.querySelectorAll('input[name="upload-mode"]').forEach(e => e.onchange = () => chrome.storage.local.set({ uploadMode: e.value })); $("provider").onchange = () => switchProviderConfig($("provider").value); ["custom-base-url", "custom-model", "custom-generate-path", "custom-query-path", "custom-mode"].forEach(id => $(id)?.addEventListener("input", () => { updateCustomProviderUi(); setProviderSaveStatus("配置已更改，请点击保存"); })); $("custom-protocol")?.addEventListener("change", () => { updateCustomProviderUi(); setProviderSaveStatus("配置已更改，请点击保存"); }); }
  chrome.storage.local.get(["apiKey", "prompt", "filterPlaceholders", "autoSave", "history", "lastResults", "provider", "uploadMode", "executionLog", "customProtocol", "customBaseUrl", "customGeneratePath", "customQueryPath", "customModel", "customModelPreset", "customMode", "customInputMode", "customTaskIdPaths", "customStatusPaths", "customResultPaths", "customSuccessStates", "customFailureStates", "activeTask", "batchTasks"], async s => { const cleanedLegacy = await storageCleanupReady; s = await chrome.storage.local.get(["apiKey", "prompt", "filterPlaceholders", "autoSave", "history", "lastResults", "provider", "uploadMode", "executionLog", "customProtocol", "customBaseUrl", "customGeneratePath", "customQueryPath", "customModel", "customModelPreset", "customMode", "customInputMode", "customTaskIdPaths", "customStatusPaths", "customResultPaths", "customSuccessStates", "customFailureStates", "activeTask", "batchTasks"]); if (!providerUiHydrated) { /* 当前供应商密钥由供应商专属初始化流程加载，避免异步读取覆盖 */ } $("prompt").value = s.prompt || ""; $("filter-placeholders").checked = s.filterPlaceholders !== false; $("auto-save").checked = true; history = Array.isArray(s.history) ? s.history : []; executionLog = Array.isArray(s.executionLog) ? s.executionLog : []; resultUrls = Array.isArray(s.lastResults) ? s.lastResults : []; $("provider").value = s.provider || "agnes"; $("custom-protocol").value = inferStoredCustomProtocol(s); $("custom-base-url").value=s.customBaseUrl||""; $("custom-generate-path").value=s.customGeneratePath||"/images/generations"; $("custom-query-path").value=s.customQueryPath||"/images/generations/{task_id}"; $("custom-model").value=s.customModel||"gpt-image-2"; $("custom-mode").value=s.customMode||"sync"; $("custom-input-mode").value=s.customInputMode||"openai"; if ($("custom-provider-panel")) $("custom-provider-panel").hidden = $("provider").value !== "custom"; installCatalogModelControl(s.customModelPreset || ""); updateCustomProviderUi(); const mode = s.uploadMode || "manual"; const radio = document.querySelector('input[name="upload-mode"][value="' + mode + '"]'); if (radio) radio.checked = true; await restoreHandle(); const pending=await chrome.storage.local.get("pendingSave"); if(pending.pendingSave && Array.isArray(pending.pendingSave.urls) && pending.pendingSave.urls.length){ resultUrls=pending.pendingSave.urls; log("发现未完成的保存任务，正在重试…"); await saveBatch(true); } renderHistory(); renderLog(); if (cleanedLegacy) log("已清理旧版本中的内嵌图片缓存，不影响正常配置与已保存的本地文件。"); if (resultUrls.length) renderResults(); bind(); updateButton(); await scanImages(); await restoreCustomImageCache(); await restoreWorkspace(); renderImages(); await readHfsyTaskState(); });
  pollHfsy = pollHfsySafe;
  const restoreCurrentTaskWhenReady = async () => {
    for (let attempt = 0; attempt < 40 && !workspaceHydrated; attempt++) await sleep(50);
    await restoreCurrentTask();
  };
  setTimeout(restoreCurrentTaskWhenReady, 0);
  document.addEventListener("visibilitychange", async () => {
    try { const currentWindow = await chrome.windows.getCurrent(); await chrome.runtime.sendMessage({ type: "SIDE_PANEL_VISIBILITY", windowId: currentWindow?.id, visible: !document.hidden }); } catch {}
  });
  window.addEventListener("pagehide", () => {
    if (!currentTask || currentTask.status !== "GENERATING" || currentTask.provider === "hfsy") return;
    writeCurrentTask({ status: "INTERRUPTED", finished: Math.min(currentTask.total || 0, resultUrls.length + taskFailures().length), resultUrls: remoteImageUrls(resultUrls), failures: taskFailures(), error: "侧边栏已关闭，未完成任务不会自动重复提交。" });
  });
  setTimeout(() => importLocalHistory().then(() => renderHistory()), 1200);
  $("save-prompt-preset")?.addEventListener("click", savePromptPreset);
  $("load-prompt-preset")?.addEventListener("click", loadPromptPreset);
  $("delete-prompt-preset")?.addEventListener("click", deletePromptPreset);
  $("prompt-preset-select")?.addEventListener("change", loadPromptPreset);
  readPromptPresets();
  $("save-custom-preset")?.addEventListener("click", saveCustomModelPreset);
  $("load-custom-preset")?.addEventListener("click", loadCustomModelPreset);
  $("delete-custom-preset")?.addEventListener("click", deleteCustomModelPreset);
  $("custom-preset-select")?.addEventListener("change", loadCustomModelPreset);
  readCustomModelPresets();
  const rawGenerate = generate;
  generate = async function() { if (!(await ensureLicensed())) return; return rawGenerate.apply(this, arguments); };
  const rawSaveBatch = saveBatch;
  saveBatch = async function() { if (!(await ensureLicensed())) return false; return rawSaveBatch.apply(this, arguments); };
  const rawReplace = replaceToDianxiaomi;
  replaceToDianxiaomi = async function() { if (!(await ensureLicensed())) return; return rawReplace.apply(this, arguments); };
  chrome.storage.local.get(["autoSave", "saveMode"], s => {
    if ($("auto-save")) { $("auto-save").checked = s.autoSave !== false; $("auto-save").onchange = () => chrome.storage.local.set({ autoSave: $("auto-save").checked }); }
    installSaveModeControl(s.saveMode === "downloads" ? "downloads" : "local");
  });
  chrome.storage.local.get(["provider", "apiKey", "apiKey_agnes", "apiKey_hfsy", "apiKey_custom", "agnesModel", "hfsyModel"], s => {
    if (providerUiHydrated) return;
    providerUiHydrated = true;
    activeProvider = s.provider || $("provider")?.value || "agnes";
    if ($("provider")) $("provider").value = activeProvider;
    $("api-key").value = s[providerKeyName(activeProvider)] || s.apiKey || "";
    if (activeProvider === "custom") lastCustomKeyValue = $("api-key").value.trim();
    installProviderModelControl(activeProvider, s[providerModelName(activeProvider)]);
    setProviderSaveStatus(maskedKey($("api-key").value));
    if ($("provider")) $("provider").onchange = () => switchProviderConfig($("provider").value);
    $("api-key")?.addEventListener("change", () => setProviderSaveStatus("密钥已更改，请点击保存"));
  });
  ["prompt", "filter-placeholders"].forEach(id => $(id)?.addEventListener("change", () => { chrome.storage.local.set({ prompt: $("prompt").value, filterPlaceholders: $("filter-placeholders").checked }).catch(() => {}); queueWorkspaceSave(); }));
  const customStoredFields = { "custom-input-mode": "customInputMode", "custom-task-id-path": "customTaskIdPaths", "custom-status-path": "customStatusPaths", "custom-result-path": "customResultPaths", "custom-success-states": "customSuccessStates", "custom-failure-states": "customFailureStates" };
  chrome.storage.local.get(Object.values(customStoredFields), state => { Object.entries(customStoredFields).forEach(([id, key]) => { if (state[key] !== undefined && $(id)) $(id).value = state[key]; }); });
  Object.keys(customStoredFields).forEach(id => $(id)?.addEventListener("input", () => setProviderSaveStatus("配置已更改，请点击保存")));
  $("custom-input-mode")?.addEventListener("change", () => setProviderSaveStatus("配置已更改，请点击保存"));
  // 初始化完成后再次从当前供应商专属键同步一次，避免并行 storage.get 回调覆盖密钥或模型。
  setTimeout(async () => {
    const provider = $("provider")?.value || activeProvider || "agnes";
    const state = await chrome.storage.local.get([providerKeyName(provider), providerModelName(provider), "apiKey"]);
    activeProvider = provider;
    $("api-key").value = state[providerKeyName(provider)] || (provider === "agnes" && state.apiKey ? state.apiKey : "");
    if (provider === "custom") lastCustomKeyValue = $("api-key").value.trim();
    installProviderModelControl(provider, state[providerModelName(provider)]);
    setProviderSaveStatus(maskedKey($("api-key").value));
    updateButton();
  }, 0);
  $("test-custom-config")?.addEventListener("click", testCustomConfig);
  $("copy-custom-ai-template")?.addEventListener("click", () => { const target = $("custom-ai-template"); if (!target) return; try { navigator.clipboard.writeText(target.value); status("已复制 AI 配置模板。"); } catch { target.focus(); target.select(); status("模板已选中，请按 Ctrl+C 复制。", true); } });
  ["custom-query-method", "custom-auth-mode", "custom-auth-header"].forEach(id => $(id)?.addEventListener("change", updateCustomProviderUi));
  chrome.storage.local.get(["customAuthMode", "customAuthHeader", "customQueryMethod"], state => { if ($("custom-auth-mode") && state.customAuthMode) $("custom-auth-mode").value = state.customAuthMode; if ($("custom-auth-header") && state.customAuthHeader) $("custom-auth-header").value = state.customAuthHeader; if ($("custom-query-method") && state.customQueryMethod) $("custom-query-method").value = state.customQueryMethod; updateCustomProviderUi(); });
  $("api-key")?.addEventListener("blur", handleCustomKeyBlur);
})();
