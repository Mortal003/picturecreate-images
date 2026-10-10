const HFSY_POLL_ALARM = "hfsy-task-poll";
const HFSY_GENERATE_URL = "https://www.hfsyapi.cn/v1/images/generations";
const HFSY_QUERY_URL = "https://www.hfsyapi.cn/v1/images/generations/";
const HFSY_TASK_QUERY_URL = "https://www.hfsyapi.cn/v1/image/query/";
let hfsyPollPromise = null;
const sidePanelStates = new Map();
const remoteImageUrls = values => (Array.isArray(values) ? values : []).filter(value => typeof value === "string" && /^https?:\/\//i.test(value));
const hfsyFailureMessage = (data, status, taskId) => { const reason = data?.fail_reason || data?.data?.fail_reason || data?.error?.message || data?.data?.error?.message || data?.message || ("中转站任务失败（" + status + "）"); return /do request failed/i.test(String(reason)) ? "hfsyapi 上游服务失败（任务 " + (taskId || "未知") + "，HTTP " + status + "，quota=0，未扣费）：" + reason : reason; };

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.action.onClicked.addListener(async tab => { try { await chrome.sidePanel.open({ windowId: tab.windowId }); sidePanelStates.set(tab.windowId, true); } catch (e) { console.warn("无法打开侧边栏", e); } });

async function parseResponse(response) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("接口返回不是 JSON（" + response.status + "）"); }
  if (!response.ok) throw new Error(data.error?.message || data.message || "请求失败（" + response.status + "）");
  return data;
}

const OFFICIAL_RATIO_MAP = {
  "1024x1024": "1:1", "1040x832": "5:4", "720x1280": "9:16", "1280x720": "16:9", "1024x768": "4:3", "1008x672": "3:2", "832x1040": "4:5", "768x1024": "3:4", "672x1008": "2:3", "1344x576": "21:9",
  "2048x2048": "1:1", "2080x1664": "5:4", "1152x2048": "9:16", "2048x1152": "16:9", "2048x1536": "4:3", "2016x1344": "3:2", "1664x2080": "4:5", "1536x2048": "3:4", "1344x2016": "2:3", "2016x864": "21:9",
  "2880x2880": "1:1", "3200x2560": "5:4", "2160x3840": "9:16", "3840x2160": "16:9", "3264x2448": "4:3", "3504x2336": "3:2", "2560x3200": "4:5", "2448x3264": "3:4", "2336x3504": "2:3", "3696x1584": "21:9"
};

async function generateAgnes(message) {
  const refs = message.referenceImages || [];
  const urls = [];
  for (const ref of refs) {
    const imgList = (Array.isArray(ref) ? ref : (ref ? [ref] : [])).filter(Boolean);
    const data = await parseResponse(await fetch("https://apihub.agnes-ai.com/v1/images/generations", { method: "POST", headers: { Authorization: "Bearer " + message.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: message.model || "agnes-image-2.5-flash", prompt: message.prompt, size: "1K", ratio: OFFICIAL_RATIO_MAP[message.size] || "1:1", extra_body: imgList.length ? { image: imgList, response_format: "url" } : { response_format: "url" } }) }));
    const url = data.data?.[0]?.url || data.data?.[0]?.b64_json;
    if (!url) throw new Error("Agnes 返回中没有图片 URL");
    urls.push(url);
  }
  return urls;
}

