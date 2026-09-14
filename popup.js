(() => {
  document.querySelector('main.app')?.setAttribute('hidden', '');
  const licenseLoader = document.createElement('script');
  licenseLoader.src = 'license.js';
  document.head.appendChild(licenseLoader);
  const $ = id => document.getElementById(id);
  let images = [], customImages = [], selected = new Set(), resultUrls = [], history = [];
  let batchTasks = [], pollTimer = null, thinkingTimer = null, directoryHandle = null;
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
  const log = (message, level = "info") => { executionLog.unshift({time:new Date().toLocaleTimeString("zh-CN"), message, level}); executionLog = executionLog.slice(0,100); chrome.storage.local.set({executionLog}); renderLog(); };
  const renderLog = () => { const e=$("execution-log-list"); if(e) e.innerHTML=executionLog.length?executionLog.map(x=>`<div class="log-item ${x.level}"><time>${x.time}</time><span>${String(x.message).replaceAll("<","&lt;")}</span></div>`).join(""):"<p class=\"muted\">暂无执行记录</p>"; };
  const status = (m, error = false) => { const e = $("status"); if (e) { e.textContent = m || ""; e.className = "status" + (error ? " error" : ""); } if(m) log(m,error?"error":"info"); };
  const refs = () => images.concat(customImages.map(src => ({ src, custom: true })));
  const selectedRefs = () => [...selected].map(i => refs()[i]?.src).filter(Boolean);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  function renderImages() { const grid = $("image-grid"); if (!grid) return; const all = refs(); grid.innerHTML = ""; $("image-count").textContent = all.length ? all.length + " 张可用" : ""; const done = new Set(history.flatMap(x => x.referenceImages || [])); all.slice(0, 60).forEach((im, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "image-option" + (selected.has(i) ? " selected" : "") + (done.has(im.src) ? " processed" : ""); const img = document.createElement("img"); img.src = im.src; b.appendChild(img); if (im.custom || done.has(im.src)) { const tag = document.createElement("span"); tag.className = "processed-badge"; tag.textContent = im.custom ? "本地" : "已处理"; b.appendChild(tag); } b.onclick = () => { if (!selected.has(i) && selected.size >= 6) return status("一次最多只能选择 6 张参考图。", true); selected.has(i) ? selected.delete(i) : selected.add(i); b.classList.toggle("selected"); updateButton(); }; grid.appendChild(b); }); updateButton(); }
  function updateButton() { if ($("generate")) $("generate").disabled = !selected.size || !$("prompt").value.trim() || !$("api-key").value.trim(); if ($("selection-note")) $("selection-note").textContent = "当前选择了 " + selected.size + " 张照片（本次最多 6 张）"; }
  async function scanImages() { status("正在扫描图片…"); try { const t = await getPageTab(); if (!t) throw Error(); const r = await chrome.tabs.sendMessage(t.id, { type: "LIST_IMAGES", includePlaceholders: !$("filter-placeholders").checked }); images = r?.images || []; selected.clear(); renderImages(); status(""); } catch { images = []; renderImages(); status("当前页面无法读取图片，请刷新页面后重试。", true); } }
  function setProgress(value) { const bar=$("progress-bar"), label=$("progress-percent"); const prev=Number(bar?.dataset.progress||0); const next=Math.max(prev,Math.min(100,Number(value)||0)); if(bar){bar.dataset.progress=String(next);bar.style.width=next+"%";} if(label) label.textContent=Math.round(next)+"%"; return next; }
  function thinking(on) { const box = $("thinking"); if (!box) return; box.hidden = !on; clearInterval(thinkingTimer); if (!on) { setProgress(100); thinkingStartedAt = 0; return; } const bar=$("progress-bar"); if(bar) delete bar.dataset.progress; thinkingStartedAt = Date.now(); setProgress(5); $("thinking-text").textContent = "任务已提交，等待中转站返回…"; thinkingTimer = setInterval(() => { const elapsed = Date.now() - thinkingStartedAt; const p = Math.min(90, 5 + (elapsed / 55000) * 80); setProgress(p); const shown = Number($("progress-bar")?.dataset.progress || p); $("thinking-text").textContent = shown < 22 ? "正在读取参考图…" : shown < 48 ? "正在理解提示词…" : shown < 78 ? "中转站生成中（通常需要 35–70 秒）…" : "等待图片返回与整理结果…"; }, 1000); }
  function filename(i, b) { const n = new Date(), x = b || {}, day = (x.day || n.toISOString().slice(0, 10)).replaceAll("-", ""), tm = (x.time || n.toTimeString().slice(0, 8)).replaceAll(":", ""), seq = String(x.seq || 1).padStart(3, "0"), count = x.count || resultUrls.length; return day + "-" + tm + "_" + count + "张_" + seq + "_" + String(i + 1).padStart(2, "0") + ".png"; }
  async function downloadFile(url, filename) { if (!(await ensureLicensed())) throw Error("当前插件未激活或授权已过期，请先完成激活。"); return new Promise((resolve, reject) => { chrome.downloads.download({ url, filename, saveAs: false }, id => { const err = chrome.runtime.lastError; if (err) reject(Error(err.message)); else resolve(id); }); }); }
  async function saveBatch(force = false) { if (!resultUrls.length) { log("没有可保存的图片结果", "error"); return false; } const signature = resultUrls.join("|"); const old = await chrome.storage.local.get(["lastSavedBatchSignature", "pendingSave"]); if (!force && old.lastSavedBatchSignature === signature && !old.pendingSave) return true; const now = new Date(), day = now.toISOString().slice(0, 10), st = await chrome.storage.local.get("dailyBatchCounter"), c = st.dailyBatchCounter?.date === day ? st.dailyBatchCounter : { date: day, sequence: 0 }; const pending = old.pendingSave && old.pendingSave.signature === signature ? old.pendingSave : null; let batch, folder, record; if (pending) { batch = pending.batch; folder = pending.folder; record = pending.record; } else { c.sequence++; batch = { day, time: now.toTimeString().slice(0, 8), seq: c.sequence, count: resultUrls.length }; folder = day.replaceAll("-", "") + "-" + batch.time.replaceAll(":", "") + "_" + batch.count + "张_" + String(batch.seq).padStart(3, "0"); record = { 记录类型: "商品生图生成", 生成时间: now.toLocaleString("zh-CN"), 批次序号: c.sequence, 本批图片数量: resultUrls.length, 提示词: $("prompt").value.trim(), 参考图片: selectedRefs(), 生成文件: resultUrls.map((u, i) => ({ 文件名: filename(i, batch), 图片URL: u })) }; } await chrome.storage.local.set({ dailyBatchCounter: c, pendingSave: { signature, folder, batch, record, urls: resultUrls } }); try { if (directoryHandle && await directoryHandle.queryPermission({ mode: "readwrite" }) === "granted") { const dir = await directoryHandle.getDirectoryHandle(folder, { create: true }); for (let i = 0; i < resultUrls.length; i++) { const blob = await (await fetch(resultUrls[i])).blob(); const f = await dir.getFileHandle(filename(i, batch), { create: true }); const w = await f.createWritable(); await w.write(blob); await w.close(); } const jf = await dir.getFileHandle(folder + ".json", { create: true }); const jw = await jf.createWritable(); await jw.write(JSON.stringify(record, null, 2)); await jw.close(); await chrome.storage.local.set({ lastSavedBatchSignature: signature }); await chrome.storage.local.remove("pendingSave"); status("已保存到指定本地文件夹：" + folder); log("已写入指定本地文件夹：" + folder); return true; } } catch (e) { status("指定文件夹写入失败，正在改存下载目录…", true); } const base = "商品生图/" + folder; for (let i = 0; i < resultUrls.length; i++) await downloadFile(resultUrls[i], base + "/" + filename(i, batch)); const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json;charset=utf-8" }), jurl = URL.createObjectURL(blob); await downloadFile(jurl, base + "/" + folder + ".json"); setTimeout(() => URL.revokeObjectURL(jurl), 10000); await chrome.storage.local.set({ lastSavedBatchSignature: signature }); await chrome.storage.local.remove("pendingSave"); status("已保存到浏览器下载目录的 商品生图/" + folder); log("已保存到浏览器下载目录：商品生图/" + folder); return true; }
  function customConfig() { return { base: $("custom-base-url").value.trim().replace(/\/$/, ""), generatePath: $("custom-generate-path").value.trim() || "/images/generations", queryPath: $("custom-query-path").value.trim() || "/images/generations/{task_id}", model: $("custom-model").value.trim() || "gpt-image-2", mode: $("custom-mode").value }; }
  async function generateCustom(cfg, refs, key) { if (!cfg.base) throw Error("请先展开并填写自定义中转站 Base URL。"); const urls=[]; if(cfg.mode === "sync") { for(const ref of refs) { const r=await fetch(cfg.base+cfg.generatePath,{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:cfg.model,prompt:$("prompt").value.trim(),size:$("size").value,extra_body:{image:[ref],response_format:"url"}})}); const d=await r.json(); if(!r.ok) throw Error(d.error?.message||d.message||"自定义中转站请求失败（"+r.status+"）"); const u=d.data?.[0]?.url||d.result_url||(d.data?.[0]?.b64_json?"data:image/png;base64,"+d.data[0].b64_json:""); if(!u) throw Error("自定义中转站没有返回图片"); urls.push(u); } return urls; } const tasks=[]; for(const ref of refs) { const r=await fetch(cfg.base+cfg.generatePath,{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:cfg.model,prompt:$("prompt").value.trim(),size:$("size").value,reference_images:[ref],extra_body:{image:[ref],response_format:"url"}})}); const d=await r.json(); if(!r.ok) throw Error(d.error?.message||d.message||"自定义中转站提交失败（"+r.status+"）"); tasks.push(d.task_id||d.id||d.data?.task_id); } for(const id of tasks) { const started=Date.now(); while(Date.now()-started<600000) { const path=cfg.queryPath.replace("{task_id}",encodeURIComponent(id)); const r=await fetch(cfg.base+path,{headers:{Authorization:"Bearer "+key}}); const d=await r.json(); const state=String(d.status||d.data?.status||"").toUpperCase(); if(state==="SUCCESS"||state==="COMPLETED") { const u=d.result_url||d.data?.result_url||d.data?.[0]?.url; if(!u) throw Error("自定义中转站任务成功但没有图片 URL"); urls.push(u); break; } if(state==="FAILURE"||state==="FAILED") throw Error(d.fail_reason||d.message||"自定义中转站生成失败"); await sleep(2500); } } return urls; }
  async function generate() { const rs=selectedRefs(), key=$("api-key").value.trim(), provider=$("provider").value; if(!rs.length)return; if(!directoryHandle){const ok=confirm("尚未选择本地保存文件夹，是否现在选择？");if(!ok){status("未选择本地保存文件夹，已取消生成。",true);return;}await chooseFolder();if(!directoryHandle){status("必须选择本地保存文件夹后才能生成。",true);return;}} try{const perm=await directoryHandle.queryPermission({mode:"readwrite"});if(perm!=="granted"){const granted=await directoryHandle.requestPermission({mode:"readwrite"});if(granted!=="granted"){status("本地保存文件夹尚未授权，已取消生成。",true);return;}}}catch(e){status("无法确认本地文件夹授权："+e.message,true);return;} $("generate").disabled=true;thinking(true);resultUrls=[];batchTasks=[];try{if(provider==="custom"){const cfg={base:$("custom-base-url").value.trim().replace(/\/$/,""),generatePath:$("custom-generate-path").value.trim()||"/images/generations",queryPath:$("custom-query-path").value.trim()||"/images/generations/{task_id}",model:$("custom-model").value.trim()||"gpt-image-2",mode:$("custom-mode").value};resultUrls.push(...await generateCustom(cfg,rs,key));setProgress(92);await finish("自定义中转站生成完成，共 "+resultUrls.length+" 张。");}else if(provider==="agnes"){const ratio={"1024x1024":"1:1","1280x720":"16:9","1024x768":"4:3","768x1024":"3:4"};for(let i=0;i<rs.length;i++){const r=await fetch("https://apihub.agnes-ai.com/v1/images/generations",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"agnes-image-2.5-flash",prompt:$("prompt").value.trim(),size:"1K",ratio:ratio[$("size").value]||"1:1",extra_body:{image:[rs[i]],response_format:"url"}})});const d=await r.json();if(!r.ok)throw Error(d.error?.message||d.message||"Agnes 请求失败（"+r.status+"）");const u=d.data?.[0]?.url||(d.data?.[0]?.b64_json?"data:image/png;base64,"+d.data[0].b64_json:"");if(!u)throw Error("Agnes 返回中没有图片");resultUrls.push(u);setProgress(Math.round((i+1)/rs.length*92));}await finish("Agnes 生成完成，共 "+resultUrls.length+" 张。");}else{for(const ref of rs){try{const r=await fetch("https://www.hfsyapi.cn/v1/images/generations/async",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-image-2",prompt:$("prompt").value.trim(),size:$("size").value,response_format:"b64_json",reference_images:[ref]})});const d=await r.json();if(!r.ok){const msg=d.error?.message||d.message||"提交任务失败（"+r.status+"）";batchTasks.push({taskId:"submit-"+(batchTasks.length+1),status:"FAILURE",error:msg,referenceImage:ref});log("提交任务失败："+msg,"error");continue;}const id=d.task_id||d.id||d.data?.task_id;if(!id){const msg="接口未返回 task_id";batchTasks.push({taskId:"submit-"+(batchTasks.length+1),status:"FAILURE",error:msg,referenceImage:ref});log(msg,"error");continue;}batchTasks.push({taskId:id,status:"QUEUED",referenceImage:ref});}catch(e){const msg=e.message||"提交任务异常";batchTasks.push({taskId:"submit-"+(batchTasks.length+1),status:"FAILURE",error:msg,referenceImage:ref});log("提交任务异常："+msg,"error");}}await chrome.storage.local.set({activeTask:{batch:true},batchTasks});await pollHfsy(key);}}catch(e){thinking(false);status(e.message,true);}finally{updateButton();}}
  async function pollHfsy(key) { const check = async () => { let done = 0, failed = 0; for (const t of batchTasks) { if (t.status === "SUCCESS" || t.status === "FAILURE") { t.status === "SUCCESS" ? done++ : failed++; continue; } try { const response = await fetch("https://www.hfsyapi.cn/v1/images/generations/" + encodeURIComponent(t.taskId), { headers: { Authorization: "Bearer " + key } }); const d = await response.json(); const apiError = d.error || d.data?.error; const state = String(d.status || d.data?.status || (apiError ? "FAILURE" : "")).toUpperCase(); if (!response.ok || apiError || state === "FAILURE" || state === "FAILED") { t.status = "FAILURE"; t.error = apiError?.message || d.fail_reason || d.data?.fail_reason || d.message || "中转站任务失败"; failed++; log("任务 " + t.taskId + " 失败：" + t.error, "error"); continue; } if (state === "SUCCESS" || state === "COMPLETED") { t.status = "SUCCESS"; t.url = d.result_url || d.data?.result_url || d.data?.[0]?.url; if (t.url) { done++; log("任务 " + t.taskId + " 已返回图片", "info"); } else { t.status = "FAILURE"; t.error = "任务成功但没有返回图片 URL"; failed++; log("任务 " + t.taskId + " 成功但缺少图片 URL", "error"); } } } catch (e) { t.status = "FAILURE"; t.error = e.message || "查询任务失败"; failed++; log("任务 " + t.taskId + " 查询失败：" + t.error, "error"); } } const total = batchTasks.length, finished = done + failed; setProgress(total ? Math.round(finished / total * 92) : 92); $("thinking-text").textContent = "已完成 " + finished + " / " + total + " 张，成功 " + done + " 张，失败 " + failed + " 张…"; if (finished >= total) { clearInterval(pollTimer); resultUrls = batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url); await finish("生成完成：成功 " + resultUrls.length + " 张，失败 " + failed + " 张。"); } }; await check(); if (batchTasks.some(t => !["SUCCESS", "FAILURE"].includes(t.status))) pollTimer = setInterval(check, 2500); }
  async function pollHfsySafe(key) {
    const startedAt = Date.now();
    let finished = false;
    const finishOnce = async (message) => {
      if (finished) return;
      finished = true;
      clearInterval(pollTimer);
      pollTimer = null;
      resultUrls = batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url);
      await chrome.storage.local.set({ batchTasks, lastResults: resultUrls, activeTask: null });
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
          const imageUrl = findImage(d);
          const apiError = d.error || d.data?.error;
          const state = String(d.status || d.data?.status || (apiError ? "FAILURE" : "")).toUpperCase();
          if (imageUrl && response.ok) {
            t.status = "SUCCESS";
            t.url = imageUrl;
            log("任务 " + t.taskId + " 已返回图片", "info");
          } else if (!response.ok || apiError || ["FAILURE", "FAILED", "ERROR"].includes(state)) {
            t.status = "FAILURE";
            t.error = apiError?.message || d.fail_reason || d.data?.fail_reason || d.message || ("中转站任务失败（" + response.status + "）");
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
      const response = await chrome.runtime.sendMessage({ type: "POLL_HFSY_NOW", apiKey: key });
      if (!response?.ok && response?.error) { log("后台轮询暂时无法查询：" + response.error, "error"); return false; }
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
    if (!resultUrls.length) return;
    const signature = JSON.stringify({ urls: resultUrls, prompt: $("prompt")?.value.trim() || "", provider: $("provider")?.value || "", tasks: batchTasks.map(t => t.taskId) });
    const current = await chrome.storage.local.get('lastHistoryBatchSignature');
    if (current.lastHistoryBatchSignature === signature) return;
    const now = Date.now();
    const refsUsed = selectedRefs().length ? selectedRefs() : [...new Set(batchTasks.map(t => t.referenceImage).filter(Boolean))];
    const promptText = $("prompt")?.value.trim() || "";
    const entries = resultUrls.map((url, index) => ({
      id: now + '-' + index,
      url,
      prompt: promptText,
      provider: $("provider")?.value || "",
      model: $("provider")?.value === "hfsy" ? "gpt-image-2" : ($("provider")?.value === "agnes" ? "agnes-image-2.5-flash" : ""),
      referenceImages: refsUsed,
      createdAt: now,
      batchCount: resultUrls.length,
      batchIndex: index + 1,
      failedCount: batchTasks.filter(t => t.status === "FAILURE").length
    }));
    history = history.concat(entries).slice(-200);
    await chrome.storage.local.set({ history, lastHistoryBatchSignature: signature });
  }
  async function finish(message) { thinking(false); renderResults(); await chrome.storage.local.set({ lastResults: resultUrls, activeTask: null }); await persistHistory(); await saveBatch(true); status(message); if (document.querySelector('input[name="upload-mode"]:checked')?.value === "auto" && resultUrls.length) { status(message + " 正在自动上传到店小秘…"); await replaceToDianxiaomi(); } renderHistory(); renderImages(); }
  async function replaceToDianxiaomi() { const t = await getPageTab(); if (!t || t.url.indexOf("dianxiaomi.com/web/amazon/edit") < 0) return status("请先切换到店小秘产品编辑页。", true); const us = resultUrls.filter(u => /^https?:\/\//i.test(u)); if (!us.length) return status("没有可上传的图片 URL。", true); status("正在清空原图并上传…"); try { const r = await chrome.tabs.sendMessage(t.id, { type: "AUTO_REPLACE_DIANXIAOMI", urls: us, secondsPerImage: 1000 }); if (!r?.ok) throw Error(r?.error || "自动上传失败"); status("网络图片添加并校验成功：" + r.uploaded + " 张图片。"); } catch (e) { status(e.message, true); } }
  function renderResults() { const grid = $("result-grid"); grid.innerHTML = ""; $("results").hidden = false; const head = $("download-all").parentElement; if (!$("replace-all")) { const b = document.createElement("button"); b.id = "replace-all"; b.className = "text-button"; b.textContent = "全部上传到店小秘"; b.onclick = replaceToDianxiaomi; head.appendChild(b); } resultUrls.forEach((url, i) => { const c = document.createElement("div"); c.className = "result-card"; const im = document.createElement("img"); im.src = url; const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.download = filename(i); a.textContent = "打开/下载"; c.append(im, a); grid.appendChild(c); }); }
  function renderHistory() { const list = $("history-list"); list.innerHTML = history.length ? history.slice().reverse().map(x => '<div class="history-item"><img src="' + x.url + '"><div><p>' + String(x.prompt || "").replaceAll("<", "&lt;") + '</p><time>' + new Date(x.createdAt).toLocaleString() + '</time></div><a target="_blank" href="' + x.url + '">打开</a></div>').join("") : '<p class="muted">暂无生成记录</p>'; }
  async function chooseFolder() { if (!window.showDirectoryPicker) return status("当前浏览器不支持选择文件夹，将保存到下载目录。", true); try { directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" }); await persistHandle(directoryHandle); $("folder-status").textContent = "已选择本地文件夹，生成后直接保存"; status("本地文件夹已授权并持久化。"); } catch (e) { if (e.name !== "AbortError") status("选择文件夹失败：" + e.message, true); } }
  function bind() { $("refresh").onclick = scanImages; $("rescan").onclick = scanImages; $("filter-placeholders").onchange = scanImages; $("generate").onclick = generate; $("prompt").oninput = updateButton; $("api-key").oninput = updateButton; $("upload-custom").onclick = () => $("custom-images").click(); $("custom-images").onchange = async e => { const added = await Promise.all([...e.target.files].map(f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }))); customImages.push(...added); customImages = customImages.slice(-30); e.target.value = ""; renderImages(); status("已添加本地参考图 " + added.length + " 张，请在列表中选择。"); }; $("choose-folder").onclick = chooseFolder; $("download-all").onclick = () => saveBatch(true); $("clear-log").onclick = async () => { executionLog=[]; await chrome.storage.local.set({executionLog:[]}); renderLog(); }; $("clear-history").onclick = async () => { history = []; await chrome.storage.local.set({ history: [] }); renderHistory(); renderImages(); }; document.querySelectorAll('input[name="upload-mode"]').forEach(e => e.onchange = () => chrome.storage.local.set({ uploadMode: e.value })); $("provider").onchange = () => { chrome.storage.local.set({ provider: $("provider").value }); $("custom-provider-panel").open = $("provider").value === "custom"; }; $("save-custom-provider").onclick = () => { chrome.storage.local.set({ customBaseUrl:$("custom-base-url").value, customGeneratePath:$("custom-generate-path").value, customQueryPath:$("custom-query-path").value, customModel:$("custom-model").value, customMode:$("custom-mode").value }); status("自定义中转站配置已保存。"); }; }
  chrome.storage.local.get(["apiKey", "prompt", "filterPlaceholders", "autoSave", "history", "lastResults", "provider", "uploadMode", "executionLog", "customBaseUrl", "customGeneratePath", "customQueryPath", "customModel", "customMode", "activeTask", "batchTasks"], async s => { $("api-key").value = s.apiKey || ""; $("prompt").value = s.prompt || ""; $("filter-placeholders").checked = s.filterPlaceholders !== false; $("auto-save").checked = true; history = Array.isArray(s.history) ? s.history : []; executionLog = Array.isArray(s.executionLog) ? s.executionLog : []; resultUrls = Array.isArray(s.lastResults) ? s.lastResults : []; $("provider").value = s.provider || "agnes"; $("custom-base-url").value=s.customBaseUrl||""; $("custom-generate-path").value=s.customGeneratePath||"/images/generations"; $("custom-query-path").value=s.customQueryPath||"/images/generations/{task_id}"; $("custom-model").value=s.customModel||"gpt-image-2"; $("custom-mode").value=s.customMode||"sync"; $("custom-provider-panel").open=$("provider").value==="custom"; const mode = s.uploadMode || "manual"; const radio = document.querySelector('input[name="upload-mode"][value="' + mode + '"]'); if (radio) radio.checked = true; await restoreHandle(); const pending=await chrome.storage.local.get("pendingSave"); if(pending.pendingSave && Array.isArray(pending.pendingSave.urls)){ resultUrls=pending.pendingSave.urls; log("发现未完成的保存任务，正在重试…"); await saveBatch(true); } renderHistory(); renderLog(); if (resultUrls.length) renderResults(); bind(); updateButton(); scanImages(); const recoverable = s.activeTask?.batch && Array.isArray(s.batchTasks) && s.batchTasks.length && $("api-key").value.trim(); if (recoverable) { const unresolved = s.batchTasks.some(t => !["SUCCESS","FAILURE"].includes(t.status)); if (unresolved) { batchTasks=s.batchTasks; thinking(true); status("正在恢复未完成的中转站任务…"); await watchHfsyInBackground($("api-key").value.trim()); } else { batchTasks=s.batchTasks; resultUrls = Array.isArray(s.lastResults) ? s.lastResults : s.batchTasks.filter(t => t.status === "SUCCESS" && t.url).map(t => t.url); if (resultUrls.length || s.activeTask?.status === "COMPLETE") { thinking(true); await finish("后台任务已完成：成功 " + resultUrls.length + " 张，失败 " + s.batchTasks.filter(t => t.status === "FAILURE").length + " 张。"); } else { await chrome.storage.local.set({ activeTask: null }); log("上一批中转站任务已结束，已清理恢复状态。"); } } } });
  pollHfsy = pollHfsySafe;
  setTimeout(() => importLocalHistory().then(() => renderHistory()), 1200);
  const legacyGenerate = generate;
  generate = async function() {
    if ($('provider').value !== 'hfsy') return legacyGenerate();
    const refsNow = selectedRefs(), keyNow = $('api-key').value.trim();
    if (!refsNow.length || !keyNow) return;
    if (!directoryHandle) { const ok = confirm('尚未选择本地保存文件夹，是否现在选择？'); if (!ok) return status('未选择本地保存文件夹，已取消生成。', true); await chooseFolder(); if (!directoryHandle) return status('必须选择本地保存文件夹后才能生成。', true); }
    try { const perm = await directoryHandle.queryPermission({mode:'readwrite'}); if (perm !== 'granted' && await directoryHandle.requestPermission({mode:'readwrite'}) !== 'granted') return status('本地文件夹尚未授权，已取消生成。', true); } catch (e) { return status('无法确认本地文件夹授权：' + e.message, true); }
    $('generate').disabled = true; thinking(true); resultUrls = []; batchTasks = []; let failedNow = 0;
    for (const ref of refsNow) {
      try {
        const r = await fetch('https://www.hfsyapi.cn/v1/images/generations', { method:'POST', headers:{Authorization:'Bearer '+keyNow, 'Content-Type':'application/json'}, body:JSON.stringify({model:'gpt-image-2', prompt:$('prompt').value.trim(), size:$('size').value, reference_images:[ref], n:1, response_format:'b64_json'}) });
        const d = await r.json();
        const raw = d.result_url || d.data?.result_url || d.data?.[0]?.url || d.output?.url || d.output?.[0]?.url || d.images?.[0]?.url || d.data?.[0]?.b64_json || d.data?.[0]?.b64_data || '';
        const u = typeof raw === 'string' && (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) ? raw : (raw ? 'data:image/png;base64,' + raw : '');
        if (r.ok && u) { resultUrls.push(u); batchTasks.push({taskId:'direct-'+(batchTasks.length+1), status:'SUCCESS', url:u, referenceImage:ref}); setProgress(Math.min(92, Math.round(resultUrls.length / refsNow.length * 92))); $("thinking-text").textContent = "已完成 " + resultUrls.length + " / " + refsNow.length + " 张，继续生成中…"; continue; }
        const id = d.task_id || d.id || d.data?.task_id;
        if (r.ok && id) { batchTasks.push({taskId:id, status:'QUEUED', referenceImage:ref}); continue; }
        failedNow++; batchTasks.push({taskId:'direct-'+(batchTasks.length+1), status:'FAILURE', error:d.error?.message || d.message || ('HTTP '+r.status), referenceImage:ref}); log('单张图片生成失败：'+(d.error?.message || d.message || ('HTTP '+r.status)), 'error');
      } catch (e) { failedNow++; batchTasks.push({taskId:'direct-'+(batchTasks.length+1), status:'FAILURE', error:e.message || '网络错误', referenceImage:ref}); log('单张图片请求异常：'+(e.message || '网络错误'), 'error'); }
    }
    if (batchTasks.length) { await chrome.storage.local.set({activeTask:{batch:true, provider:"hfsy", startedAt:Date.now(), status:"POLLING", resultUrls:[...resultUrls]}, batchTasks}); await chrome.runtime.sendMessage({ type:"START_HFSY_POLL", apiKey:keyNow }); await watchHfsyInBackground(keyNow); }
    else await finish('生成结束：成功 '+resultUrls.length+' 张，失败 '+failedNow+' 张。');
    $('generate').disabled = false;
  };
  const rawGenerate = generate;
  generate = async function() { if (!(await ensureLicensed())) return; return rawGenerate.apply(this, arguments); };
  const rawSaveBatch = saveBatch;
  saveBatch = async function() { if (!(await ensureLicensed())) return false; return rawSaveBatch.apply(this, arguments); };
  const rawReplace = replaceToDianxiaomi;
  replaceToDianxiaomi = async function() { if (!(await ensureLicensed())) return; return rawReplace.apply(this, arguments); };
  ["api-key", "prompt", "filter-placeholders"].forEach(id => $(id)?.addEventListener("change", () => chrome.storage.local.set({ apiKey: $("api-key").value, prompt: $("prompt").value, filterPlaceholders: $("filter-placeholders").checked })));
})();
