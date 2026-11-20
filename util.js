// ============ 共用：日期、格式、偏好設定 ============
const U = (() => {
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = n => String(n).padStart(2, '0');
  const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
  const todayStr = () => ds(new Date());
  const wd = s => WD[pd(s).getDay()];
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toHM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const hrs = m => String(Math.round(m / 60 * 100) / 100);
  const money = n => Number(n || 0).toLocaleString('zh-TW');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DEFAULTS = { dateFmt: 'md', startDay: 1, stores: ['MC', 'QV'], storeShort: { MC: 'M', QV: 'Q' } };
  const prefs = { ...DEFAULTS };
  const FORMATS = [
    ['dm', '28/10（澳洲）'],
    ['dmy', '28/10/2026（澳洲）'],
    ['md', '10/28'],
    ['ymd', '2026/10/28'],
    ['iso', '2026-10-28'],
    ['zh', '10月28日'],
    ['roc', '民國 115/10/28']
  ];

  async function loadPrefs() {
    const s = await chrome.storage.sync.get(['prefs']);
    Object.assign(prefs, DEFAULTS, s.prefs || {});
    if (!Array.isArray(prefs.stores) || !prefs.stores.length) prefs.stores = DEFAULTS.stores.slice();
    if (!prefs.storeShort || typeof prefs.storeShort !== 'object') prefs.storeShort = { ...DEFAULTS.storeShort };
    return prefs;
  }
  async function savePrefs(p) {
    Object.assign(prefs, p);
    await chrome.storage.sync.set({ prefs: { ...prefs } });
  }

  // 依偏好格式化日期；short 只顯示月日（窄的地方用）
  function fd(s, short) {
    const d = pd(s), y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    const dmFirst = prefs.dateFmt === 'dm' || prefs.dateFmt === 'dmy';
    if (short) return prefs.dateFmt === 'zh' ? `${m}月${dd}日` : dmFirst ? `${dd}/${m}` : `${m}/${dd}`;
    switch (prefs.dateFmt) {
      case 'dm': return `${dd}/${m}`;
      case 'dmy': return `${dd}/${m}/${y}`;
      case 'ymd': return `${y}/${pad(m)}/${pad(dd)}`;
      case 'iso': return `${y}-${pad(m)}-${pad(dd)}`;
      case 'zh': return `${m}月${dd}日`;
      case 'roc': return `${y - 1911}/${pad(m)}/${pad(dd)}`;
      default: return `${m}/${dd}`;
    }
  }
  const fdw = (s, short) => `${fd(s, short)}（${wd(s)}）`;
  const weekStartOf = s => addDays(s, -((pd(s).getDay() - prefs.startDay + 7) % 7));

  // 打開日期選擇器（隱藏的 <input type=date>）
  function pickDate(input, value, onPick) {
    input.value = value;
    input.onchange = () => { if (input.value) onPick(input.value); };
    try { input.showPicker(); } catch (e) { input.focus(); input.click(); }
  }

  // 10:00 → 10、17:00 → 5、20:30 → 8:30（跟手寫班表一樣）
  const t12 = hm => { const [h, m] = hm.split(':').map(Number); const hh = h % 12 || 12; return m ? `${hh}:${pad(m)}` : String(hh); };
  // 店的代碼字母：MC → M、QV → Q（字母重複時用全名）
  const storeLetter = c => {
    if (prefs.storeShort && prefs.storeShort[c]) return prefs.storeShort[c];
    const l = c.charAt(0).toUpperCase();
    return prefs.stores.filter(x => x.charAt(0).toUpperCase() === l).length > 1 ? c : l;
  };
  const STORE_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be123c', '#4d7c0f'];
  // MC 綠色、QV 黃色；其他店依序給顏色
  const NAMED = { MC: '#22a34a', QV: '#e0a800' };
  const storeColor = c => NAMED[String(c).toUpperCase()] || STORE_COLORS[Math.max(0, prefs.stores.indexOf(c)) % STORE_COLORS.length];

  return { t12, storeLetter, storeColor, WD, pad, ds, pd, addDays, todayStr, wd, toMin, toHM, hrs, money, esc,
    prefs, DEFAULTS, FORMATS, loadPrefs, savePrefs, fd, fdw, weekStartOf, pickDate };
})();
