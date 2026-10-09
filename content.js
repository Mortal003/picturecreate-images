(() => {
  const placeholderPattern = /(loading|placeholder|default|no[-_ ]?image|skeleton|addImg|kong-|qiyukf\.nosdn|dxm-web[^/]*assets)/i;
  const FLOAT_POSITION_KEY = 'floatButtonPosition';
  const FLOAT_MARGIN = 8;
  const DRAG_THRESHOLD = 5;
  const isExtensionAlive = () => { try { return Boolean(chrome?.runtime?.id); } catch { return false; } };
  const getImages = (includePlaceholders = false) => Array.from(document.images).map((img,index) => ({ index, src: img.currentSrc || img.src, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, alt: img.alt || '', placeholder: placeholderPattern.test((img.currentSrc || img.src || '') + ' ' + (img.alt || '')) })).filter(x => x.src && x.width >= 80 && x.height >= 80 && (includePlaceholders || !x.placeholder));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const defaultPosition = host => ({
    left: Math.max(FLOAT_MARGIN, window.innerWidth - host.offsetWidth - 20),
    top: Math.max(FLOAT_MARGIN, window.innerHeight - host.offsetHeight - 90)
  });
  const applyPosition = (host, position) => {
    const fallback = defaultPosition(host);
    const left = Number(position?.left);
    const top = Number(position?.top);
    const width = host.offsetWidth || 120;
    const height = host.offsetHeight || 42;
    const safeLeft = Number.isFinite(left) ? clamp(left, FLOAT_MARGIN, window.innerWidth - width - FLOAT_MARGIN) : fallback.left;
    const safeTop = Number.isFinite(top) ? clamp(top, FLOAT_MARGIN, window.innerHeight - height - FLOAT_MARGIN) : fallback.top;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${safeLeft}px`;
    host.style.top = `${safeTop}px`;
    return { left: safeLeft, top: safeTop };
  };
  const restorePosition = async host => {
    try {
      if (!isExtensionAlive()) return;
      const stored = await chrome.storage.local.get(FLOAT_POSITION_KEY);
      const applied = applyPosition(host, stored?.[FLOAT_POSITION_KEY]);
      if (stored?.[FLOAT_POSITION_KEY] && (applied.left !== Number(stored[FLOAT_POSITION_KEY].left) || applied.top !== Number(stored[FLOAT_POSITION_KEY].top))) {
        if (!isExtensionAlive()) return;
        await chrome.storage.local.set({ [FLOAT_POSITION_KEY]: applied });
      }
    } catch {
      applyPosition(host);
    }
  };
  function mountFloatButton() {
    if (document.getElementById('image-workflow-float-host')) return;
    const host = document.createElement('div'); host.id='image-workflow-float-host'; host.style.cssText='position:fixed;right:20px;bottom:90px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML='<style>:host{font:13px Arial,"Microsoft YaHei",sans-serif}button{appearance:none;border:1px solid #bfdbfe;border-radius:999px;background:linear-gradient(135deg,#60a5fa,#38bdf8);color:#fff;padding:11px 16px;font:700 13px Arial,"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(30,100,180,.28);cursor:pointer;outline:none;transition:transform .15s ease,box-shadow .15s ease,filter .15s ease}button:hover{filter:saturate(1.08) brightness(1.03);box-shadow:0 10px 28px rgba(30,100,180,.36);transform:translateY(-1px)}button:focus-visible{box-shadow:0 0 0 3px #fff,0 0 0 6px #60a5fa}button:active,button.dragging{transform:scale(.97);box-shadow:0 5px 14px rgba(30,100,180,.28);cursor:grabbing}button.loading{cursor:wait;filter:saturate(.82)}button.error{background:#fff;color:#b42318;border-color:#fecaca;box-shadow:0 8px 24px rgba(180,50,40,.18)}</style><button id="iw-launch" type="button" title="打开商品生图助手">商品生图</button>'; document.documentElement.appendChild(host);
    const button = root.querySelector('#iw-launch');
    let dragging = false;
    let moved = false;
    let openLocked = false;
    let gesturePointerId = null;
    let ignoreNextClick = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    const finishDrag = async event => {
      if (!dragging) return;
      const wasMoved = moved;
      dragging = false;
      if (event?.pointerId !== undefined && button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      gesturePointerId = null;
      host.style.cursor = '';
      button.style.cursor = 'pointer';
      button.classList.remove('dragging');
      if (wasMoved) {
        ignoreNextClick = true;
        try { if (isExtensionAlive()) await chrome.storage.local.set({ [FLOAT_POSITION_KEY]: { left: parseFloat(host.style.left), top: parseFloat(host.style.top) } }); } catch {}
      } else ignoreNextClick = false;
      moved = false;
    };
    button.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      dragging = true;
      moved = false;
      gesturePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      button.setPointerCapture?.(event.pointerId);
      host.style.cursor = 'grabbing';
      button.style.cursor = 'grabbing';
      button.classList.add('dragging');
    });
    button.addEventListener('pointermove', event => {
      if (!dragging) return;
      const rect = host.getBoundingClientRect();
      const nextLeft = clamp(event.clientX - offsetX, FLOAT_MARGIN, window.innerWidth - rect.width - FLOAT_MARGIN);
      const nextTop = clamp(event.clientY - offsetY, FLOAT_MARGIN, window.innerHeight - rect.height - FLOAT_MARGIN);
      if (Math.abs(event.clientX - startX) > DRAG_THRESHOLD || Math.abs(event.clientY - startY) > DRAG_THRESHOLD) moved = true;
      applyPosition(host, { left: nextLeft, top: nextTop });
      if (moved) event.preventDefault();
    });
    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
    button.addEventListener('lostpointercapture', event => { if (dragging) finishDrag(event); });
    const togglePanel = async () => {
      if (openLocked) return;
      openLocked = true;
      const original = '商品生图';
      button.classList.remove('error');
      button.classList.add('loading');
      button.textContent = '正在切换…';
      try {
        if (!isExtensionAlive()) throw new Error('插件已重新加载，请按 F5 刷新当前网页');
        const response = await Promise.race([
          chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('侧边栏操作超时，请按 F5 刷新当前网页')), 2000))
        ]);
        if (!response?.ok) throw new Error(response?.error || '侧边栏操作失败，请按 F5 刷新当前网页');
        button.classList.remove('loading');
        button.textContent = response.open ? '已打开' : '已关闭';
        setTimeout(() => { button.textContent = original; button.title = '打开/关闭商品生图助手'; }, 1000);
      } catch (error) {
        button.classList.remove('loading');
        button.classList.add('error');
        button.textContent = '刷新网页';
        button.title = error.message || '插件已更新，请按 F5 刷新当前网页';
        setTimeout(() => { button.classList.remove('error'); button.textContent = original; button.title = '打开/关闭商品生图助手'; }, 1800);
      } finally { setTimeout(() => { openLocked = false; }, 250); }
    };
    button.onclick = event => { if (ignoreNextClick) { ignoreNextClick = false; return; } if (gesturePointerId !== null || dragging) return; togglePanel(); };
    window.addEventListener('blur', event => { if (dragging) finishDrag(event); });
    restorePosition(host);
    window.addEventListener('resize', () => {
      try {
        if (!isExtensionAlive()) return;
        const applied = applyPosition(host, { left: parseFloat(host.style.left), top: parseFloat(host.style.top) });
        chrome.storage.local.set({ [FLOAT_POSITION_KEY]: applied }).catch(() => {});
      } catch {}
    });
  }
  mountFloatButton();
  const observer = new MutationObserver(() => {
    if (!isExtensionAlive()) {
      try { observer.disconnect(); } catch {}
      return;
    }
    if (!document.getElementById('image-workflow-float-host')) mountFloatButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type==='MOUNT_FLOAT'){mountFloatButton();sendResponse({ok:true});return true;}
    if(message?.type==='LIST_IMAGES'){sendResponse({images:getImages(Boolean(message.includePlaceholders))});return true;}
    if(message?.type!=='AUTO_REPLACE_DIANXIAOMI')return;
    (async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      const txt=e=>(e?.innerText||e?.textContent||'').trim();
      const scope=document.querySelector('#imageInfo')||document;
      const realCount=()=>[...scope.querySelectorAll('.img-list img, img.img-css')].filter(img=>visible(img)&&img.naturalWidth>=80&&img.naturalHeight>=80&&!/(addImg|kong-|loading|placeholder|qiyukf\.nosdn)/i.test(img.currentSrc||img.src||'')).length;
      const hoverClick=async el=>{['pointerover','mouseover','mouseenter'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,view:window})));await wait(220);el.click();};
      const menu=label=>{const wanted=label.replace(/\s+/g,'');const el=[...document.querySelectorAll('[role="menuitem"],li')].find(x=>visible(x)&&txt(x).replace(/\s+/g,'')===wanted);if(!el)throw Error('未找到菜单项：'+label);el.click();};
      try{
        if(!/dianxiaomi\.com$/.test(location.hostname))throw Error('当前页面不是店小秘产品编辑页。');
        const choose=[...scope.querySelectorAll('button')].find(e=>visible(e)&&txt(e)==='选择图片');
        if(!choose)throw Error('未找到产品图片操作按钮。');
        const before=realCount();
        // 历史流程曾是：编辑图片 → 清空图片 → 确认清空 → 网络图片 → 添加。
        // 当前追加上传流程保留该说明，但运行时不执行清空，避免删除客户已有图片。
        await hoverClick(choose); await wait(450); menu('网络图片'); await wait(500);
        const modal=[...document.querySelectorAll('.ant-modal-wrap,[role="dialog"]')].find(e=>visible(e)&&txt(e).includes('从网络地址(URL)选择图片'));
        if(!modal)throw Error('未找到网络图片输入弹窗。');
        const area=modal.querySelector('textarea[placeholder*="图片URL"]')||modal.querySelector('textarea');
        const add=[...modal.querySelectorAll('button')].find(e=>visible(e)&&txt(e).replace(/\s+/g,'')==='添加');
        const links=(message.urls||[]).map(String).map(x=>x.trim()).filter(x=>/^https?:\/\//i.test(x));
        if(!area||!add||!links.length)throw Error('未找到图片 URL 输入框或没有可上传链接。');
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set; if(setter)setter.call(area,links.join('\n')); else area.value=links.join('\n');
        area.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); area.dispatchEvent(new Event('change',{bubbles:true})); await wait(250); add.click();
        await wait(10000);
        const delayedUploaded=realCount();
        if(delayedUploaded<before+links.length)throw Error('添加后等待 10 秒，检测到 '+delayedUploaded+' 张图片，预期至少 '+(before+links.length)+' 张。');
        sendResponse({ok:true,before,uploaded:delayedUploaded,added:links.length,expected:before+links.length});
      }catch(error){sendResponse({ok:false,error:error.message});}
    })(); return true;
  });
})();
