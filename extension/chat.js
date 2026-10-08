'use strict';
const API = globalThis.browser ?? globalThis.chrome;
const PROVIDERS = [
  { id: 'claude', name: 'Claude', accent: '#D97757' }, { id: 'chatgpt', name: 'ChatGPT', accent: '#10A37F' },
  { id: 'gemini', name: 'Gemini', accent: '#4F8CFF' }, { id: 'perplexity', name: 'Perplexity', accent: '#20B8CD' },
  { id: 'grok', name: 'Grok', accent: '#E5E7EB' },
];
const ALL = [{ id: 'auto', name: 'Auto', accent: '#FFB400' }, ...PROVIDERS];
const info = (id) => ALL.find((p) => p.id === id) || ALL[0];
const RULES = [
  [/\b(research|latest|news|sources?|cite|citations?|who is|what happened|price of|compare)\b/i, 'perplexity'],
  [/\b(tweet|twitter|x\.com|trending|reddit|meme|viral)\b/i, 'grok'],
  [/\b(image|photo|picture|youtube|video|google|maps|translate|gmail)\b/i, 'gemini'],
  [/\b(code|bug|refactor|function|typescript|python|react|script|analy[sz]e|document|pdf|essay|summari[sz]e)\b/i, 'claude'],
];
const pick = (p) => RULES.find(([re]) => re.test(p))?.[1] ?? 'chatgpt';
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let choice = store.get('choice', 'auto'), newConv = false, attach = [];
let msgs = store.get('msgs', []);
msgs.forEach((m) => { if (m.role === 'ai' && m.state && m.state !== 'done' && m.state !== 'error') { m.state = 'error'; m.text = m.text || 'Interrupted before it finished.'; } });
const save = () => store.set('msgs', msgs.slice(-60).map(({ files, ...rest }) => rest));
const busyOf = (m) => m.role === 'ai' && m.state && m.state !== 'done' && m.state !== 'error';

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
function md(src) {
  const out = [];
  src.split(/```/).forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n'), lang = nl >= 0 ? part.slice(0, nl).trim() : '', code = nl >= 0 ? part.slice(nl + 1) : part;
      out.push(`<div class="codebox"><div class="codehead"><span>${esc(lang || 'code')}</span><button data-copy>COPY</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
      return;
    }
    let list = null;
    const flush = () => { if (list) { out.push(`</${list}>`); list = null; } };
    part.split('\n').forEach((line) => {
      let m;
      if ((m = /^(#{1,3})\s+(.*)/.exec(line))) { flush(); out.push(`<p><strong>${inline(m[2])}</strong></p>`); }
      else if ((m = /^\s*[-*•]\s+(.*)/.exec(line))) { if (list !== 'ul') { flush(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(line))) { if (list !== 'ol') { flush(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
      else if (line.trim()) { flush(); out.push(`<p>${inline(line)}</p>`); } else flush();
    });
    flush();
  });
  return out.join('');
}

function renderPickers() {
  const el = $('chips'); el.innerHTML = '';
  ALL.forEach((p) => {
    const on = p.id === choice, b = document.createElement('button');
    b.className = 'chip'; b.style.borderColor = on ? p.accent : ''; b.style.background = on ? p.accent + '26' : 'transparent';
    b.innerHTML = `<span class="dot" style="background:${p.accent}"></span><span style="color:${on ? p.accent : 'inherit'}">${p.name}</span>`;
    b.onclick = () => { choice = p.id; store.set('choice', choice); renderPickers(); sync(); };
    el.appendChild(b);
  });
}
function sync() {
  const p = info(choice);
  $('text').placeholder = `Task for ${p.name}…`;
  document.documentElement.style.setProperty('--accent', p.accent);
  $('newc').classList.toggle('on', newConv);
  $('send').disabled = msgs.some(busyOf);
}
function renderList() {
  const l = $('list'), near = l.scrollHeight - l.scrollTop - l.clientHeight < 120;
  if (!msgs.length) l.innerHTML = '<div class="empty">Pick an AI above (or leave it on Auto) and send a task. First click “OPEN AI SITES” and log in to each site once.</div>';
  else l.innerHTML = msgs.map((m) => {
    if (m.role === 'user') return `<div class="bubble mine"><div class="msg">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
    const p = info(m.provider || 'auto'), run = busyOf(m);
    return `<div class="bubble ai" style="border-color:${p.accent}66"><div class="who-row"><span class="who" style="color:${p.accent}">${p.name}</span>
      ${run ? `<span class="state">${m.state}…</span><button class="stop" data-stop="${m.id}">✕ stop</button>` : `<button data-copyall="${m.id}">COPY</button>`}</div>
      <div class="msg ${m.state === 'error' ? 'err' : ''}">${m.state === 'error' ? esc(m.text) : md(m.text || ' ')}</div>
      ${(m.links || []).slice(0, 10).map((x) => `<a class="file" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(x.label || x.url)}</a>`).join('')}
      ${(m.files || []).map((f) => `<a class="file" href="${f.url}" download="${esc(f.name)}">⬇ ${esc(f.name)} · ${(f.size / 1024).toFixed(1)} KB</a>`).join('')}</div>`;
  }).join('');
  if (near) l.scrollTop = l.scrollHeight;
  sync();
}
function renderAttach() {
  const a = $('attach'); a.hidden = !attach.length;
  a.innerHTML = attach.length ? `📎 ${esc(attach.map((f) => f.name).join(', '))} <button id="rm">remove</button>` : '';
  if (attach.length) $('rm').onclick = () => { attach = []; renderAttach(); };
}

// replies from the provider pages arrive straight from the content scripts
API.runtime.onMessage.addListener((m) => {
  if (!m || !String(m.kind).startsWith('provider_') || !m.id) return false;
  const t = msgs.find((x) => x.id === 'a-' + m.id);
  if (!t) return false;
  if (m.kind === 'provider_status') t.state = m.state;
  else if (m.kind === 'provider_delta') t.text = m.text;
  else if (m.kind === 'provider_result') {
    t.text = m.text; t.state = 'done'; t.links = m.links || [];
    t.files = (m.files || []).map((f) => {
      const bytes = Uint8Array.from(atob(f.dataBase64), (c) => c.charCodeAt(0));
      return { name: f.name, size: bytes.length, url: URL.createObjectURL(new Blob([bytes], { type: f.mime || 'application/octet-stream' })) };
    });
  } else if (m.kind === 'provider_error') { t.text = m.message; t.state = 'error'; }
  save(); renderList();
  return false;
});

function submit() {
  const prompt = $('text').value.trim();
  if (!prompt || msgs.some(busyOf)) return;
  const provider = choice === 'auto' ? pick(prompt) : choice;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  msgs.push({ id: 'u-' + id, role: 'user', text: attach.length ? `${prompt}\n📎 ${attach.map((f) => f.name).join(', ')}` : prompt });
  msgs.push({ id: 'a-' + id, role: 'ai', text: '', state: 'queued', provider });
  const task = { id, provider, prompt, newConversation: newConv, files: attach.length ? attach : undefined };
  API.runtime.sendMessage({ kind: 'chat_task', task }).catch((e) => {
    const t = msgs.find((x) => x.id === 'a-' + id); if (t) { t.state = 'error'; t.text = 'Could not reach the extension: ' + (e?.message || e); }
    save(); renderList();
  });
  $('text').value = ''; $('text').style.height = ''; attach = []; newConv = false;
  save(); renderAttach(); renderList();
}
const readFile = (f) => new Promise((res, rej) => {
  if (f.size > 20 * 1024 * 1024) return res(null);
  const r = new FileReader();
  r.onload = () => res({ name: f.name, mime: f.type || 'application/octet-stream', dataBase64: String(r.result).split(',')[1] || '' });
  r.onerror = rej; r.readAsDataURL(f);
});
$('send').onclick = submit;
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); submit(); } });
$('text').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; });
$('newc').onclick = () => { newConv = !newConv; sync(); };
$('plus').onclick = () => $('file').click();
$('file').onchange = async (e) => { attach.push(...(await Promise.all([...e.target.files].map(readFile))).filter(Boolean)); e.target.value = ''; renderAttach(); };
$('clear').onclick = () => { msgs = []; save(); renderList(); };
$('openall').onclick = () => { API.runtime.sendMessage({ kind: 'open_all' }).catch(() => {}); $('note').textContent = 'Opening the AI sites in background tabs. Switch to each one and log in if needed.'; };
async function copy(text, btn) {
  const o = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'COPIED'; } catch { btn.textContent = 'FAILED'; }
  setTimeout(() => (btn.textContent = o), 1200);
}
$('list').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.copy !== undefined) copy(b.closest('.codebox').querySelector('code').textContent, b);
  else if (b.dataset.copyall) copy(msgs.find((m) => m.id === b.dataset.copyall)?.text || '', b);
  else if (b.dataset.stop) { const m = msgs.find((x) => x.id === b.dataset.stop); API.runtime.sendMessage({ kind: 'chat_cancel', id: b.dataset.stop.slice(2), provider: m?.provider }).catch(() => {}); }
});
renderPickers(); renderList(); renderAttach(); $('list').scrollTop = $('list').scrollHeight;