async function runAgnesTask(message) {
  const refs = Array.isArray(message.referenceImages) ? message.referenceImages : [];
  const startedAt = Date.now();
  const batchTasks = refs.map((referenceImage, imageIndex) => ({ provider: "agnes", imageIndex, taskId: "agnes-" + (imageIndex + 1), status: "QUEUED", referenceImage: Array.isArray(referenceImage) ? (referenceImage[0] || "") : referenceImage, referenceImages: Array.isArray(referenceImage) ? referenceImage : (referenceImage ? [referenceImage] : []), updatedAt: startedAt }));
  const saveState = async (status, resultUrls = []) => {
    const succeeded = batchTasks.filter(task => task.status === "SUCCESS").length;
    const failed = batchTasks.filter(task => task.status === "FAILURE").length;
    const activeTask = { batch: true, provider: "agnes", model: message.model || "agnes-image-2.5-flash", total: batchTasks.length, finished: succeeded + failed, succeeded, failed, startedAt, updatedAt: Date.now(), status, resultUrls: remoteImageUrls(resultUrls), failures: batchTasks.filter(task => task.status === "FAILURE").map(task => ({ taskId: task.taskId, imageIndex: task.imageIndex, error: task.error || "生成失败" })) };
    await chrome.storage.local.set({ activeTask, batchTasks, lastResults: remoteImageUrls(resultUrls) });
    return activeTask;
  };
  await saveState("PROCESSING", []);
  const urls = [];
  for (const task of batchTasks) {
    task.status = "SUBMITTING"; task.updatedAt = Date.now(); await saveState("PROCESSING", urls);
    const imgList = Array.isArray(task.referenceImages) && task.referenceImages.length ? task.referenceImages : (task.referenceImage ? [task.referenceImage] : []);
    const options = () => ({ method: "POST", headers: { Authorization: "Bearer " + message.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: message.model || "agnes-image-2.5-flash", prompt: message.prompt, size: "1K", ratio: OFFICIAL_RATIO_MAP[message.size] || "1:1", extra_body: imgList.length ? { image: imgList, response_format: "url" } : { response_format: "url" } }) });
    let data = null; let lastError = null;
    for (const wait of [0, 5000, 10000, 20000]) {
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      try { data = await parseResponse(await fetch("https://apihub.agnes-ai.com/v1/images/generations", options())); lastError = null; break; } catch (error) { lastError = error; if (!/队列满|queue\s*(is\s*)?full|too many requests|capacity|overloaded/i.test(String(error?.message || error))) break; }
    }
    const url = data && (data.data?.[0]?.url || (data.data?.[0]?.b64_json ? "data:image/png;base64," + data.data[0].b64_json : ""));
    if (url) { task.status = "SUCCESS"; task.url = url; urls.push(url); }
    else { task.status = "FAILURE"; task.error = lastError?.message || "Agnes 返回中没有图片 URL"; }
    task.updatedAt = Date.now(); await saveState("PROCESSING", urls);
  }
  const finalStatus = urls.length ? "COMPLETE" : "FAILED";
  const activeTask = await saveState(finalStatus, urls);
  return { urls, batchTasks, activeTask };
}

async function generateHfsy(message) {
  const tasks = [];
  for (const ref of message.referenceImages || []) {
    const imgList = (Array.isArray(ref) ? ref : (ref ? [ref] : [])).filter(Boolean);
    const data = await parseResponse(await fetch(HFSY_GENERATE_URL, { method: "POST", headers: { Authorization: "Bearer " + message.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: message.model || "gpt-image-2", prompt: message.prompt, size: message.size, response_format: "b64_json", reference_images: imgList, n: 1 }) }));
    const direct = findImage(data);
    if (direct) { tasks.push({ direct }); continue; }
    const id = data.task_id || data.id || data.data?.task_id;
    if (!id) throw new Error("hfsyapi 返回中没有图片结果或 task_id");
    tasks.push({ id });
  }
  const urls = [];
  for (const task of tasks) {
    if (task.direct) { urls.push(task.direct); continue; }
    const id = task.id;
    const started = Date.now();
    while (Date.now() - started < 600000) {
      const data = await parseResponse(await fetch(HFSY_QUERY_URL + encodeURIComponent(id), { headers: { Authorization: "Bearer " + message.apiKey } }));
      const state = String(data.status || data.data?.status || "").toUpperCase();
      const image = findImage(data);
      if (image) { urls.push(image); break; }
      if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(state)) throw new Error("任务成功但没有图片结果");
      if (["FAILURE", "FAILED", "ERROR", "CANCELLED"].includes(state)) throw new Error(data.fail_reason || data.data?.fail_reason || data.message || "生成失败");
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
  return urls;
}

function findImage(value, key = "") {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
    if (/b64|base64/i.test(key) && value.length > 100) return "data:image/png;base64," + value;
    return "";
  }
  if (Array.isArray(value)) { for (const item of value) { const found = findImage(item, key); if (found) return found; } return ""; }
  if (typeof value === "object") {
    for (const k of ["url", "result_url", "image_url", "output_url", "download_url", "b64_json", "base64"]) { const found = findImage(value[k], k); if (found) return found; }
    for (const [k, v] of Object.entries(value)) {
      if (/result|output|image|url|file|content|data/i.test(k) && !/reference|input|source|prompt|error|message|status|task|model/i.test(k)) { const found = findImage(v, k); if (found) return found; }
    }
  }
  return "";
}

