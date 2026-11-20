// ============ 排班 ============
(() => {
const HOUR_FROM = 6, HOUR_TO = 24;          // 時間軸範圍 06:00–24:00
const SNAP = 30;                            // 拖拉以 30 分鐘對齊
const DEFAULT_LEN = 4 * 60;                 // 沒設預設時間的新班長度
const DAY_LIMIT = 8 * 60, WEEK_LIMIT = 40 * 60;
const MIN_COL = 64;                         // 自動欄寬的最小值
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#475569', '#0d9488', '#9333ea'];
// 點開顏色後的完整色盤：12 種色相 × 4 種深淺
const PALETTE = (() => {
  const out = [];
  [[45, 34], [60, 45], [70, 58], [55, 72]].forEach(([s, l]) => {
    for (let h = 0; h < 360; h += 30) out.push(hsl(h, s + 15, l));
  });
  ['#1f2933', '#475569', '#94a3b8', '#a16207', '#78350f', '#0f172a'].forEach(c => out.push(c));
  return out;
})();
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const EYE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-7 0-11-7-11-7a19 19 0 0 1 5.1-5.9M9.9 5.2A9.7 9.7 0 0 1 12 5c7 0 11 7 11 7a19 19 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>';

const $ = id => document.getElementById(id);
const { addDays, todayStr, wd, toMin, toHM, hrs, money, esc } = U;
const S = {
  settings: null, weekStart: null, staff: [], shifts: [], offs: [], lastLen: {},
  view: 'auto', day: 0, focus: null, cardMode: 'days', hidden: new Set(), storeFilter: 'all', colWs: {}, poolW: 176, footH: 132, footMode: 'h',
  dirty: false, saving: false, saveError: null, saveTimer: null, lastSaved: null,
  loadSeq: 0, seq: 1, scrolled: false
};

const dur = s => toMin(s.end) - toMin(s.start);
const weekDays = () => [...Array(7)].map((_, i) => addDays(S.weekStart, i));
const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 36;
const person = name => S.staff.find(p => p.name === name);
const colorOf = name => (person(name) || {}).color || '#64748b';
const nextColor = () => {
  const used = new Set(S.staff.map(p => p.color));
  return COLORS.find(c => !used.has(c)) || COLORS[S.staff.length % COLORS.length];
};
const num = v => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v));
const normStaff = (p, i) => {
  const o = {
    name: p.name, color: p.color || COLORS[i % COLORS.length],
    rateCash: num(p.rateCash), rateTransfer: num(p.rateTransfer),
    store: p.store || '', defLen: num(p.defLen), note: p.note || ''
  };
  // 上一版的「預設時間」改成「預設時數」
  if (o.defLen === '' && p.defStart && p.defEnd && toMin(p.defEnd) > toMin(p.defStart)) o.defLen = (toMin(p.defEnd) - toMin(p.defStart)) / 60;
  // 上一版的格式：一個時薪＋付款方式
  if (p.rate !== undefined && p.rateCash === undefined && p.rateTransfer === undefined) {
    if (p.pay === '轉帳') o.rateTransfer = num(p.rate); else o.rateCash = num(p.rate);
  }
  return o;
};
const withIds = list => (list || []).map(s => ({ id: 's' + S.seq++, date: s.date, name: s.name, start: s.start, end: s.end, note: s.note || '', store: s.store || '' }));
const plainShifts = () => S.shifts.map(({ date, name, start, end, note, store }) => ({ date, name, start, end, note, store }));
const minutesOf = (name, date) => S.shifts.filter(s => s.name === name && (!date || s.date === date)).reduce((a, s) => a + dur(s), 0);
const isOff = (name, date) => S.offs.some(o => o.name === name && o.date === date);
// 薪資：現金、轉帳兩欄可以都填（拆開付）
function wageOf(name, min) {
  const p = person(name) || {};
  if (p.rateCash === '' && p.rateTransfer === '') return null;
  const cash = p.rateCash ? Math.round(min / 60 * p.rateCash) : 0;
  const tr = p.rateTransfer ? Math.round(min / 60 * p.rateTransfer) : 0;
  return { cash, tr, total: cash + tr };
}
const visible = s => !S.hidden.has(s.name) && (S.storeFilter === 'all' || s.store === S.storeFilter);
const prefsForServer = () => ({ startDay: U.prefs.startDay, stores: U.prefs.stores, storeShort: U.prefs.storeShort });
const defaultStore = p => (p && U.prefs.stores.includes(p.store) ? p.store : S.storeFilter !== 'all' ? S.storeFilter : U.prefs.stores[0]);

// ---------- 啟動（由 app.js 呼叫）----------
let started = false;
async function start(settings) {
  S.settings = settings;
  if (started) return render();
  started = true;
  const pref = await chrome.storage.local.get(['view', 'lastLen', 'hiddenStaff', 'storeFilter', 'colWs', 'poolW', 'footH', 'footMode', 'cardMode']);
  S.cardMode = pref.cardMode === 'pay' ? 'pay' : 'days';
  S.view = pref.view || 'auto';
  S.lastLen = pref.lastLen || {};
  S.hidden = new Set(pref.hiddenStaff || []);
  S.storeFilter = pref.storeFilter || 'all';
  S.colWs = pref.colWs || {};
  S.footH = pref.footH || 132;
  S.footMode = pref.footMode === '$' ? '$' : 'h';
  applyFootH();
  S.poolW = pref.poolW || 176;
  applyPoolW();
  $('viewMode').value = S.view;
  bindUI();
  loadWeek(U.weekStartOf(todayStr()));
}
function updateSettings(settings) {
  S.settings = settings;
  if (started) loadWeek(S.weekStart || U.weekStartOf(todayStr()));
}
async function prefsChanged() {
  if (!started) return;
  if (S.storeFilter !== 'all' && !U.prefs.stores.includes(S.storeFilter)) S.storeFilter = 'all';
  const anchor = S.weekStart && weekDays().includes(todayStr()) ? todayStr() : (S.weekStart || todayStr());
  const ws = U.weekStartOf(anchor);
  if (ws !== S.weekStart) await loadWeek(ws);
  else render();
  try { await Api.call({ action: 'schedule.render', prefs: prefsForServer() }, S.settings); } catch (e) { /* 下次存檔時會重排 */ }
}

// ---------- 讀取、儲存 ----------
async function loadWeek(ws, opts = {}) {
  hidePop();
  if (S.weekStart && ws !== S.weekStart) await flushSave();
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  S.weekStart = ws;
  S.day = Math.max(0, days.indexOf(todayStr()));

  const key = 'week:' + ws;
  const local = await chrome.storage.local.get([key, 'staff']);
  if (local.staff && !S.staff.length) S.staff = local.staff.map(normStaff);
  const cache = opts.discardLocal ? null : local[key];
  S.shifts = cache ? withIds(cache.shifts) : [];
  S.offs = cache ? (cache.offs || []) : [];
  S.dirty = !!(cache && cache.dirty);
  render();

  const seq = ++S.loadSeq;
  $('loading').hidden = false;
  try {
    const r = await Api.call({ action: 'schedule.get', weekStart: ws }, S.settings);
    if (seq !== S.loadSeq) return;
    if (!r.ok) throw new Error(r.error || '讀取失敗');
    if (r.staff && r.staff.length && !S.dirty) S.staff = r.staff.map(normStaff);
    if (S.dirty) scheduleSave(0); // 本機有還沒存上去的修改，以本機為準
    else { S.shifts = withIds(r.shifts); S.offs = r.offs || []; }
    ensureStaff();
    S.saveError = null;
    persistLocal();
    render();
    await seedStaff();
  } catch (e) {
    if (seq === S.loadSeq) {
      S.saveError = e.message;
      renderSaveState();
      toast('讀取失敗：' + e.message);
    }
  } finally {
    if (seq === S.loadSeq) $('loading').hidden = true;
  }
}

