const API = globalThis.browser ?? globalThis.chrome;
const NATIVE_APP = 'browser';
const PROVIDER_URL = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  perplexity: 'https://www.perplexity.ai/',
  grok: 'https://grok.com/'
};

let nativePort = null;
let engineConnected = false;
const providerTabs = new Map();
const tasks = new Map();

function emit(msg) {
  try {
    if (nativePort) {
      nativePort.postMessage(msg);
      return true;
    }
  } catch (_) { nativePort = null; }
  return false;
}

function handleBridgeMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'native_ready') {
    engineConnected = true;
    emit({type:'extension_hello', version:'1.0.0', platform:'android'});
  } else if (msg.type === 'extension_task') {
    void handleTask(msg);
  } else if (msg.type === 'extension_cancel') {
    void cancelTask(msg.id);
  } else if (msg.type === 'extension_open' || msg.type === 'extension_show') {
    void ensureProviderTab(msg.provider).catch(e => emit({type:'extension_error', provider:msg.provider, message:e?.message || String(e)}));
  } else if (msg.type === 'extension_close') {
    void closeProviderTab(msg.provider);
  } else if (msg.type === 'extension_ping') {
    emit({type:'extension_ping'});
  }
}

function connectNative() {
  if (typeof API?.runtime?.connectNative !== 'function') return false;
  try {
    nativePort = API.runtime.connectNative(NATIVE_APP);
    nativePort.onMessage.addListener(handleBridgeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      engineConnected = false;
      for (const [id] of tasks) tasks.delete(id);
    });
    engineConnected = true;
    emit({type:'extension_hello', version:'1.0.0', platform:'android'});
    return true;
  } catch (_) {
    nativePort = null;
    engineConnected = false;
    return false;
  }
}

async function findTab(provider) {
  const patterns = {
    chatgpt:['https://chatgpt.com/*','https://chat.openai.com/*'],
    claude:['https://claude.ai/*'],
    gemini:['https://gemini.google.com/*'],
    perplexity:['https://www.perplexity.ai/*'],
    grok:['https://grok.com/*']
  }[provider];
  const tabs = await API.tabs.query({url:patterns});
  return tabs.find(t => t.id != null) || null;
}

async function ensureProviderTab(provider) {
  if (!PROVIDER_URL[provider]) throw new Error(`Unknown provider: ${provider}`);
  if (providerTabs.has(provider)) {
    try {
      const tab = await API.tabs.get(providerTabs.get(provider));
      if (tab?.id != null) {
        emit({type:'extension_ready',provider,tabId:tab.id,url:tab.url || ''});
        return tab;
      }
    } catch (_) {}
    providerTabs.delete(provider);
  }
  const found = await findTab(provider);
  if (found?.id != null) {
    providerTabs.set(provider, found.id);
    emit({type:'extension_ready',provider,tabId:found.id,url:found.url || ''});
    return found;
  }
  const tab = await API.tabs.create({url:PROVIDER_URL[provider], active:false});
  if (tab?.id == null) throw new Error(`Could not create provider tab for ${provider}`);
  providerTabs.set(provider, tab.id);
  return tab;
}

async function dispatchToTab(tabId, task) {
  const deadline = Date.now()+60000;
  while (Date.now() < deadline) {
    try { await API.tabs.sendMessage(tabId,{kind:'run_task',task}); return; }
    catch (_) { await new Promise(r=>setTimeout(r,500)); }
  }
  throw new Error('Provider page did not become ready. Open the browser view and log in once.');
}

function waitTabComplete(tabId, timeout = 30000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; API.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); setTimeout(resolve, 800); };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const t = setTimeout(finish, timeout);
    API.tabs.onUpdated.addListener(onUpd);
  });
}
async function handleTask(task) {
  try {
    const tab = await ensureProviderTab(task.provider);
    if (task.newConversation) {
      await API.tabs.update(tab.id,{url:PROVIDER_URL[task.provider],active:false});
      await waitTabComplete(tab.id);
    }
    tasks.set(task.id,{tabId:tab.id,provider:task.provider});
    await dispatchToTab(tab.id,task);
  } catch (e) {
    emit({type:'extension_error',id:task.id,provider:task.provider,message:e?.message||String(e)});
    tasks.delete(task.id);
  }
}

async function cancelTask(id) {
  const t = tasks.get(id);
  if (!t) return;
  try { await API.tabs.sendMessage(t.tabId,{kind:'cancel_task'}); } catch (_) {}
}

async function closeProviderTab(provider) {
  const id = providerTabs.get(provider);
  if (id == null) return;
  try { await API.tabs.remove(id); } catch (_) {}
  providerTabs.delete(provider);
}

API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.kind === 'provider_ready') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      providerTabs.set(msg.provider, tabId);
      emit({type:'extension_ready',provider:msg.provider,tabId,url:sender.tab?.url || msg.url || ''});
    }
    sendResponse?.({ok:true});
    return true;
  }
  if (msg?.kind === 'provider_status') { emit({type:'extension_status',id:msg.id,provider:msg.provider,state:msg.state,tabId:sender.tab?.id}); sendResponse?.({ok:true}); return true; }
  if (msg?.kind === 'provider_delta') { emit({type:'extension_delta',id:msg.id,provider:msg.provider,text:msg.text}); sendResponse?.({ok:true}); return true; }
  if (msg?.kind === 'provider_result') { emit({type:'extension_result',id:msg.id,provider:msg.provider,text:msg.text,files:msg.files||[],links:msg.links||[],conversationUrl:msg.conversationUrl,tabId:sender.tab?.id}); tasks.delete(msg.id); sendResponse?.({ok:true}); return true; }
  if (msg?.kind === 'provider_error') { emit({type:'extension_error',id:msg.id,provider:msg.provider,message:msg.message}); tasks.delete(msg.id); sendResponse?.({ok:true}); return true; }
});

API.tabs.onRemoved.addListener(tabId => { for (const [p,id] of providerTabs) if (id===tabId) providerTabs.delete(p); });

// Native GeckoView entry point. The Android asset intentionally uses only GeckoView native messaging.
connectNative();
