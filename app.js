// ============ 分頁切換、設定 ============
const App = (() => {
  const $ = id => document.getElementById(id);
  let settings = null, tab = 'rev';

  async function init() {
    settings = await Api.getSettings();
    await U.loadPrefs();
    const pref = await chrome.storage.local.get(['tab']);
    tab = pref.tab === 'sched' ? 'sched' : 'rev';

    fillPrefOptions();
    document.querySelectorAll('.apptabs .seg button').forEach(b => (b.onclick = () => showTab(b.dataset.tab)));
    $('openSettings').onclick = () => openSettings(true);
    $('setSave').onclick = saveSettings;
    $('setCancel').onclick = () => showTab(tab);
    $('setName').addEventListener('keydown', e => { if (e.key === 'Enter') saveSettings(); });

    if (!settings.url || !settings.token || !settings.name) return openSettings(false);
    Rev.start(settings);
    showTab(tab);
  }

  function fillPrefOptions() {
    $('setDateFmt').innerHTML = U.FORMATS.map(([k, ex]) => `<option value="${k}">${ex}</option>`).join('');
    $('setStartDay').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}">星期${U.WD[i]}</option>`).join('');
  }

  function showTab(t) {
    tab = t;
    chrome.storage.local.set({ tab: t });
    $('setup').hidden = true;
    document.querySelectorAll('.apptabs .seg button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('rev').hidden = t !== 'rev';
    $('sched').hidden = t !== 'sched';
    placeTabs(t === 'sched');
    $('pop').hidden = true;
    if (t === 'rev') Rev.shown();
    else Sched.start(settings);
  }

  // 排班頁：分頁切換放到員工列表上方、⚙ 放到行事曆工具列，騰出上方空間給行事曆
  function placeTabs(inSched) {
    if (inSched) {
      $('poolTop').appendChild($('appSeg'));
      $('calTools').appendChild($('openSettings'));
      $('appTop').hidden = true;
    } else {
      $('appTop').append($('appSeg'), $('openSettings'));
      $('appTop').hidden = false;
    }
  }

  // 不管貼上的是完整網址、多了空白或換行、手機自動加的符號，或只有部署 ID，都整理成標準網址
  function normalizeUrl(raw) {
    const t = String(raw || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '');
    const m = t.match(/\/macros\/(?:[^/]+\/)?s\/([A-Za-z0-9_-]{20,})\/exec/) || t.match(/^(AKfyc[A-Za-z0-9_-]{20,})$/);
    return m ? `https://script.google.com/macros/s/${m[1]}/exec` : '';
  }

  // 預設連到自己的試算表（網址不是祕密，資料靠密碼保護）
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbxlEzS1wgC6NeG2M1kMqSSPNLTUqGETZUY3LEQOpskuzv3ajZgaPnuMdInb9hwzFq-tvw/exec';

  function openSettings(cancellable = true) {
    placeTabs(false);
    $('rev').hidden = true;
    $('sched').hidden = true;
    $('pop').hidden = true;
    $('setup').hidden = false;
    document.querySelectorAll('.apptabs .seg button').forEach(b => b.classList.remove('on'));
    $('setUrl').value = settings.url || normalizeUrl(decodeURIComponent((location.hash.match(/[#&]u=([^&]+)/) || [])[1] || '')) || DEFAULT_URL;
    $('setToken').value = settings.token || '';
    $('setName').value = settings.name || '';
    $('setDateFmt').value = U.prefs.dateFmt;
    $('setStartDay').value = String(U.prefs.startDay);
    $('setStores').value = U.prefs.stores.join(', ');
    $('setStoreShort').value = U.prefs.stores.map(c => U.storeLetter(c)).join(', ');
    $('setCancel').hidden = !cancellable;
    $('setMsg').hidden = true;
  }

  async function saveSettings() {
    const url = normalizeUrl($('setUrl').value);
    if (url) $('setUrl').value = url;
    const s = { url: url || $('setUrl').value.trim(), token: $('setToken').value.trim(), name: $('setName').value.trim() };
    const stores = [...new Set($('setStores').value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean))];
    const shorts = $('setStoreShort').value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
    const storeShort = {};
    stores.forEach((c, i) => { storeShort[c] = shorts[i] || c.charAt(0).toUpperCase(); });
    const p = { dateFmt: $('setDateFmt').value, startDay: Number($('setStartDay').value), stores, storeShort };
    const msg = (type, t) => { $('setMsg').className = 'msg ' + type; $('setMsg').textContent = t; $('setMsg').hidden = false; };
    if (!$('setUrl').value.trim()) return msg('err', '請貼上試算表網址');
    if (!url) return msg('err', '網址格式不對：請貼上 Apps Script 部署網址（https://script.google.com/macros/s/……/exec），或只貼 AKfycb 開頭的部署 ID');
    if (!s.token) return msg('err', '請填寫密碼');
    if (!s.name) return msg('err', '請填寫姓名');
    if (!stores.length) return msg('err', '請至少填一間店');

    $('setSave').disabled = true;
    msg('ok', '連線中…');
    try {
      const r = await Api.call({ action: 'ping' }, s);
      if (!r.ok) throw new Error(r.error || '連線失敗');
      const first = !settings.url;
      const connChanged = s.url !== settings.url || s.token !== settings.token || s.name !== settings.name;
      const prefsChanged = Object.keys(p).some(k => JSON.stringify(p[k]) !== JSON.stringify(U.prefs[k]));
      await chrome.storage.sync.set(s);
      await U.savePrefs(p);
      settings = s;
      if (first || connChanged) {
        Rev.start(settings);
        Sched.updateSettings(settings);
      } else if (prefsChanged) {
        Rev.refresh();
      }
      if (prefsChanged) Sched.prefsChanged();
      showTab(first ? 'rev' : tab);
    } catch (e) {
      msg('err', e.message);
    } finally {
      $('setSave').disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  return { openSettings, showTab };
})();