// 第一次使用：先放入原本班表上的員工
const DEFAULT_STAFF = ['Long', 'Mavis', 'Sia', 'Kim', 'Jenny', 'Saki', 'Kazuha'];
async function seedStaff() {
  const f = await chrome.storage.local.get(['staffSeeded2']);
  if (f.staffSeeded2) return;
  chrome.storage.local.set({ staffSeeded2: true });
  const missing = DEFAULT_STAFF.filter(n => !person(n));
  if (!missing.length) return;
  missing.forEach(n => S.staff.push(normStaff({ name: n, color: nextColor() }, S.staff.length)));
  changed();
}

function ensureStaff() {
  S.shifts.concat(S.offs).forEach(s => {
    if (!person(s.name)) S.staff.push(normStaff({ name: s.name, color: nextColor() }, S.staff.length));
  });
}

function persistLocal() {
  if (!S.weekStart) return;
  chrome.storage.local.set({ ['week:' + S.weekStart]: { shifts: plainShifts(), offs: S.offs, dirty: S.dirty }, staff: S.staff });
}

function changed() {
  S.dirty = true;
  persistLocal();
  render();
  scheduleSave();
}

function scheduleSave(delay = 1200) {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(doSave, delay);
  renderSaveState();
}

async function doSave() {
  if (S.saving) return scheduleSave(600);
  if (!S.dirty) return renderSaveState();
  S.saving = true;
  renderSaveState();
  const ws = S.weekStart;
  const shifts = plainShifts(), offs = S.offs.slice();
  const snapshot = JSON.stringify([shifts, offs, S.staff]);
  try {
    const r = await Api.call({ action: 'schedule.save', weekStart: ws, shifts, offs, staff: S.staff, prefs: prefsForServer() }, S.settings);
    if (!r.ok) throw new Error(r.error || '儲存失敗');
    if (S.weekStart === ws && snapshot === JSON.stringify([plainShifts(), S.offs, S.staff])) S.dirty = false;
    if (S.weekStart === ws) persistLocal();
    else chrome.storage.local.set({ ['week:' + ws]: { shifts, offs, dirty: false } });
    S.saveError = null;
    S.lastSaved = new Date();
    if (r.viewError) toast('班表已存，但「班表」分頁排版失敗：' + r.viewError);
  } catch (e) {
    S.saveError = e.message;
  } finally {
    S.saving = false;
    renderSaveState();
    if (S.dirty && !S.saveError) scheduleSave();
  }
}

async function flushSave() {
  if (!S.dirty) return;
  clearTimeout(S.saveTimer);
  while (S.saving) await new Promise(r => setTimeout(r, 100));
  await doSave();
}

// ---------- 畫面 ----------
function rightWidth() {
  const el = document.querySelector('.schedright');
  return el && el.clientWidth ? el.clientWidth : window.innerWidth - S.poolW;
}
function effectiveView() {
  if (S.view !== 'auto') return S.view;
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 48;
  return rightWidth() >= gutter + 7 * MIN_COL ? 'week' : 'day';
}
function applyFootH() {
  $('footScroll').style.height = S.footH + 'px';
}
function applyPoolW() {
  // 側邊欄很窄時，員工列表最多佔 4 成寬，留空間給行事曆
  const w = Math.min(S.poolW, Math.max(120, Math.round(window.innerWidth * 0.36)));
  document.documentElement.style.setProperty('--pool', w + 'px');
}

function render() {
  if (!S.weekStart) return;
  const days = weekDays();
  const isThis = days.includes(todayStr());
  const narrow = rightWidth() < 460;
  $('weekLabel').textContent = `${U.fd(days[0], narrow)} – ${U.fd(days[6], narrow)}`;
  $('weekLabel').title = `${U.fdw(days[0])} – ${U.fdw(days[6])}，按一下選日期`;
  $('weekLabel').classList.toggle('now', isThis);
  $('thisWeek').hidden = isThis;
  $('viewMode').title = '排列方式：' + (S.view === 'auto' ? `自動（目前是${effectiveView() === 'week' ? '一週' : '單日'}）` : S.view === 'week' ? '一週' : '單日');
  renderStoreFilter();
  renderStaff();
  renderDayTabs();
  renderGrid();
  renderSaveState();
}

function renderSaveState() {
  const el = $('saveState');
  el.className = 'savestate';
  el.title = '';
  if (S.saving) { el.classList.add('busy'); el.textContent = '儲存中'; }
  else if (S.saveError) { el.classList.add('err'); el.textContent = '未儲存・重試'; el.title = S.saveError; }
  else if (S.dirty) { el.textContent = '待儲存'; }
  else if (S.lastSaved) { el.textContent = '已儲存'; el.title = '儲存時間 ' + S.lastSaved.toLocaleTimeString(); }
  else { el.textContent = ''; }
}

function renderStoreFilter() {
  const opts = ['all'].concat(U.prefs.stores);
  $('storeFilter').innerHTML = opts.map(c => `<button data-store="${esc(c)}" class="${S.storeFilter === c ? 'on' : ''}"
    ${c === 'all' ? 'title="顯示全部的店"' : `title="只看 ${esc(c)}" style="--sc:${U.storeColor(c)}"`}>${c === 'all' ? '全部' : esc(c)}</button>`).join('');
}

function storeBadge(code, full) {
  if (!code) return '';
  return `<span class="sbadge" style="--sc:${U.storeColor(code)}" title="${esc(code)}">${esc(full ? code : U.storeLetter(code))}</span>`;
}