async function appendExecutionLog(message, level = "info") {
  try {
    const state = await chrome.storage.local.get("executionLog");
    const executionLog = Array.isArray(state.executionLog) ? state.executionLog : [];
    executionLog.unshift({ time: new Date().toLocaleTimeString("zh-CN"), message, level });
    await chrome.storage.local.set({ executionLog: executionLog.slice(0, 100) });
  } catch {}
}

async function ensureHfsyAlarm() {
  if (!chrome.alarms?.create) return false;
  try { await chrome.alarms.create(HFSY_POLL_ALARM, { delayInMinutes: 0.1, periodInMinutes: 1 }); return true; } catch (e) { console.warn("无法创建后台轮询 alarm", e); return false; }
}

async function pollPendingHfsyTasks(message = {}) {
  if (hfsyPollPromise) return hfsyPollPromise;
  hfsyPollPromise = (async () => {
    const state = await chrome.storage.local.get(["activeTask", "batchTasks", "apiKey"]);
    const activeTask = state.activeTask;
    const batchTasks = (Array.isArray(state.batchTasks) ? state.batchTasks : []).map((task, index) => ({ provider: "hfsy", imageIndex: Number.isInteger(task?.imageIndex) ? task.imageIndex : index, updatedAt: Number(task?.updatedAt) || Date.now(), ...task }));
    if (!activeTask?.batch || (activeTask.provider && activeTask.provider !== "hfsy") || !batchTasks.length) {
      try { await chrome.alarms.clear(HFSY_POLL_ALARM); } catch {}
      return { ok: true, pending: false };
    }
    const key = message.apiKey || state.apiKey || "";
    if (!key) { await ensureHfsyAlarm(); return { ok: false, pending: true, error: "缺少 API Key" }; }
    const startedAt = Number(activeTask.startedAt) || Date.now();
    const baseUrls = remoteImageUrls(activeTask.resultUrls);
    let changed = false;
    for (const task of batchTasks) {
      if (task.status === "SUCCESS" || task.status === "FAILURE") continue;
      try {
        const isCatalog = task.taskId?.startsWith("task_") || task.protocol === "hfsy-task-catalog" || String(task.taskId || "").length > 20;
        const queryUrl = (isCatalog ? HFSY_TASK_QUERY_URL : HFSY_QUERY_URL) + encodeURIComponent(task.taskId);
        const response = await fetch(queryUrl, { headers: { Authorization: "Bearer " + key } });
        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error("接口返回不是 JSON（" + response.status + "）"); }
        const apiError = data.error || data.data?.error;
        const imageUrl = findImage(data);
        const stateName = String(data.status || data.data?.status || data.task_status || (apiError ? "FAILURE" : "")).toUpperCase();
        if (imageUrl && response.ok) {
          task.status = "SUCCESS"; task.url = imageUrl; task.updatedAt = Date.now(); changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 已返回图片", "info");
        } else if (!response.ok || apiError || ["FAILURE", "FAILED", "ERROR"].includes(stateName)) {
          task.status = "FAILURE"; task.updatedAt = Date.now();
          task.error = hfsyFailureMessage(data, response.status, task.taskId);
          changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 失败：" + task.error, "error");
        } else if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(stateName)) {
          task.status = "FAILURE"; task.error = "任务成功但没有返回图片 URL"; task.updatedAt = Date.now(); changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 成功但缺少图片 URL", "error");
        }
      } catch (e) {
        task.lastQueryError = e.message || "网络错误";
        await appendExecutionLog("任务 " + task.taskId + " 查询异常，继续等待：" + task.lastQueryError, "error");
      }
    }
    if (Date.now() - startedAt >= 600000) {
      for (const task of batchTasks) if (!["SUCCESS", "FAILURE"].includes(task.status)) { task.status = "FAILURE"; task.error = "查询超时，已停止等待（不会重新扣费）"; task.updatedAt = Date.now(); changed = true; }
      await appendExecutionLog("部分任务查询超时，已停止等待并保留已成功图片。", "error");
    }
    const urls = [...new Set(baseUrls.concat(remoteImageUrls(batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url))))];
    const unresolved = batchTasks.some(t => !["SUCCESS", "FAILURE"].includes(t.status));
    const succeeded = batchTasks.filter(task => task.status === "SUCCESS").length;
    const failed = batchTasks.filter(task => task.status === "FAILURE").length;
    const nextActive = { ...activeTask, provider: "hfsy", status: unresolved ? "POLLING" : (succeeded ? "COMPLETE" : "FAILED"), total: Math.max(Number(activeTask.total) || 0, batchTasks.length), finished: succeeded + failed, succeeded, failed, lastPolledAt: Date.now(), updatedAt: Date.now(), resultUrls: urls, failures: batchTasks.filter(task => task.status === "FAILURE").map(task => ({ taskId: task.taskId || "", imageIndex: task.imageIndex, error: task.error || "生成失败" })) };
    await chrome.storage.local.set({ batchTasks, activeTask: nextActive, lastResults: urls });
    if (unresolved) await ensureHfsyAlarm();
    else {
      try { await chrome.alarms.clear(HFSY_POLL_ALARM); } catch {}
      if (activeTask.status !== "COMPLETE") await appendExecutionLog("后台轮询完成：成功 " + batchTasks.filter(t => t.status === "SUCCESS").length + " 张，失败 " + batchTasks.filter(t => t.status === "FAILURE").length + " 张。", "info");
    }
    return { ok: true, pending: unresolved, changed, urls, batchTasks };
  })();
  try { return await hfsyPollPromise; } finally { hfsyPollPromise = null; }
}

