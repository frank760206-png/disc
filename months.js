// ============ 營業額：月份檢視（右邊，可看 1 或 3 個月，日曆／表格切換）============
(() => {
const $ = id => document.getElementById(id);
const { pad, addDays, todayStr, wd, money, esc } = U;
const M = {
  settings: null, onPick: null, end: null, count: 3, mode: 'cal', selected: null,
  cache: {}, loading: new Set(), seq: 0, bound: false
};

const ym = s => s.slice(0, 7);
const monthStart = k => `${k}-01`;
const monthDays = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const shiftMonth = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1, 12); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return `${y} 年 ${m} 月`; };
const num = v => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));
const income = r => num(r.card) + num(r.cash) + num(r.panda);
const compact = n => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

async function start(settings, onPick) {
  M.settings = settings;
  M.onPick = onPick;
  if (!M.bound) {
    M.bound = true;
    const pref = await chrome.storage.local.get(['monthMode', 'monthCount']);
    M.mode = pref.monthMode === 'table' ? 'table' : 'cal';
    M.count = pref.monthCount === 1 ? 1 : 3;
    M.end = ym(todayStr());
    $('mPrev').onclick = () => { M.end = shiftMonth(M.end, -1); render(); load(); };
    $('mNext').onclick = () => { M.end = shiftMonth(M.end, 1); render(); load(); };
    $('mThis').onclick = () => { M.end = ym(todayStr()); render(); load(); };
    $('mMode').onclick = e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      M.mode = b.dataset.mode;
      chrome.storage.local.set({ monthMode: M.mode });
      render();
    };
    $('mCount').onclick = e => {
      const b = e.target.closest('[data-count]');
      if (!b) return;
      M.count = Number(b.dataset.count);
      chrome.storage.local.set({ monthCount: M.count });
      render(); load();
    };
    $('monthList').onclick = e => {
      const c = e.target.closest('[data-day]');
      if (c && !c.classList.contains('future') && M.onPick) M.onPick(c.dataset.day);
    };
  }
  M.cache = {};
  render();
  load();
}

function months() {
  const out = [];
  for (let i = M.count - 1; i >= 0; i--) out.push(shiftMonth(M.end, -i));
  return out;
}

async function load(force) {
  const need = months().filter(k => force || !M.cache[k]);
  if (!need.length) return;
  const from = monthStart(need[0]);
  const last = need[need.length - 1];
  const to = `${last}-${pad(monthDays(last))}`;
  const seq = ++M.seq;
  need.forEach(k => M.loading.add(k));
  render();
  try {
    const r = await Api.call({ action: 'revenue.range', from, to }, M.settings);
    if (!r.ok) throw new Error(r.error || '讀取失敗');
    need.forEach(k => (M.cache[k] = {}));
    Object.entries(r.days || {}).forEach(([d, v]) => { if (M.cache[ym(d)]) M.cache[ym(d)][d] = v; });
    M.error = null;
  } catch (e) {
    M.error = e.message;
  } finally {
    need.forEach(k => M.loading.delete(k));
    if (seq === M.seq || !M.loading.size) render();
  }
}

// 左邊選了某一天：如果不在畫面上，就把那個月移進來
function select(d) {
  M.selected = d;
  if (!M.end) return;
  const k = ym(d);
  if (!months().includes(k)) { M.end = k; load(); }
  render();
}

// 左邊送出後，重新讀那個月
function reload(d) {
  const k = ym(d);
  delete M.cache[k];
  load();
}

function summary(k) {
  const data = M.cache[k] || {};
  const rows = Object.values(data);
  const t = { income: 0, card: 0, cash: 0, panda: 0, wage: 0, days: 0 };
  rows.forEach(r => {
    const inc = income(r);
    t.income += inc; t.card += num(r.card); t.cash += num(r.cash); t.panda += num(r.panda); t.wage += num(r.wage);
    if (inc) t.days++;
  });
  t.avg = t.days ? Math.round(t.income / t.days) : 0;
  return t;
}

