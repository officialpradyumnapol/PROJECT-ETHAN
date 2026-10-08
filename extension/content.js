(() => {
  const API = globalThis.browser ?? globalThis.chrome;
  const PROVIDER = (() => {
    const h = location.hostname;
    if (h === 'chatgpt.com' || h === 'chat.openai.com') return 'chatgpt';
    if (h === 'claude.ai') return 'claude';
    if (h === 'gemini.google.com') return 'gemini';
    if (h === 'perplexity.ai' || h.endsWith('.perplexity.ai')) return 'perplexity';
    if (h === 'grok.com') return 'grok';
    return null;
  })();
  if (!PROVIDER) return;

  const cfg = {
    chatgpt: {
      input: ['#prompt-textarea','textarea[placeholder*="Message"]','div[contenteditable="true"][data-placeholder]','div[contenteditable="true"][role="textbox"]'],
      send: ['button[data-testid="send-button"]','button[aria-label*="Send" i]'],
      stop: ['button[data-testid="stop-button"]','button[aria-label*="Stop" i]'],
      assistant: ['[data-message-author-role="assistant"]'],
      done: ['button[data-testid="copy-turn-action-button"]']
    },
    claude: {
      input: ['div.ProseMirror[contenteditable="true"]','div[contenteditable="true"][role="textbox"]','textarea'],
      send: ['button[aria-label="Send message"]','button[aria-label="Send Message"]','button[type="submit"]'],
      stop: ['button[aria-label*="Stop response" i]','button[aria-label*="Stop" i]'],
      assistant: ['.font-claude-response','div[data-is-streaming="false"]','div[data-is-streaming="true"]'],
      done: ['button[data-testid="action-bar-copy"]']
    },
    gemini: {
      input: ['rich-textarea div.ql-editor[contenteditable="true"]','div.ql-editor[contenteditable="true"]','div[contenteditable="true"][role="textbox"]'],
      send: ['button.send-button','button[aria-label*="Send" i]'],
      stop: ['button[aria-label*="Stop response" i]','button.stop'],
      assistant: ['message-content','.model-response-text','div.response-content'],
      done: ['button[aria-label*="Copy" i]']
    },
    perplexity: {
      input: ['#ask-input','textarea','div[contenteditable="true"][role="textbox"]'],
      send: ['button[aria-label="Submit"]','button[data-testid="submit-button"]','button[type="submit"]'],
      stop: ['button[aria-label*="Stop" i]'],
      assistant: ['div[id^="markdown-content"]','div.prose'],
      done: ['button[aria-label="Copy"]']
    },
    grok: {
      input: ['textarea','div.tiptap[contenteditable="true"]','div[contenteditable="true"][role="textbox"]'],
      send: ['button[type="submit"]','button[aria-label*="Submit" i]','button[aria-label*="Send" i]'],
      stop: ['button[aria-label*="Stop" i]'],
      assistant: ['div.response-content-markdown','div.message-bubble'],
      done: ['button[aria-label="Copy"]']
    }
  }[PROVIDER];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const first = selectors => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const all = selectors => selectors.flatMap(s => [...document.querySelectorAll(s)]);
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const waitFor = async (fn, timeout=30000, interval=250) => {
    const end = Date.now()+timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    throw new Error('Timed out waiting for the chat page. Make sure you are logged in.');
  };
  const setInput = (el, text) => {
    el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges(); sel.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      if (!ok) { el.textContent = text; el.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:text})); }
    } else {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    }
  };
  const textOf = el => (el?.innerText || el?.textContent || '').replace(/\u00a0/g,' ').trim();
  const isGenerating = () => all(cfg.stop).some(visible);
  const assistantNodes = () => {
    for (const s of cfg.assistant) {
      const found = [...document.querySelectorAll(s)].filter(visible);
      if (found.length) return found;
    }
    return [];
  };
  const lastAssistant = () => assistantNodes().at(-1) || null;

  async function installFiles(input, files) {
    if (!input || !files?.length) return;
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.dataBase64), c => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, {type:f.mime || 'application/octet-stream'}));
    }
    input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    await sleep(1200);
  }

  async function captureFiles(node) {
    const out = [];
    const seen = new Set();
    const add = (f) => {
      const key = f.name + ':' + f.dataBase64.length;
      if (!seen.has(key)) { seen.add(key); out.push(f); }
    };
    if (!node) return out;
    const imgs = [...node.querySelectorAll('img')].filter(i => i.naturalWidth >= 200).slice(0,5);
    for (let i=0; i<imgs.length; i++) {
      try {
        const src = imgs[i].currentSrc || imgs[i].src;
        if (!src) continue;
        const r = await fetch(src, {credentials:'include'});
        const blob = await r.blob();
        if (blob.size > 25*1024*1024) continue;
        add({name:`${PROVIDER}-image-${i+1}.${(blob.type.split('/')[1]||'png').split(';')[0]}`,mime:blob.type||'image/png',dataBase64:await blobToBase64(blob)});
      } catch {}
    }
    const links = [...node.querySelectorAll('a[download],a[href]')].filter(a => {
      const href = a.href || '';
      return a.hasAttribute('download') || /\.(pdf|zip|png|jpe?g|webp|gif|csv|json|txt|md|docx?|xlsx?|pptx?)($|\?)/i.test(href);
    }).slice(0,5);
    for (const a of links) {
      try {
        const r = await fetch(a.href, {credentials:'include'});
        const blob = await r.blob();
        if (!blob.size || blob.size > 25*1024*1024) continue;
        const name = ((a.getAttribute('download') || a.textContent || 'download').trim().replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 100)) || 'download';
        add({name, mime:blob.type||'application/octet-stream',dataBase64:await blobToBase64(blob)});
      } catch {}
    }
    return out.slice(0,8);
  }
  const blobToBase64 = blob => new Promise((resolve,reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  let cancelled = false;
  let running = false;
  async function run(task) {
    if (running) { API.runtime.sendMessage({kind:'provider_error', id:task.id, provider:PROVIDER, message:'This provider tab is still busy with another task.'}).catch(()=>{}); return; }
    running = true;
    cancelled = false;
    const send = (m) => API.runtime.sendMessage(m).catch(()=>{});
    try {
      send({kind:'provider_status', id:task.id, provider:PROVIDER, state:'opening'});
      const input = await waitFor(() => {
        const e = first(cfg.input);
        return e && visible(e) ? e : null;
      }, 30000);
      const fileInput = document.querySelector('input[type="file"]');
      if (task.files?.length && fileInput) await installFiles(fileInput, task.files);

      const beforeNodes = assistantNodes();
      const beforeLast = textOf(beforeNodes.at(-1));
      send({kind:'provider_status', id:task.id, provider:PROVIDER, state:'sending'});
      setInput(input, task.prompt);
      await sleep(150);
      const btn = first(cfg.send);
      if (btn && visible(btn)) btn.click();
      else {
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
        input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));
      }

      send({kind:'provider_status', id:task.id, provider:PROVIDER, state:'waiting'});
      const started = Date.now();
      let last = '';
      let stable = 0;
      let sawNew = false;
      while (Date.now() - started < 300000) {
        if (cancelled) { first(cfg.stop)?.click(); throw new Error('Cancelled'); }
        const node = lastAssistant();
        const t = textOf(node);
        const nodes = assistantNodes();
        if (nodes.length > beforeNodes.length || (t && t !== beforeLast)) sawNew = true;
        if (t && t !== last) {
          last = t; stable = 0;
          send({kind:'provider_delta', id:task.id, provider:PROVIDER, text:t});
        } else if (sawNew && t) {
          stable++;
        }
        const generating = isGenerating();
        if (sawNew && !generating && stable >= 4) break;
        if (sawNew && stable >= 8 && !generating) break;
        await sleep(750);
      }
      if (!last) throw new Error('No assistant response was detected. The site may have changed its page structure.');
      const node = lastAssistant();
      const files = await captureFiles(node);
      const links = [...(node?.querySelectorAll('a[href]') || [])]
        .map(a => ({url: a.href, label: (a.textContent || a.getAttribute('aria-label') || '').trim()}))
        .filter(x => /^https?:\/\//i.test(x.url));
      const plainUrls = last.match(/https?:\/\/[^\s<>\"')\]]+/gi) || [];
      for (const url of plainUrls) links.push({url, label:''});
      const uniqueLinks = links
        .filter((x,i,a) => a.findIndex(y => y.url === x.url) === i)
        .slice(0,30);
      send({kind:'provider_status', id:task.id, provider:PROVIDER, state:'capturing'});
      send({kind:'provider_result', id:task.id, provider:PROVIDER, text:last, files, links:uniqueLinks, conversationUrl:location.href});
    } catch (e) {
      send({kind:'provider_error', id:task.id, provider:PROVIDER, message:e?.message || String(e)});
    } finally {
      running = false;
    }
  }

  API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.kind === 'cancel_task') {
      cancelled = true;
      first(cfg.stop)?.click();
      sendResponse({ok:true});
      return true;
    }
    if (msg?.kind === 'run_task') {
      run(msg.task);
      sendResponse({ok:true});
      return true;
    }
    if (msg?.kind === 'ping') { sendResponse({ok:true,provider:PROVIDER}); return true; }
    return false;
  });

  API.runtime.sendMessage({kind:'provider_ready', provider:PROVIDER, url:location.href}).catch(()=>{});
})();
