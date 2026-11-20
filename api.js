// 共用：讀設定、呼叫 Apps Script
const Api = {
  async getSettings() {
    const s = await chrome.storage.sync.get(['url', 'token', 'name']);
    return { url: s.url || '', token: s.token || '', name: s.name || '' };
  },

  async call(payload, settings) {
    const s = settings || (await Api.getSettings());
    if (!s.url) throw new Error('尚未設定試算表網址');
    let res;
    try {
      res = await fetch(s.url, {
        method: 'POST',
        // 用 text/plain 送，Apps Script 讀 e.postData.contents
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, token: s.token, name: s.name }),
        redirect: 'follow',
        // 不帶 Google 登入資訊：瀏覽器同時登入多個 Google 帳號時，
        // 帶 cookie 會讓 Apps Script 回錯誤頁
        credentials: 'omit'
      });
    } catch (e) {
      throw new Error('連不到伺服器，請檢查網路或網址');
    }
    const text = await res.text();
    let r;
    try {
      r = JSON.parse(text);
    } catch (e) {
      throw new Error(describeBadResponse(res, text));
    }
    if (r && r.ok === false && /未知的動作/.test(r.error || '')) {
      throw new Error('試算表的程式還是舊版，請更新 Apps Script 並部署新版本');
    }
    return r;
  }
};

// 把 Google 回的 HTML 頁面翻成看得懂的原因
function describeBadResponse(res, text) {
  const title = ((text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const body = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const where = `（HTTP ${res.status}，${res.url.split('?')[0]}）`;

  if (/accounts\.google\.com|ServiceLogin|登入|Sign in/i.test(res.url + title)) {
    return '被導到 Google 登入頁：部署的存取權不是「所有人」，或公司 Workspace 帳號不允許對外公開。' + where;
  }
  if (/指令碼函式|Script function not found/i.test(body)) {
    return '部署的版本裡沒有程式碼：請在 Apps Script 貼上 Code.gs、按儲存，再到「管理部署作業」發布「新版本」。' + where;
  }
  if (/找不到|not found|無法開啟|unable to open/i.test(title + body)) {
    return '找不到這個部署：網址可能貼錯、部署已被封存，或貼成了「測試部署」的網址。' + where;
  }
  if (/doPost|ReferenceError|TypeError|SyntaxError|Exception|錯誤|Error/i.test(body)) {
    return 'Apps Script 程式執行出錯：' + body.slice(0, 160) + where;
  }
  return '伺服器回傳的不是預期的資料：' + (title || body.slice(0, 160) || '（空白）') + where;
}

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function money(n) {
  return Number(n || 0).toLocaleString('zh-TW');
}