function renderStaff() {
  const box = $('staffList');
  if (!S.staff.length) {
    box.innerHTML = '<div class="empty">還沒有員工，先在下面新增</div>';
    return;
  }
  const days = weekDays();
  box.innerHTML = S.staff.map(p => {
    const m = minutesOf(p.name);
    const w = wageOf(p.name, m);
    const over = m > WEEK_LIMIT;
    const hid = S.hidden.has(p.name);
    let second;
    if (S.cardMode === 'days') {
      // 一週七天：上班＝底色白字、off＝紅色、沒排班＝淡色（點淡色可以設成 off，再點取消）
      second = `<div class="wk">${days.map(d => {
        const work = S.shifts.some(s => s.name === p.name && s.date === d);
        const off = isOff(p.name, d);
        const st = work ? 'on' : off ? 'off' : 'free';
        const tip = `${U.fdw(d)}：${work ? '上班' : off ? 'off（點一下取消）' : '沒排班（點一下設成 off）'}`;
        return `<span class="${st}" data-wkday="${d}" title="${tip}">${wd(d)}</span>`;
      }).join('')}</div>`;
    } else {
      second = `<div class="cs"><span class="h">${hrs(m)}h</span> · ${w ? `<span>$${money(w.total)}</span>` : '<i>未填時薪</i>'}</div>`;
    }
    return `<div class="card${over ? ' over' : ''}${hid ? ' hid' : ''}${S.focus === p.name ? ' focus' : ''}" data-name="${esc(p.name)}" style="--c:${p.color}"
      title="${esc(p.name)}：這週 ${hrs(m)} 小時${w ? '，$' + money(w.total) : ''}${p.note ? '\n備註：' + esc(p.note) : ''}\n拖到行事曆上排班，點一下編輯">
      <button class="eye" data-eye="${esc(p.name)}" title="${hid ? '在行事曆顯示' : '在行事曆隱藏'}" aria-label="${hid ? '顯示' : '隱藏'}">${hid ? EYE_OFF : EYE}</button>
      <div class="cn"><span class="nm">${esc(p.name)}</span>${storeBadge(p.store, true)}</div>
      <button class="cmode" title="切換：${S.cardMode === 'days' ? '看時數薪資' : '看上班日'}" aria-label="切換顯示">${S.cardMode === 'days' ? '$' : '週'}</button>
      ${second}
      ${p.note ? `<div class="cnote">${esc(p.note)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderDayTabs() {
  const nav = $('dayTabs');
  if (effectiveView() !== 'day') { nav.hidden = true; return; }
  nav.hidden = false;
  const t = todayStr();
  nav.innerHTML = weekDays().map((d, i) => {
    const n = new Set(S.shifts.filter(s => s.date === d).map(s => s.name)).size;
    return `<button data-day="${i}" title="${U.fdw(d)}${n ? ' · ' + n + ' 人上班' : ' · 休'}" class="${i === S.day ? 'on' : ''}${d === t ? ' today' : ''}">
      <b>${U.fd(d, true)}</b><span>${wd(d)}</span></button>`;
  }).join('');
}

function layoutDay(list) {
  const items = list.slice().sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    const start = out.length;
    cluster.forEach(s => {
      let i = lanes.findIndex(end => end <= toMin(s.start));
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = toMin(s.end);
      out.push({ s, lane: i });
    });
    for (let k = start; k < out.length; k++) out[k].lanes = lanes.length;
    cluster = [];
  };
  items.forEach(s => {
    if (cluster.length && toMin(s.start) >= clusterEnd) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, toMin(s.end));
  });
  if (cluster.length) flush();
  return out;
}

function hasConflict(s) {
  return S.shifts.some(o => o !== s && o.name === s.name && o.date === s.date &&
    toMin(o.start) < toMin(s.end) && toMin(s.start) < toMin(o.end));
}

function footVal(min, pay) {
  return S.footMode === '$' ? (pay == null ? '—' : '$' + money(pay)) : hrs(min) + 'h';
}

// ---------- 匯出 PDF（給員工看的班表，不含合計）----------
async function exportPdf() {
  const days = weekDays();
  const names = S.staff.map(p => p.name).filter(n => !S.hidden.has(n));
  const data = {
    title: `班表 ${U.fdw(days[0])} – ${U.fdw(days[6])}`,
    days: days.map(d => ({ date: d, label: U.fd(d, true), wd: wd(d), today: false })),
    rows: names.map(n => ({
      name: n,
      cells: days.map(d => isOff(n, d) ? { off: true } : {
        shifts: S.shifts.filter(s => s.name === n && s.date === d).sort((a, b) => toMin(a.start) - toMin(b.start))
          .map(s => ({ store: s.store ? U.storeLetter(s.store) : '', color: s.store ? U.storeColor(s.store) : '', time: `${U.t12(s.start)}-${U.t12(s.end)}` }))
      })
    })),
    stores: U.prefs.stores.map(c => ({ code: U.storeLetter(c), name: c, color: U.storeColor(c) })),
    printed: new Date().toLocaleString('zh-TW')
  };
  await chrome.storage.local.set({ printData: data });
  chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
}
function dayFoot(d) {
  const list = S.shifts.filter(s => s.date === d);
  // 店：MC、QV 固定都列出來，沒有就是 0
  const per = {};
  U.prefs.stores.forEach(k => (per[k] = { min: 0, pay: 0 }));
  let tMin = 0, tPay = 0, missing = false;
  list.forEach(s => {
    const k = s.store || '未分店';
    const w = wageOf(s.name, dur(s));
    per[k] = per[k] || { min: 0, pay: 0 };
    per[k].min += dur(s);
    per[k].pay += w ? w.total : 0;
  });
  const storeRows = Object.keys(per).map(k =>
    `<div class="fr fs"><span class="fn">${U.prefs.stores.includes(k) ? storeBadge(k) : '未分店'}</span><span class="fv">${footVal(per[k].min, per[k].pay)}</span></div>`).join('');

  const names = [...new Set(list.map(s => s.name))]
    .sort((a, b) => S.staff.findIndex(p => p.name === a) - S.staff.findIndex(p => p.name === b));
  const rows = names.map(n => {
    const m = minutesOf(n, d), w = wageOf(n, m);
    tMin += m;
    if (!w) missing = true; else tPay += w.total;
    const tip = `${n}：${hrs(m)} 小時` + (w ? `，$${money(w.total)}${w.cash && w.tr ? `（現金 $${money(w.cash)}、轉帳 $${money(w.tr)}）` : ''}` : '，未填時薪');
    return `<div class="fr${S.hidden.has(n) ? ' hid' : ''}" title="${esc(tip)}"><span class="fn">${esc(n)}</span><span class="fv">${footVal(m, w ? w.total : null)}</span></div>`;
  }).join('');
  const total = `<div class="fr ftot" title="${missing ? '有人沒填時薪，沒算進薪資' : ''}"><span class="fn">合計</span><span class="fv">${footVal(tMin, tPay)}${S.footMode === '$' && missing ? '*' : ''}</span></div>`;
  return `<div class="fsum top">${storeRows}${total}</div>${rows}`;
}

function renderGrid() {
  const days = weekDays();
  const isWeek = effectiveView() === 'week';
  const cols = isWeek ? days : [days[S.day]];
  const px = hourPx();
  const H = (HOUR_TO - HOUR_FROM) * px;
  const t = todayStr();
  const g = $('grid');
  // 拉過的那天用固定寬度，其他天自動等分剩下的空間
  const tpl = 'var(--gutter) ' + cols.map((d, i) => {
    const w = isWeek && S.colWs[i];
    return w ? w + 'px' : `minmax(${isWeek ? MIN_COL : 0}px, 1fr)`;
  }).join(' ');
  g.style.setProperty('--tpl', tpl);

  $('gridHead').innerHTML = '<div class="corner"></div>' + cols.map(d => {
    const n = new Set(S.shifts.filter(s => s.date === d).map(s => s.name)).size;
    const offs = S.offs.filter(o => o.date === d);
    return `<div class="dh${d === t ? ' today' : ''}" title="${U.fdw(d)}">
      <b>${U.fd(d, true)} ${wd(d)}</b><span class="cnt">${n ? n + ' 人' : '休'}</span>
      ${isWeek ? `<span class="colrz" data-idx="${days.indexOf(d)}" title="拖拉調整這天的寬度，點兩下恢復自動"></span>` : ''}
    </div>`;
  }).join('');

  let gutter = `<div class="gutter" style="height:${H}px">`;
  for (let h = HOUR_FROM; h < HOUR_TO; h++) gutter += `<span class="hl" style="top:${(h - HOUR_FROM) * px}px">${U.pad(h)}:00</span>`;
  gutter += '</div>';

  const colsHtml = cols.map(d => {
    let html = `<div class="col" data-date="${d}" style="height:${H}px">`;
    layoutDay(S.shifts.filter(s => s.date === d && visible(s))).forEach(({ s, lane, lanes }) => {
      const top = (toMin(s.start) - HOUR_FROM * 60) / 60 * px;
      const h = dur(s) / 60 * px;
      const dayTotal = minutesOf(s.name, d);
      const conflict = hasConflict(s);
      const warn = conflict ? '重疊' : dayTotal > DAY_LIMIT ? '8h+' : '';
      const cls = ['shift', h < 44 ? 'short' : '', conflict ? 'conflict' : '', S.focus && S.focus !== s.name ? 'dim' : ''].join(' ');
      const tip = `${s.name}${s.store ? '（' + s.store + '）' : ''} ${s.start}–${s.end}（${hrs(dur(s))} 小時）` +
        (conflict ? '\n同一個人的班時間重疊' : '') +
        (dayTotal > DAY_LIMIT ? `\n這天共 ${hrs(dayTotal)} 小時，超過 8 小時` : '') +
        (s.note ? '\n' + s.note : '');
      html += `<div class="${cls}" data-id="${s.id}" title="${esc(tip)}"
        style="--c:${colorOf(s.name)};top:${top}px;height:${Math.max(h - 2, 14)}px;left:calc(${lane / lanes * 100}% + 2px);width:calc(${100 / lanes}% - 4px)">
        ${s.store ? `<span class="sbadge st" style="--sc:${U.storeColor(s.store)}">${esc(U.storeLetter(s.store))}</span>` : ''}
        <div class="n">${esc(s.name)}</div>
        <div class="t">${U.t12(s.start)}-${U.t12(s.end)}</div>
        ${s.note && h >= 64 ? `<div class="note">${esc(s.note)}</div>` : ''}
        ${warn ? `<span class="warn">${warn}</span>` : ''}
      </div>`;
    });
    if (d === t) {
      const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
      if (m >= HOUR_FROM * 60 && m <= HOUR_TO * 60) html += `<div class="nowline" style="top:${(m - HOUR_FROM * 60) / 60 * px}px"></div>`;
    }
    return html + '</div>';
  }).join('');

  $('gridBody').innerHTML = gutter + colsHtml;
  $('gridFoot').innerHTML = `<div class="foot gfoot"><b>合計</b>
      <div class="seg small footmode" title="切換顯示時數或薪資">
        <button data-fm="h" class="${S.footMode === 'h' ? 'on' : ''}">時</button><button data-fm="$" class="${S.footMode === '$' ? 'on' : ''}">$</button>
      </div></div>` + cols.map(d => `<div class="foot" data-date="${d}">${dayFoot(d)}</div>`).join('');
  $('footScroll').scrollLeft = $('gridScroll').scrollLeft;
  const sc = $('gridScroll');
  if (!S.scrolled && sc.clientHeight) {
    sc.scrollTop = (8 - HOUR_FROM) * px; // 一開始捲到 08:00
    S.scrolled = true;
  }
}

// ---------- 拖拉 ----------
let D = null;

function colUnder(x, y, needY) {
  const sc = $('gridScroll').getBoundingClientRect();
  if (needY && (y < sc.top || y > sc.bottom || x < sc.left || x > sc.right)) return null;
  for (const col of document.querySelectorAll('#gridBody .col')) {
    const r = col.getBoundingClientRect();
    if (x >= r.left && x < r.right) return { el: col, rect: r, date: col.dataset.date };
  }
  return null;
}
const yToMin = (y, rect) => HOUR_FROM * 60 + (y - rect.top) / hourPx() * 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function onPointerDown(e) {
  if (e.button !== 0 || $('sched').hidden) return;
  if (!e.target.closest('.pop, .menu, #menuBtn, .toast, .dialogwrap')) { hidePop(); hideMenu(); }
  if (e.target.closest('.eye, .cmode, .wk .free, .wk .off, .offchip, .pop, .dialogwrap')) return;

  if (e.target.closest('.colrz')) {
    // 點兩下：恢復自動欄寬（拖拉後會重畫，瀏覽器的 dblclick 抓不到，所以自己算）
    const now = performance.now();
    const idx = e.target.closest('.colrz').dataset.idx;
    if (now - (S.lastRz || 0) < 400 && S.lastRzIdx === idx) {
      S.lastRz = 0;
      delete S.colWs[idx];
      chrome.storage.local.set({ colWs: S.colWs });
      render();
      e.preventDefault();
      return;
    }
    const dh = e.target.closest('.dh');
    D = { kind: 'colw', idx, x: e.clientX, w0: dh.getBoundingClientRect().width, started: true };
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
    return;
  }
  if (e.target.closest('#footSplit')) {
    D = { kind: 'foot', y: e.clientY, h0: S.footH, started: true };
    document.body.style.cursor = 'row-resize';
    e.preventDefault();
    return;
  }
  if (e.target.closest('#poolSplit')) {
    D = { kind: 'pool', x: e.clientX, w0: S.poolW, started: true };
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
    return;
  }
  const card = e.target.closest('.card[data-name]');
  if (card) {
    D = { kind: 'new', name: card.dataset.name, el: card, x: e.clientX, y: e.clientY, started: false };
    e.preventDefault();
    return;
  }
  const el = e.target.closest('.shift[data-id]');
  if (el) {
    const s = S.shifts.find(x => x.id === el.dataset.id);
    if (!s) return;
    const rect = el.parentElement.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const edge = box.bottom - e.clientY <= 8 ? 'bot' : (e.clientY - box.top <= 6 && box.height >= 30) ? 'top' : null;
    D = {
      kind: edge || 'move', shift: s, el, x: e.clientX, y: e.clientY, started: false,
      grab: yToMin(e.clientY, rect) - toMin(s.start)
    };
    e.preventDefault();
  }
}

function startDrag() {
  D.started = true;
  hidePop();
  if (D.kind === 'new') {
    const p = person(D.name);
    D.len = p && p.defLen ? Math.round(p.defLen * 60 / 15) * 15 : (S.lastLen[D.name] || DEFAULT_LEN);
    D.ghost = document.createElement('div');
    D.ghost.className = 'ghostchip';
    D.ghost.style.setProperty('--c', colorOf(D.name));
    D.ghost.textContent = D.name;
    document.body.appendChild(D.ghost);
  } else if (D.kind === 'move') {
    D.len = dur(D.shift);
    D.el.classList.add('dragging');
  }
  document.body.style.cursor = D.kind === 'top' || D.kind === 'bot' ? 'ns-resize' : 'grabbing';
}

function onPointerMove(e) {
  if (!D) {
    const el = !$('sched').hidden && e.buttons === 0 && e.target.closest && e.target.closest('.shift[data-id]');
    if (el) {
      const b = el.getBoundingClientRect();
      el.style.cursor = b.bottom - e.clientY <= 8 || (e.clientY - b.top <= 6 && b.height >= 30) ? 'ns-resize' : '';
    }
    return;
  }
  if (D.kind === 'colw') {
    if (Math.abs(e.clientX - D.x) < 3 && !D.moved) return;
    D.moved = true;
    S.colWs[D.idx] = clamp(Math.round(D.w0 + e.clientX - D.x), 48, 480);
    renderGrid();
    return;
  }
  if (D.kind === 'foot') {
    const max = Math.max(60, $('grid').clientHeight - 140);
    S.footH = clamp(Math.round(D.h0 - (e.clientY - D.y)), 44, max);
    applyFootH();
    return;
  }
  if (D.kind === 'pool') {
    S.poolW = clamp(Math.round(D.w0 + e.clientX - D.x), 120, Math.min(360, window.innerWidth - 180));
    applyPoolW();
    return;
  }
  if (!D.started) {
    if (Math.hypot(e.clientX - D.x, e.clientY - D.y) < 4) return;
    startDrag();
  }
  D.lastX = e.clientX; D.lastY = e.clientY;
  updateDrag();
  autoScroll(e.clientY);
}

function updateDrag() {
  const x = D.lastX, y = D.lastY;
  const lo = HOUR_FROM * 60, hi = HOUR_TO * 60;
  if (D.kind === 'new' || D.kind === 'move') {
    if (D.ghost) { D.ghost.style.left = x + 'px'; D.ghost.style.top = y + 'px'; }
    const col = colUnder(x, y, D.kind === 'new');
    document.querySelectorAll('.col.drop').forEach(c => c.classList.remove('drop'));
    if (!col || y > col.rect.bottom) { removePreview(); D.target = null; return; }
    col.el.classList.add('drop');
    let start;
    if (D.fixed) start = D.fixed.start; // 有預設時間：放到哪一天就是那個時間
    else {
      const m = yToMin(y, col.rect);
      start = D.kind === 'new' ? Math.floor(m / SNAP) * SNAP : Math.round((m - D.grab) / SNAP) * SNAP;
      start = clamp(start, lo, hi - D.len);
    }
    D.target = { date: col.date, start, end: start + D.len };
    showPreview(col.el, D.target, D.kind === 'new' ? D.name : D.shift.name);
    if (D.ghost) D.ghost.hidden = true;
  } else {
    const rect = D.el.parentElement.getBoundingClientRect();
    const m = Math.round(yToMin(y, rect) / SNAP) * SNAP;
    let start = toMin(D.shift.start), end = toMin(D.shift.end);
    if (D.kind === 'top') start = clamp(m, lo, end - SNAP);
    else end = clamp(m, start + SNAP, hi);
    D.target = { date: D.shift.date, start, end };
    const px = hourPx();
    D.el.style.top = (start - lo) / 60 * px + 'px';
    D.el.style.height = Math.max((end - start) / 60 * px - 2, 14) + 'px';
    D.el.classList.remove('short');
    const t = D.el.querySelector('.t');
    if (t) t.textContent = `${U.t12(toHM(start))}-${U.t12(toHM(end))}`;
  }
}

function showPreview(colEl, t, name) {
  if (!D.preview) {
    D.preview = document.createElement('div');
    D.preview.className = 'preview';
  }
  const px = hourPx();
  D.preview.style.setProperty('--c', colorOf(name));
  D.preview.style.top = (t.start - HOUR_FROM * 60) / 60 * px + 'px';
  D.preview.style.height = (t.end - t.start) / 60 * px - 2 + 'px';
  D.preview.textContent = `${name} ${toHM(t.start)}–${toHM(t.end)}${isOff(name, t.date) ? '（這天 off）' : ''}`;
  D.preview.classList.toggle('offday', isOff(name, t.date));
  if (D.preview.parentElement !== colEl) colEl.appendChild(D.preview);
  // 預設時間在畫面外時，捲過去讓人看得到
  if (D.fixed && !D.scrolledTo) {
    D.scrolledTo = true;
    D.preview.scrollIntoView({ block: 'nearest' });
  }
}
function removePreview() {
  if (D && D.preview) { D.preview.remove(); D.preview = null; }
  if (D && D.ghost) D.ghost.hidden = false;
}

let scrollRAF = null, edgeSince = 0;
function autoScroll(y) {
  const sc = $('gridScroll'), r = sc.getBoundingClientRect();
  const top = r.top + $('gridHead').offsetHeight;
  const inTop = y >= top && y < top + 28, inBot = y <= r.bottom && y > r.bottom - 28;
  const speed = inTop ? -10 : inBot ? 10 : 0;
  cancelAnimationFrame(scrollRAF);
  if (!speed || !D || D.fixed) { edgeSince = 0; return; }
  if (!edgeSince) edgeSince = performance.now();
  if (performance.now() - edgeSince < 350) {
    scrollRAF = requestAnimationFrame(() => D && autoScroll(D.lastY));
    return;
  }
  const step = () => {
    if (!D) return;
    sc.scrollTop += speed;
    updateDrag();
    scrollRAF = requestAnimationFrame(step);
  };
  scrollRAF = requestAnimationFrame(step);
}

async function endDrag(commit) {
  const d = D;
  D = null;
  cancelAnimationFrame(scrollRAF);
  edgeSince = 0;
  document.body.style.cursor = '';
  if (!d) return;
  if (d.kind === 'colw') {
    // 沒拖動＝點一下；連點兩下才恢復自動寬度
    if (d.moved) { S.lastRz = 0; chrome.storage.local.set({ colWs: S.colWs }); return render(); }
    S.lastRz = performance.now(); S.lastRzIdx = d.idx;
    return;
  }
  if (d.kind === 'foot') { chrome.storage.local.set({ footH: S.footH }); return; }
  if (d.kind === 'pool') { chrome.storage.local.set({ poolW: S.poolW }); return render(); }
  if (d.preview) d.preview.remove();
  if (d.ghost) d.ghost.remove();
  document.querySelectorAll('.col.drop').forEach(c => c.classList.remove('drop'));

  if (!d.started) {
    if (!commit) return;
    if (d.kind === 'new') openStaffPop(d.name, d.el);
    else openShiftPop(d.shift.id);
    return;
  }
  if (!commit || !d.target) return render();
  const t = d.target;
  const name = d.kind === 'new' ? d.name : d.shift.name;
  if ((d.kind === 'new' || t.date !== (d.shift && d.shift.date)) && isOff(name, t.date)) {
    if (!(await confirmDialog(`${name} ${U.fdw(t.date)} 是 off（休假）。\n仍要排班嗎？排了會取消這天的休假。`))) return render();
    S.offs = S.offs.filter(o => !(o.name === name && o.date === t.date));
  }
  if (d.kind === 'new') {
    S.shifts.push({ id: 's' + S.seq++, date: t.date, name, start: toHM(t.start), end: toHM(t.end), note: '', store: defaultStore(person(name)) });
    if (!(person(name) || {}).defLen) rememberLen(name, t.end - t.start);
  } else {
    Object.assign(d.shift, { date: t.date, start: toHM(t.start), end: toHM(t.end) });
    if (d.kind !== 'move') rememberLen(name, t.end - t.start);
  }
  if (effectiveView() === 'day') S.day = weekDays().indexOf(t.date);
  changed();
}

function rememberLen(name, len) {
  S.lastLen[name] = len;
  chrome.storage.local.set({ lastLen: S.lastLen });
}

// ---------- 浮出視窗 ----------
function placePop(anchor) {
  const pop = $('pop');
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = r.right + 8, top = r.top;
  if (left + w > vw - 6) left = r.left - w - 8;
  if (left < 6) { left = clamp(r.left, 6, vw - w - 6); top = r.bottom + 6; }
  if (top + h > vh - 6) top = Math.max(6, vh - h - 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}
function hidePop() { $('pop').hidden = true; $('pop').dataset.kind = ''; }
function hideMenu() { $('menu').hidden = true; }

function timeOptions(from, to, sel, blank) {
  let o = blank ? `<option value=""${sel ? '' : ' selected'}>${blank}</option>` : '';
  for (let m = from; m <= to; m += 15) o += `<option value="${toHM(m)}"${toHM(m) === sel ? ' selected' : ''}>${toHM(m)}</option>`;
  return o;
}
function storeSeg(sel, attr) {
  return `<div class="seg small storeseg">${U.prefs.stores.map(c =>
    `<button ${attr}="${esc(c)}" class="${sel === c ? 'on' : ''}" style="--sc:${U.storeColor(c)}" title="${esc(c)}">${esc(U.storeLetter(c))}（${esc(c)}）</button>`).join('')}</div>`;
}

function openShiftPop(id) {
  const s = S.shifts.find(x => x.id === id);
  if (!s) return;
  const pop = $('pop');
  pop.dataset.kind = 'shift';
  pop.dataset.id = id;
  pop.style.setProperty('--c', colorOf(s.name));
  pop.innerHTML = `
    <h3><span class="dot"></span>${U.fdw(s.date)} 的班</h3>
    <div class="two2">
      <div><label>員工</label>
        <select data-f="name">${S.staff.map(p => `<option${p.name === s.name ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div><label>店</label>${storeSeg(s.store, 'data-sstore')}</div>
    </div>
    <label>時間</label>
    <div class="two">
      <select data-f="start">${timeOptions(HOUR_FROM * 60, HOUR_TO * 60 - 15, s.start)}</select><span>–</span>
      <select data-f="end">${timeOptions(HOUR_FROM * 60 + 15, HOUR_TO * 60, s.end)}</select>
    </div>
    <div class="sum" id="popSum"></div>
    <label>備註</label>
    <input data-f="note" maxlength="40" placeholder="例如：負責開店" value="${esc(s.note)}">
    <div class="foot2">
      <button class="ghost danger" data-a="del">刪除</button>
      <span class="row">
        <button class="ghost" data-a="dup" title="在隔天排一個一樣的班">複製到隔天</button>
        <button class="primary" data-a="close">完成</button>
      </span>
    </div>`;
  updatePopSum(s);
  placePop(document.querySelector(`.shift[data-id="${id}"]`) || $('grid'));
}

function updatePopSum(s) {
  const el = $('popSum');
  if (!el) return;
  const day = minutesOf(s.name, s.date);
  const w = wageOf(s.name, dur(s));
  el.className = 'sum' + (day > DAY_LIMIT || hasConflict(s) ? ' warn' : '');
  el.textContent = `${hrs(dur(s))} 小時${w ? '，$' + money(w.total) : ''}` +
    (day !== dur(s) ? `；${s.name}這天共 ${hrs(day)} 小時` : '') +
    (day > DAY_LIMIT ? '（超過 8 小時）' : '') +
    (hasConflict(s) ? '，和同一人的另一個班重疊' : '');
}

function openStaffPop(name, anchor) {
  const p = person(name);
  if (!p) return;
  const pop = $('pop');
  pop.dataset.kind = 'staff';
  pop.dataset.name = name;
  pop.style.setProperty('--c', p.color);
  pop.innerHTML = `
    <h3><button class="colorbtn" data-a="palette" title="更換顏色"><span class="dot"></span></button><span class="pname">${esc(name)}</span></h3>
    <div class="palette" hidden>
      ${PALETTE.map(c => `<button data-color="${c}" class="${c === p.color ? 'on' : ''}" style="--c:${c}" aria-label="${c}"></button>`).join('')}
      <label class="custom" title="自訂顏色"><input type="color" data-f="custom" value="${p.color}">自訂</label>
    </div>
    <div class="sum" id="staffSum"></div>
    <label>姓名</label>
    <input data-f="rename" maxlength="20" value="${esc(name)}">
    <label>時薪 <span class="hint">兩欄都填＝拆開付</span></label>
    <div class="two3">
      <div class="pre"><span>現金</span><input data-f="rateCash" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${p.rateCash}"></div>
      <div class="pre"><span>轉帳</span><input data-f="rateTransfer" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${p.rateTransfer}"></div>
    </div>
    <label>預設店</label>
    ${storeSeg(p.store, 'data-pstore')}
    <label>預設時數 <span class="hint">拖進行事曆時的班長度</span></label>
    <div class="pre short"><input data-f="defLen" type="number" min="0.5" max="18" step="0.5" inputmode="decimal" placeholder="例如 7" value="${p.defLen}"><span>小時</span></div>
    <label>備註 <span class="hint">例如：週三不能上、只能晚班</span></label>
    <textarea data-f="note" rows="2" maxlength="80">${esc(p.note)}</textarea>
    <label>這週休假（off）</label>
    <div class="offdays">${weekDays().map(d => `<button data-offday="${d}" class="${isOff(name, d) ? 'on' : ''}" title="${U.fdw(d)}"><b>${U.fd(d, true)}</b><span>${wd(d)}</span></button>`).join('')}</div>
    <div class="foot2">
      <button class="ghost danger" data-a="delStaff">刪除員工</button>
      <span class="row">
        <button class="ghost" data-a="focus">${S.focus === name ? '顯示全部' : '只看這個人'}</button>
        <button class="primary" data-a="close">完成</button>
      </span>
    </div>`;
  updateStaffSum(p);
  placePop(anchor);
}

function updateStaffSum(p) {
  const el = $('staffSum');
  if (!el) return;
  const m = minutesOf(p.name);
  const w = wageOf(p.name, m);
  const days = new Set(S.shifts.filter(s => s.name === p.name).map(s => s.date)).size;
  el.className = 'sum' + (m > WEEK_LIMIT ? ' warn' : '');
  el.textContent = `這週 ${days} 天、${hrs(m)} 小時` +
    (w ? `、$${money(w.total)}${w.cash && w.tr ? `（現金 $${money(w.cash)}＋轉帳 $${money(w.tr)}）` : ''}` : '、未填時薪') +
    (m > WEEK_LIMIT ? '（超過 40 小時）' : '');
}

function onPopInput(e) {
  const pop = $('pop');
  const f = e.target.dataset.f;
  if (pop.dataset.kind !== 'staff') return;
  const p = person(pop.dataset.name);
  if (f === 'rateCash' || f === 'rateTransfer') {
    const v = e.target.value.trim();
    p[f] = v === '' || isNaN(Number(v)) || Number(v) < 0 ? '' : Number(v);
    updateStaffSum(p);
    changed();
  } else if (f === 'custom') {
    setColor(p, e.target.value);
  }
}

function setColor(p, c) {
  p.color = c;
  const pop = $('pop');
  pop.style.setProperty('--c', c);
  pop.querySelectorAll('.palette [data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === c));
  changed();
}

function onPopChange(e) {
  const pop = $('pop');
  const f = e.target.dataset.f;
  if (!f || f === 'rateCash' || f === 'rateTransfer' || f === 'custom') return;
  if (pop.dataset.kind === 'shift') {
    const s = S.shifts.find(x => x.id === pop.dataset.id);
    if (!s) return;
    if (f === 'start' || f === 'end') {
      const st = pop.querySelector('[data-f=start]'), en = pop.querySelector('[data-f=end]');
      if (toMin(en.value) <= toMin(st.value)) {
        if (f === 'start') en.value = toHM(Math.min(toMin(st.value) + 60, HOUR_TO * 60));
        else st.value = toHM(Math.max(toMin(en.value) - 60, HOUR_FROM * 60));
      }
      s.start = st.value; s.end = en.value;
    } else if (f === 'name') {
      s.name = e.target.value;
      pop.style.setProperty('--c', colorOf(s.name));
    } else if (f === 'note') {
      s.note = e.target.value.trim();
    }
    changed();
    updatePopSum(s);
  } else if (pop.dataset.kind === 'staff') {
    const p = person(pop.dataset.name);
    if (f === 'rename') {
      const old = pop.dataset.name, nu = e.target.value.trim();
      if (!nu || nu === old) { e.target.value = old; return; }
      if (person(nu)) { toast(`已經有「${nu}」了`); e.target.value = old; return; }
      p.name = nu;
      S.shifts.forEach(s => { if (s.name === old) s.name = nu; });
      S.offs.forEach(o => { if (o.name === old) o.name = nu; });
      if (S.focus === old) S.focus = nu;
      if (S.hidden.has(old)) { S.hidden.delete(old); S.hidden.add(nu); saveHidden(); }
      if (S.lastLen[old]) { S.lastLen[nu] = S.lastLen[old]; delete S.lastLen[old]; }
      pop.dataset.name = nu;
      pop.querySelector('.pname').textContent = nu;
      changed();
      toast('已改名（其他週已排的班仍是原本的名字）');
    } else if (f === 'defLen') {
      const v = Number(e.target.value);
      p.defLen = e.target.value.trim() === '' || isNaN(v) || v <= 0 ? '' : Math.min(18, Math.round(v * 4) / 4);
      e.target.value = p.defLen;
      changed();
    } else if (f === 'note') {
      p.note = e.target.value.trim();
      changed();
    }
  }
}

async function onPopClick(e) {
  const pop = $('pop');
  const btn = e.target.closest('button');
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.color) return setColor(person(pop.dataset.name), btn.dataset.color);
  if (btn.dataset.pstore) {
    const p = person(pop.dataset.name);
    p.store = p.store === btn.dataset.pstore ? '' : btn.dataset.pstore;
    pop.querySelectorAll('[data-pstore]').forEach(b => b.classList.toggle('on', b.dataset.pstore === p.store));
    return changed();
  }
  if (btn.dataset.sstore) {
    const s = S.shifts.find(x => x.id === pop.dataset.id);
    s.store = btn.dataset.sstore;
    pop.querySelectorAll('[data-sstore]').forEach(b => b.classList.toggle('on', b === btn));
    return changed();
  }
  if (btn.dataset.offday) return toggleOff(pop.dataset.name, btn.dataset.offday, btn);
  const a = btn.dataset.a;
  if (a === 'palette') {
    const pal = pop.querySelector('.palette');
    pal.hidden = !pal.hidden;
    return placePop(document.querySelector(`.card[data-name="${CSS.escape(pop.dataset.name)}"]`) || $('grid'));
  }
  if (a === 'close') return hidePop();
  if (a === 'del') {
    const s = S.shifts.find(x => x.id === pop.dataset.id);
    hidePop();
    return removeShifts([s], `已刪除 ${s.name} ${U.fd(s.date, true)} 的班`);
  }
  if (a === 'dup') {
    const s = S.shifts.find(x => x.id === pop.dataset.id);
    const next = addDays(s.date, 1);
    if (!weekDays().includes(next)) return toast('隔天是下一週，請切到下一週再排');
    if (isOff(s.name, next)) return toast(`${s.name} 隔天是 off`);
    const n = { ...s, id: 's' + S.seq++, date: next };
    S.shifts.push(n);
    if (effectiveView() === 'day') S.day = weekDays().indexOf(next);
    changed();
    return openShiftPop(n.id);
  }
  if (a === 'focus') {
    S.focus = S.focus === pop.dataset.name ? null : pop.dataset.name;
    hidePop();
    return render();
  }
  if (a === 'delStaff') {
    const name = pop.dataset.name;
    const mine = S.shifts.filter(s => s.name === name);
    const myOffs = S.offs.filter(o => o.name === name);
    hidePop();
    if (mine.length && !(await confirmDialog(`刪除「${name}」？\n這週排給他的 ${mine.length} 個班也會一起刪除。`))) return;
    const idx = S.staff.findIndex(p => p.name === name);
    const p0 = S.staff[idx];
    S.staff.splice(idx, 1);
    S.shifts = S.shifts.filter(s => s.name !== name);
    S.offs = S.offs.filter(o => o.name !== name);
    if (S.focus === name) S.focus = null;
    changed();
    toast(`已刪除「${name}」`, () => {
      S.staff.splice(idx, 0, p0);
      S.shifts.push(...mine);
      S.offs.push(...myOffs);
      changed();
    });
  }
}

async function toggleOff(name, date, btn) {
  if (isOff(name, date)) {
    S.offs = S.offs.filter(o => !(o.name === name && o.date === date));
  } else {
    const mine = S.shifts.filter(s => s.name === name && s.date === date);
    if (mine.length) {
      if (!(await confirmDialog(`${name} ${U.fdw(date)} 已經排了 ${mine.length} 個班。\n標成 off 會刪除這些班，要繼續嗎？`))) return;
      const ids = new Set(mine.map(s => s.id));
      S.shifts = S.shifts.filter(s => !ids.has(s.id));
    }
    S.offs.push({ date, name });
  }
  if (btn) btn.classList.toggle('on', isOff(name, date));
  changed();
  const p = person(name);
  if (p) updateStaffSum(p);
}

function removeShifts(list, msg) {
  const ids = new Set(list.map(s => s.id));
  S.shifts = S.shifts.filter(s => !ids.has(s.id));
  changed();
  toast(msg, () => { S.shifts.push(...list); changed(); });
}

function saveHidden() { chrome.storage.local.set({ hiddenStaff: [...S.hidden] }); }

// ---------- 提示列、確認框 ----------
let toastTimer = null;
function toast(text, undo) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>復原</button>' : ''}`;
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 3500);
}

function confirmDialog(text) {
  return new Promise(resolve => {
    $('dialogText').textContent = text;
    $('dialog').hidden = false;
    const done = v => { $('dialog').hidden = true; resolve(v); };
    $('dialogYes').onclick = () => done(true);
    $('dialogNo').onclick = () => done(false);
  });
}

// ---------- 選單功能 ----------
function scheduleText() {
  const days = weekDays();
  let out = `班表 ${U.fdw(days[0])} – ${U.fdw(days[6])}\n`;
  days.forEach(d => {
    const list = S.shifts.filter(s => s.date === d);
    const names = S.staff.map(p => p.name).filter(n => list.some(s => s.name === n) || isOff(n, d));
    out += `\n${U.fdw(d)}\n`;
    if (!names.length) { out += '  —\n'; return; }
    names.forEach(n => {
      if (isOff(n, d)) { out += `  ${n} off\n`; return; }
      const mine = list.filter(s => s.name === n).sort((a, b) => toMin(a.start) - toMin(b.start));
      out += `  ${n} ${mine.map(s => `${s.store ? U.storeLetter(s.store) : ''}${U.t12(s.start)}-${U.t12(s.end)}`).join(' ')}\n`;
    });
  });
  const totals = S.staff.map(p => [p, minutesOf(p.name)]).filter(x => x[1]);
  if (totals.length) {
    out += '\n本週工時：' + totals.map(([p, m]) => {
      const w = wageOf(p.name, m);
      return `${p.name} ${hrs(m)}h${w ? ' $' + money(w.total) : ''}`;
    }).join('、');
  }
  return out;
}

async function menuAction(act) {
  hideMenu();
  if (act === 'exportPdf') {
    await flushSave();
    exportPdf();
  } else if (act === 'copyText') {
    try {
      await navigator.clipboard.writeText(scheduleText());
      toast('已複製班表文字，可以直接貼到 LINE');
    } catch (e) {
      toast('複製失敗，請再試一次');
    }
  } else if (act === 'copyLastWeek') {
    const prev = addDays(S.weekStart, -7);
    $('loading').hidden = false;
    let r;
    try {
      r = await Api.call({ action: 'schedule.get', weekStart: prev }, S.settings);
      if (!r.ok) throw new Error(r.error);
    } catch (e) {
      return toast('讀取上週失敗：' + e.message);
    } finally {
      $('loading').hidden = true;
    }
    if (!r.shifts.length) return toast('上週沒有排班');
    if (S.shifts.length && !(await confirmDialog(`這週已經有 ${S.shifts.length} 個班。\n要用上週的 ${r.shifts.length} 個班取代嗎？（休假不會複製）`))) return;
    const before = S.shifts;
    S.shifts = withIds(r.shifts.map(s => ({ ...s, date: addDays(s.date, 7) }))).filter(s => !isOff(s.name, s.date));
    ensureStaff();
    changed();
    toast(`已套用上週的 ${S.shifts.length} 個班`, () => { S.shifts = before; changed(); });
  } else if (act === 'clearWeek') {
    if (!S.shifts.length) return toast('這週還沒有排班');
    if (!(await confirmDialog(`清空這週的 ${S.shifts.length} 個班？`))) return;
    removeShifts(S.shifts.slice(), '已清空這週');
  } else if (act === 'resetWidth') {
    S.colWs = {}; S.poolW = 176; S.footH = 132;
    applyPoolW(); applyFootH();
    chrome.storage.local.set({ colWs: {}, poolW: 176, footH: 132 });
    render();
  } else if (act === 'reload') {
    if (S.dirty && !(await confirmDialog('有還沒存進試算表的修改，重新讀取會捨棄這些修改。要繼續嗎？'))) return;
    S.dirty = false;
    clearTimeout(S.saveTimer);
    loadWeek(S.weekStart, { discardLocal: true });
  }
}

// ---------- 事件 ----------
function bindUI() {
  $('prevWeek').onclick = () => loadWeek(addDays(S.weekStart, -7));
  $('nextWeek').onclick = () => loadWeek(addDays(S.weekStart, 7));
  $('thisWeek').onclick = () => loadWeek(U.weekStartOf(todayStr()));
  $('weekLabel').onclick = () => U.pickDate($('weekPick'), S.weekStart, d => {
    const ws = U.weekStartOf(d);
    if (ws !== S.weekStart) loadWeek(ws).then(() => { S.day = weekDays().indexOf(d); render(); });
    else { S.day = weekDays().indexOf(d); render(); }
  });
  $('saveState').onclick = () => { if (S.saveError) { S.saveError = null; S.dirty = true; doSave(); } };
  $('viewMode').onchange = e => {
    S.view = e.target.value;
    chrome.storage.local.set({ view: S.view });
    render();
  };
  $('storeFilter').onclick = e => {
    const b = e.target.closest('button[data-store]');
    if (!b) return;
    S.storeFilter = b.dataset.store;
    chrome.storage.local.set({ storeFilter: S.storeFilter });
    render();
  };
  $('menuBtn').onclick = () => ($('menu').hidden = !$('menu').hidden);
  $('menu').onclick = e => { const b = e.target.closest('button[data-act]'); if (b) menuAction(b.dataset.act); };
  $('dayTabs').onclick = e => {
    const b = e.target.closest('button[data-day]');
    if (b) { S.day = +b.dataset.day; hidePop(); render(); }
  };
  $('staffList').onclick = e => {
    const wk = e.target.closest('.wk .free, .wk .off');
    if (wk) {
      toggleOff(wk.closest('.card').dataset.name, wk.dataset.wkday);
      return;
    }
    if (e.target.closest('.cmode')) {
      S.cardMode = S.cardMode === 'days' ? 'pay' : 'days';
      chrome.storage.local.set({ cardMode: S.cardMode });
      return renderStaff();
    }
    const b = e.target.closest('[data-eye]');
    if (!b) return;
    const n = b.dataset.eye;
    if (S.hidden.has(n)) S.hidden.delete(n); else S.hidden.add(n);
    saveHidden();
    render();
  };
  $('gridHead').onclick = e => {
    const b = e.target.closest('.offchip');
    if (!b) return;
    const name = b.dataset.offName, date = b.dataset.offDate;
    S.offs = S.offs.filter(o => !(o.name === name && o.date === date));
    changed();
    toast(`已取消 ${name} ${U.fd(date, true)} 的休假`, () => { S.offs.push({ name, date }); changed(); });
  };
  $('footSplit').ondblclick = () => { S.footH = 132; applyFootH(); chrome.storage.local.set({ footH: 132 }); };
  $('gridScroll').addEventListener('scroll', () => { $('footScroll').scrollLeft = $('gridScroll').scrollLeft; });
  $('gridFoot').onclick = e => {
    const b = e.target.closest('[data-fm]');
    if (!b) return;
    S.footMode = b.dataset.fm;
    chrome.storage.local.set({ footMode: S.footMode });
    renderGrid();
  };
  $('poolSplit').ondblclick = () => { S.poolW = 176; applyPoolW(); chrome.storage.local.set({ poolW: 176 }); render(); };
  $('addStaff').onsubmit = e => {
    e.preventDefault();
    const name = $('newStaff').value.trim();
    if (!name) return;
    if (person(name)) return toast(`已經有「${name}」了`);
    S.staff.push(normStaff({ name, color: nextColor(), store: S.storeFilter !== 'all' ? S.storeFilter : '' }, S.staff.length));
    $('newStaff').value = '';
    changed();
    const card = document.querySelector(`.card[data-name="${CSS.escape(name)}"]`);
    if (card) openStaffPop(name, card); // 新增後直接填時薪、預設時間
  };

  $('pop').addEventListener('input', onPopInput);
  $('pop').addEventListener('change', onPopChange);
  $('pop').addEventListener('click', onPopClick);

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', () => endDrag(true));
  document.addEventListener('pointercancel', () => endDrag(false));
  document.addEventListener('keydown', e => {
    if ($('sched').hidden) return;
    if (e.key === 'Escape') {
      if (D) endDrag(false);
      hidePop(); hideMenu();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && $('pop').dataset.kind === 'shift' && !$('pop').hidden &&
        !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      const s = S.shifts.find(x => x.id === $('pop').dataset.id);
      if (s) { hidePop(); removeShifts([s], `已刪除 ${s.name} ${U.fd(s.date, true)} 的班`); }
    }
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { applyPoolW(); if (!$('sched').hidden) { hidePop(); render(); } }, 120);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  setInterval(() => { if (!$('sched').hidden && S.weekStart && !D && $('pop').hidden) renderGrid(); }, 5 * 60 * 1000);
}

window.Sched = { start, updateSettings, prefsChanged, flushSave, S, render, openShiftPop, openStaffPop, menuAction };
})();
