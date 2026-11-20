// 讓擴充功能的程式在一般網頁（手機、iPad）上也能跑：
// chrome.storage 改存在這台裝置的瀏覽器裡（localStorage）
(() => {
  if (window.chrome && window.chrome.storage) return;
  const area = prefix => ({
    async get(keys) {
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
      const out = {};
      list.forEach(k => {
        try {
          const v = localStorage.getItem(prefix + k);
          if (v !== null) out[k] = JSON.parse(v);
        } catch (e) { /* 讀不到就當作沒有 */ }
      });
      return out;
    },
    async set(obj) {
      Object.entries(obj || {}).forEach(([k, v]) => {
        try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) { /* 空間不足或被封鎖 */ }
      });
    }
  });
  window.chrome = {
    storage: { sync: area('sync:'), local: area('local:') },
    runtime: { getURL: p => p },
    // 匯出 PDF：在同一個視窗打開列印頁（主畫面 App 開新視窗會跳到 Safari）
    tabs: { create: ({ url }) => { location.href = url; } }
  };
})();
