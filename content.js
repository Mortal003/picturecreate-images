(() => {
  const placeholderPattern = /(loading|placeholder|default|no[-_ ]?image|skeleton|addImg|kong-|qiyukf\.nosdn|dxm-web[^/]*assets)/i;
  const FLOAT_POSITION_KEY = 'floatButtonPosition';
  const FLOAT_MARGIN = 8;
  const DRAG_THRESHOLD = 5;
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
      const stored = await chrome.storage.local.get(FLOAT_POSITION_KEY);
      const applied = applyPosition(host, stored?.[FLOAT_POSITION_KEY]);
      if (stored?.[FLOAT_POSITION_KEY] && (applied.left !== Number(stored[FLOAT_POSITION_KEY].left) || applied.top !== Number(stored[FLOAT_POSITION_KEY].top))) {
        await chrome.storage.local.set({ [FLOAT_POSITION_KEY]: applied });
      }
    } catch {
      applyPosition(host);
    }
  };
  function mountFloatButton() {
    if (document.getElementById('image-workflow-float-host')) return;
    const host = document.createElement('div'); host.id='image-workflow-float-host'; host.style.cssText='position:fixed;right:20px;bottom:90px;z-index:2147483647;font:13px Arial,Microsoft YaHei,sans-serif';
    host.innerHTML='<button id="iw-launch" title="打开商品生图助手" style="border:0;border-radius:999px;background:#176b45;color:#fff;padding:11px 16px;font-weight:700;box-shadow:0 8px 24px #12372347;cursor:pointer">商品生图</button>'; document.documentElement.appendChild(host);
    const button = host.querySelector('#iw-launch');
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
      dragging = false;
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      gesturePointerId = null;
      host.style.cursor = '';
      button.style.cursor = 'pointer';
      if (moved) {
        ignoreNextClick = true;
        try { await chrome.storage.local.set({ [FLOAT_POSITION_KEY]: { left: parseFloat(host.style.left), top: parseFloat(host.style.top) } }); } catch {}
      }
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
    const openPanel = async () => {
      if (openLocked) return;
      openLocked = true;
      const original = button.textContent;
      button.textContent = '正在打开…';
      try {
        const response = await Promise.race([
          chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('打开侧边栏超时，请刷新当前网页')), 2000))
        ]);
        if (!response?.ok) throw new Error(response?.error || '打开侧边栏失败，请刷新当前网页');
        button.textContent = '已打开';
      } catch (error) {
        button.textContent = '刷新页面';
        button.title = error.message || '插件已更新，请刷新当前网页';
        setTimeout(() => { button.textContent = original; }, 1800);
      } finally { setTimeout(() => { openLocked = false; }, 250); }
    };
    button.onclick = event => { if (ignoreNextClick) { ignoreNextClick = false; return; } if (gesturePointerId !== null) return; openPanel(); };
    window.addEventListener('blur', event => { if (dragging) finishDrag(event); });
    restorePosition(host);
    window.addEventListener('resize', () => {
      const applied = applyPosition(host, { left: parseFloat(host.style.left), top: parseFloat(host.style.top) });
      chrome.storage.local.set({ [FLOAT_POSITION_KEY]: applied }).catch(() => {});
    });
  }
  mountFloatButton();
  const observer=new MutationObserver(()=>{if(!document.getElementById('image-workflow-float-host'))mountFloatButton();}); observer.observe(document.documentElement,{childList:true,subtree:true});
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
        const edit=[...scope.querySelectorAll('a')].find(e=>visible(e)&&txt(e).includes('编辑图片'));
        if(!choose||!edit)throw Error('未找到产品图片操作按钮。');
        const before=realCount(); await hoverClick(edit); await wait(450); menu('清空图片');
        let confirmed=false;
        for(let i=0;i<40;i++){
          await wait(150);
          const dialog=[...document.querySelectorAll('.ant-modal-confirm,.ant-modal-wrap,[role="dialog"]')].find(x=>visible(x)&&/(清空全部图片|清空图片)/.test(txt(x).replace(/\s+/g,'')));
          if(!dialog)continue;
          const ok=dialog.querySelector('.ant-modal-confirm-btns .ant-btn-primary')||[...dialog.querySelectorAll('button')].find(b=>visible(b)&&/^(确定|确认)$/.test(txt(b).replace(/\s+/g,'')));
          if(ok){ok.click();confirmed=true;break;}
        }
        if(!confirmed)throw Error('未检测到清空图片确认框。');
        await wait(1200); const afterClear=realCount(); if(afterClear>=before&&before>0)throw Error('清空图片后原图仍存在，已停止上传。');
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
        if(delayedUploaded<links.length)throw Error('添加后等待 10 秒，检测到 '+delayedUploaded+' 张图片，预期 '+links.length+' 张。');
        sendResponse({ok:true,before,afterClear,uploaded:delayedUploaded,expected:links.length});
      }catch(error){sendResponse({ok:false,error:error.message});}
    })(); return true;
  });
})();