function render() {
  if (!M.end) return;
  const ks = months();
  $('mRange').textContent = ks.length > 1 ? `${monthLabel(ks[0])} – ${monthLabel(ks[ks.length - 1]).replace(/^\d+ 年 /, '')}` : monthLabel(ks[0]);
  $('mThis').hidden = ks.includes(ym(todayStr()));
  $('mNext').disabled = M.end >= ym(todayStr());
  $('mMode').querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === M.mode));
  $('mCount').querySelectorAll('[data-count]').forEach(b => b.classList.toggle('on', Number(b.dataset.count) === M.count));
  $('monthList').classList.toggle('one', M.count === 1);
  $('monthList').classList.toggle('tbl', M.mode === 'table');
  $('monthList').innerHTML = (M.error ? `<div class="merr">讀取失敗：${esc(M.error)}</div>` : '') +
    ks.map(k => monthCard(k)).join('');
}

function monthCard(k) {
  const loading = M.loading.has(k) && !M.cache[k];
  const t = summary(k);
  const head = `<header>
      <h3>${monthLabel(k)}</h3>
      <div class="mtot"><b>$${money(t.income)}</b><span>${t.days} 天 · 日均 $${money(t.avg)}</span></div>
    </header>
    <div class="msub"><span>Card $${money(t.card)}</span><span>Cash $${money(t.cash)}</span><span>Panda $${money(t.panda)}</span><span>Wage $${money(t.wage)}</span></div>`;
  if (loading) return `<article class="month">${head}<div class="mload">讀取中…</div></article>`;
  return `<article class="month">${head}${M.mode === 'cal' ? calendar(k) : table(k)}</article>`;
}

function calendar(k) {
  const data = M.cache[k] || {};
  const n = monthDays(k), first = monthStart(k), today = todayStr();
  const startDay = U.prefs.startDay;
  const lead = (U.pd(first).getDay() - startDay + 7) % 7;
  const max = Math.max(1, ...Object.values(data).map(income));
  let html = '<div class="cal">';
  for (let i = 0; i < 7; i++) html += `<div class="cw">${U.WD[(startDay + i) % 7]}</div>`;
  for (let i = 0; i < lead; i++) html += '<div></div>';
  for (let d = 1; d <= n; d++) {
    const day = `${k}-${pad(d)}`;
    const r = data[day];
    const inc = r ? income(r) : 0;
    const future = day > today;
    const level = inc ? 0.12 + 0.55 * inc / max : 0;
    const cls = ['cd', future ? 'future' : '', !r && !future ? 'empty' : '', day === today ? 'today' : '', day === M.selected ? 'sel' : ''].join(' ');
    const tip = `${U.fdw(day)}` + (r ? `\n收入 $${money(inc)}（Card ${money(num(r.card))} / Cash ${money(num(r.cash))} / Panda ${money(num(r.panda))}）\nWage $${money(num(r.wage))}` : future ? '' : '\n還沒有資料');
    html += `<button class="${cls}" data-day="${day}" title="${esc(tip)}" style="--lv:${level}">
      <span class="dn">${d}</span>${r ? `<span class="dv">${compact(inc)}</span>` : ''}</button>`;
  }
  return html + '</div>';
}

function table(k) {
  const data = M.cache[k] || {};
  const n = monthDays(k), today = todayStr();
  let rows = '';
  for (let d = 1; d <= n; d++) {
    const day = `${k}-${pad(d)}`;
    if (day > today) break;
    const r = data[day];
    const v = x => (r && num(x) ? money(num(x)) : '');
    rows += `<tr data-day="${day}" class="${r ? '' : 'empty'}${day === M.selected ? ' sel' : ''}${day === today ? ' today' : ''}">
      <td class="d">${U.fd(day, true)} <span>${wd(day)}</span></td>
      <td class="inc">${r ? money(income(r)) : '—'}</td><td>${v(r && r.card)}</td><td>${v(r && r.cash)}</td><td>${v(r && r.panda)}</td><td>${v(r && r.wage)}</td></tr>`;
  }
  const t = summary(k);
  return `<div class="tblwrap"><table class="mtable">
    <thead><tr><th>日期</th><th>收入</th><th>Card</th><th>Cash</th><th>Panda</th><th>Wage</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="none">這個月還沒開始</td></tr>'}</tbody>
    <tfoot><tr><td>合計</td><td class="inc">${money(t.income)}</td><td>${money(t.card)}</td><td>${money(t.cash)}</td><td>${money(t.panda)}</td><td>${money(t.wage)}</td></tr></tfoot>
  </table></div>`;
}

window.Months = { start, select, reload, render };
})();
