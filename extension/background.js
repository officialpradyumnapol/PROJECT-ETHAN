const API = globalThis.browser ?? globalThis.chrome;
const PROVIDER_URL = {
  chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app',
  perplexity: 'https://www.perplexity.ai/', grok: 'https://grok.com/'
};
const PATTERNS = {
  chatgpt: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], claude: ['https://claude.ai/*'],
  gemini: ['https://gemini.google.com/*'], perplexity: ['https://www.perplexity.ai/*'], grok: ['https://grok.com/*']
};
const providerTabs = new Map();
const tasks = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const toChat = (msg) => API.runtime.sendMessage(msg).catch(() => {});

// Clicking the toolbar icon opens (or focuses) the chat window.
API.action.onClicked.addListener(async () => {
  const url = API.runtime.getURL('chat.html');
  const open = await API.tabs.query({ url });
  if (open[0]?.id != null) {
    await API.tabs.update(open[0].id, { active: true });
    if (open[0].windowId != null && API.windows?.update) API.windows.update(open[0].windowId, { focused: true }).catch(() => {});
  } else await API.tabs.create({ url });
});

function waitTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; API.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); setTimeout(resolve, 1000); };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const t = setTimeout(finish, timeout);
    API.tabs.onUpdated.addListener(onUpd);
  });
}
async function findTab(provider) {
  const tabs = await API.tabs.query({ url: PATTERNS[provider] });
  return tabs.find((t) => t.id != null) || null;
}
async function ensureProviderTab(provider) {
  if (!PROVIDER_URL[provider]) throw new Error(`Unknown provider: ${provider}`);
  if (providerTabs.has(provider)) {
    try { const t = await API.tabs.get(providerTabs.get(provider)); if (t?.id != null) return t; } catch {}
    providerTabs.delete(provider);
  }
  const found = await findTab(provider);
  if (found) { providerTabs.set(provider, found.id); return found; }
  const tab = await API.tabs.create({ url: PROVIDER_URL[provider], active: false });
  if (tab?.id == null) throw new Error(`Could not open a tab for ${provider}`);
  providerTabs.set(provider, tab.id);
  await waitTabComplete(tab.id);
  return tab;
}
async function dispatchToTab(tabId, task) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { await API.tabs.sendMessage(tabId, { kind: 'run_task', task }); return; }
    catch { await wait(500); }
  }
  throw new Error('The provider page did not respond. Reload that provider tab, make sure you are logged in, then try again.');
}
async function handleTask(task) {
  try {
    const tab = await ensureProviderTab(task.provider);
    if (task.newConversation) {
      await API.tabs.update(tab.id, { url: PROVIDER_URL[task.provider], active: false });
      await waitTabComplete(tab.id);
    }
    tasks.set(task.id, { tabId: tab.id, provider: task.provider });
    await dispatchToTab(tab.id, task);
  } catch (e) {
    toChat({ kind: 'provider_error', id: task.id, provider: task.provider, message: e?.message || String(e) });
    tasks.delete(task.id);
  }
}
API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'chat_task') { handleTask(msg.task); sendResponse({ ok: true }); return true; }
  if (msg?.kind === 'chat_cancel') {
    const tabId = tasks.get(msg.id)?.tabId ?? providerTabs.get(msg.provider);
    if (tabId != null) API.tabs.sendMessage(tabId, { kind: 'cancel_task' }).catch(() => {});
    sendResponse({ ok: true }); return true;
  }
  if (msg?.kind === 'open_all') {
    Promise.all(Object.keys(PROVIDER_URL).map((p) => ensureProviderTab(p).catch(() => null))).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.kind === 'provider_result' || msg?.kind === 'provider_error') tasks.delete(msg.id);
  return false;
});
API.tabs.onRemoved.addListener((tabId) => { for (const [p, id] of providerTabs) if (id === tabId) providerTabs.delete(p); });