if (chrome.alarms?.onAlarm) chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === HFSY_POLL_ALARM) pollPendingHfsyTasks(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => pollPendingHfsyTasks());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_SIDE_PANEL") {
    (async () => { try { const windowId = sender?.tab?.windowId ?? message.windowId; if (!chrome.sidePanel || windowId === undefined) throw new Error("当前浏览器不支持侧边栏"); await chrome.sidePanel.open({ windowId }); sidePanelStates.set(windowId, true); sendResponse({ ok: true, open: true }); } catch (error) { sendResponse({ ok: false, open: false, error: error.message }); } })();
    return true;
  }
  if (message?.type === "TOGGLE_SIDE_PANEL") {
    (async () => { const windowId = sender?.tab?.windowId ?? message.windowId; const isOpen = sidePanelStates.get(windowId) === true; try { if (!chrome.sidePanel || windowId === undefined) throw new Error("当前浏览器不支持侧边栏"); if (isOpen) { if (typeof chrome.sidePanel.close !== "function") throw new Error("当前浏览器不支持程序化关闭侧边栏，请在侧边栏顶部手动关闭。"); await chrome.sidePanel.close({ windowId }); sidePanelStates.set(windowId, false); sendResponse({ ok: true, open: false }); } else { await chrome.sidePanel.open({ windowId }); sidePanelStates.set(windowId, true); sendResponse({ ok: true, open: true }); } } catch (error) { sendResponse({ ok: false, open: isOpen, error: error.message }); } })();
    return true;
  }
  if (message?.type === "SIDE_PANEL_VISIBILITY") {
    const windowId = sender?.tab?.windowId ?? message.windowId;
    if (windowId !== undefined) sidePanelStates.set(windowId, message.visible === true);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "GET_HFSY_TASK_STATE") {
    (async () => {
      try {
        const state = await chrome.storage.local.get(["activeTask", "batchTasks", "lastResults"]);
        const activeTask = state.activeTask || null;
        const batchTasks = Array.isArray(state.batchTasks) ? state.batchTasks : [];
        const lastResults = remoteImageUrls(state.lastResults || activeTask?.resultUrls || []);
        const pending = activeTask?.provider === "hfsy" && activeTask.status === "POLLING" && batchTasks.some(task => !["SUCCESS", "FAILURE"].includes(task.status));
        if (pending) await ensureHfsyAlarm();
        sendResponse({ ok: true, activeTask, batchTasks, lastResults });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "读取后台任务状态失败" });
      }
    })();
    return true;
  }
  if (message?.type === "START_HFSY_POLL" || message?.type === "POLL_HFSY_NOW") {
    (async () => { try { if (message.apiKey) await chrome.storage.local.set({ apiKey: message.apiKey }); await ensureHfsyAlarm(); const result = await pollPendingHfsyTasks(message); sendResponse(result); } catch (error) { sendResponse({ ok: false, error: error.message }); } })();
    return true;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_IMAGE") {
    (async () => { try { const urls = message.provider === "hfsy" ? await generateHfsy(message) : await generateAgnes(message); sendResponse({ ok: true, urls }); } catch (error) { sendResponse({ ok: false, error: error.message }); } })();
    return true;
  }
});
