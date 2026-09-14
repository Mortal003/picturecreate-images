const HFSY_POLL_ALARM = "hfsy-task-poll";
const HFSY_GENERATE_URL = "https://www.hfsyapi.cn/v1/images/generations";
const HFSY_QUERY_URL = "https://www.hfsyapi.cn/v1/images/generations/";
let hfsyPollPromise = null;
const remoteImageUrls = values => (Array.isArray(values) ? values : []).filter(value => typeof value === "string" && /^https?:\/\//i.test(value));

chrome.action.onClicked.addListener(async tab => { try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) { console.warn("无法打开侧边栏", e); } });

async function parseResponse(response) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("接口返回不是 JSON（" + response.status + "）"); }
  if (!response.ok) throw new Error(data.error?.message || data.message || "请求失败（" + response.status + "）");
  return data;
}

async function generateAgnes(message) {
  const refs = message.referenceImages || [];
  const ratioMap = { "1024x1024":"1:1", "1040x832":"5:4", "720x1280":"9:16", "1280x720":"16:9", "1024x768":"4:3", "1008x672":"3:2", "832x1040":"4:5", "768x1024":"3:4", "672x1008":"2:3", "1344x576":"21:9" };
  const urls = [];
  for (const ref of refs) {
    const data = await parseResponse(await fetch("https://apihub.agnes-ai.com/v1/images/generations", { method: "POST", headers: { Authorization: "Bearer " + message.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: message.model || "agnes-image-2.5-flash", prompt: message.prompt, size: "1K", ratio: ratioMap[message.size] || "1:1", extra_body: { image: [ref], response_format: "url" } }) }));
    const url = data.data?.[0]?.url || data.data?.[0]?.b64_json;
    if (!url) throw new Error("Agnes 返回中没有图片 URL");
    urls.push(url);
  }
  return urls;
}

async function generateHfsy(message) {
  const tasks = [];
  for (const ref of message.referenceImages || []) {
    const data = await parseResponse(await fetch(HFSY_GENERATE_URL, { method: "POST", headers: { Authorization: "Bearer " + message.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: message.model || "gpt-image-2", prompt: message.prompt, size: message.size, response_format: "b64_json", reference_images: [ref], n: 1 }) }));
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
    const batchTasks = Array.isArray(state.batchTasks) ? state.batchTasks : [];
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
        const response = await fetch(HFSY_QUERY_URL + encodeURIComponent(task.taskId), { headers: { Authorization: "Bearer " + key } });
        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch { throw new Error("接口返回不是 JSON（" + response.status + "）"); }
        const apiError = data.error || data.data?.error;
        const imageUrl = findImage(data);
        const stateName = String(data.status || data.data?.status || (apiError ? "FAILURE" : "")).toUpperCase();
        if (imageUrl && response.ok) {
          task.status = "SUCCESS"; task.url = imageUrl; changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 已返回图片", "info");
        } else if (!response.ok || apiError || ["FAILURE", "FAILED", "ERROR"].includes(stateName)) {
          task.status = "FAILURE";
          task.error = apiError?.message || data.fail_reason || data.data?.fail_reason || data.message || ("中转站任务失败（" + response.status + "）");
          changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 失败：" + task.error, "error");
        } else if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"].includes(stateName)) {
          task.status = "FAILURE"; task.error = "任务成功但没有返回图片 URL"; changed = true;
          await appendExecutionLog("任务 " + task.taskId + " 成功但缺少图片 URL", "error");
        }
      } catch (e) {
        task.lastQueryError = e.message || "网络错误";
        await appendExecutionLog("任务 " + task.taskId + " 查询异常，继续等待：" + task.lastQueryError, "error");
      }
    }
    if (Date.now() - startedAt >= 600000) {
      for (const task of batchTasks) if (!["SUCCESS", "FAILURE"].includes(task.status)) { task.status = "FAILURE"; task.error = "查询超时，已停止等待（不会重新扣费）"; changed = true; }
      await appendExecutionLog("部分任务查询超时，已停止等待并保留已成功图片。", "error");
    }
    const urls = [...new Set(baseUrls.concat(remoteImageUrls(batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url))))];
    const unresolved = batchTasks.some(t => !["SUCCESS", "FAILURE"].includes(t.status));
    const nextActive = { ...activeTask, provider: "hfsy", status: unresolved ? "POLLING" : "COMPLETE", lastPolledAt: Date.now(), resultUrls: urls };
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
    (async () => { try { if (!chrome.sidePanel || sender?.tab?.windowId === undefined) throw new Error("当前浏览器不支持侧边栏"); await chrome.sidePanel.open({ windowId: sender.tab.windowId }); sendResponse({ ok: true }); } catch (error) { sendResponse({ ok: false, error: error.message }); } })();
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
