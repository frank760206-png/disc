// ============ 營業額 ============
(() => {
const $ = id => document.getElementById(id);
const { addDays, todayStr, toMin, hrs, money, esc } = U;
const INCOME = ['card', 'cash', 'panda'];
const FIELDS = ['card', 'cash', 'panda', 'wage'];
let settings, bound = false, existing = false, daySeq = 0;
let expected = null; // { total, lines, transfer, missing } 或 null（沒有排班）

function start(s) {
  settings = s;
  $('who').textContent = settings.name;
  if (!bound) {
    bound = true;
    INCOME.forEach(id => $(id).addEventListener('input', updateTotal));
    $('wage').addEventListener('input', renderWageCheck);
    $('revForm').addEventListener('submit', e => { e.preventDefault(); submit(false); });
    $('revPrev').onclick = () => setDate(addDays($('date').value, -1));
    $('revNext').onclick = () => setDate(addDays($('date').value, 1));
    $('revToday').onclick = () => setDate(todayStr());
    $('revDateBtn').onclick = () => U.pickDate($('date'), $('date').value, setDate);
  }
  Months.start(settings, setDate);
  setDate($('date').value || todayStr());
  loadRecent();
}

function shown() {
  if ($('date').value) renderDate();
  setTimeout(() => $('card').focus(), 0);
}

function refresh() {
  if ($('date').value) setDate($('date').value);
}

// ---------- 日期 ----------
function renderDate() {
  const d = $('date').value, t = todayStr();
  $('revDateText').textContent = U.fdw(d);
  $('revDateTag').textContent = d === t ? '今天' : d === addDays(t, -1) ? '昨天' : '';
  $('revDateTag').hidden = !$('revDateTag').textContent;
  $('revNext').disabled = d >= t;
  $('revToday').hidden = d === t;
  $('date').max = t;
}

async function setDate(d) {
  if (!d) return;
  if (d > todayStr()) d = todayStr();
  $('date').value = d;
  renderDate();
  Months.select(d);
  $('revMsg').hidden = true;
  FIELDS.concat('note').forEach(id => ($(id).value = ''));
  existing = false;
  setDayState('loading');
  updateTotal();
  expected = null;
  renderWageCheck('loading');

  const seq = ++daySeq;
  const [day, sched] = await Promise.allSettled([
    Api.call({ action: 'get', date: d }, settings),
    Api.call({ action: 'schedule.get', weekStart: d }, settings)
  ]);
  if (seq !== daySeq) return;

  if (day.status === 'fulfilled' && day.value.ok) {
    const r = day.value;
    existing = !!r.exists;
    if (existing) FIELDS.forEach(k => ($(k).value = r[k] === '' || r[k] == null ? '' : r[k]));
    setDayState(existing ? 'existing' : 'new');
  } else {
    setDayState('unknown', day.status === 'fulfilled' ? day.value.error : day.reason && day.reason.message);
  }
  updateTotal();

  if (sched.status === 'fulfilled' && sched.value.ok) {
    expected = calcExpected(d, sched.value);
    renderWageCheck();
  } else {
    expected = null;
    renderWageCheck('error');
  }
}

function setDayState(state, err) {
  const el = $('revDayState');
  el.className = 'daystate ' + state;
  el.textContent = {
    loading: '讀取這天的資料…',
    existing: '這天已經有資料，修改後按「更新」會覆蓋',
    new: '這天還沒有資料',
    unknown: '讀不到這天的資料' + (err ? '：' + err : '')
  }[state];
  $('revSubmit').textContent = state === 'existing' ? '更新' : '送出';
}

// ---------- 和排班比對現金薪資 ----------
function calcExpected(d, r) {
  const staff = new Map((r.staff || []).map(p => [p.name, p]));
  const shifts = (r.shifts || []).filter(s => s.date === d);
  if (!shifts.length) return { none: true };
  const per = new Map();
  shifts.forEach(s => per.set(s.name, (per.get(s.name) || 0) + toMin(s.end) - toMin(s.start)));
  const out = { total: 0, lines: [], transfer: [], missing: [] };
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));
  per.forEach((min, name) => {
    const p = staff.get(name) || {};
    // 相容上一版的格式（一個時薪＋付款方式）
    let cashRate = num(p.rateCash), trRate = num(p.rateTransfer);
    if (p.rateCash === undefined && p.rate !== undefined) { if (p.pay === '轉帳') trRate = num(p.rate); else cashRate = num(p.rate); }
    if (!cashRate && !trRate) { out.missing.push(`${name} ${hrs(min)}h`); return; }
    if (trRate) out.transfer.push(`${name} ${hrs(min)}h × $${money(trRate)}`);
    if (!cashRate) return;
    const w = Math.round(min / 60 * cashRate);
    out.total += w;
    out.lines.push(`${name} ${hrs(min)}h × $${money(cashRate)} = $${money(w)}`);
  });
  return out;
}

function renderWageCheck(state) {
  const box = $('wageCheck');
  box.hidden = false;
  if (state === 'loading') { box.className = 'wagecheck muted'; box.textContent = '讀取這天的排班…'; return; }
  if (state === 'error' || !expected) { box.className = 'wagecheck muted'; box.textContent = '讀不到排班資料，無法比對'; return; }
  if (expected.none) { box.className = 'wagecheck muted'; box.textContent = '這天沒有排班，無法比對現金薪資'; return; }

  const v = $('wage').value.trim();
  const entered = v === '' ? null : Number(v);
  let verdict = '', cls = 'wagecheck';
  if (entered == null) {
    verdict = `<b>排班應付現金薪資 $${money(expected.total)}</b>`;
  } else if (entered === expected.total) {
    cls += ' ok';
    verdict = `<b>✓ 與排班相符</b>（$${money(expected.total)}）`;
  } else {
    cls += ' warn';
    const diff = entered - expected.total;
    verdict = `<b>⚠ 與排班不符：${diff > 0 ? '多' : '少'} $${money(Math.abs(diff))}</b>（排班應付 $${money(expected.total)}）`;
  }
  const detail = [];
  if (expected.lines.length) detail.push(expected.lines.join('<br>'));
  if (expected.missing.length) detail.push(`<span class="miss">沒填時薪，未計入：${esc(expected.missing.join('、'))}</span>`);
  if (expected.transfer.length) detail.push(`<span class="tr">轉帳的部分不列入：${esc(expected.transfer.join('、'))}</span>`);
  box.className = cls;
  box.innerHTML = verdict + (detail.length ? `<div class="detail">${detail.join('<br>')}</div>` : '');
}

// ---------- 送出 ----------
function readAmounts() {
  const out = {};
  FIELDS.forEach(id => {
    const v = $(id).value.trim();
    out[id] = v === '' ? 0 : Number(v);
  });
  return out;
}

function updateTotal() {
  const a = readAmounts();
  const vals = INCOME.map(k => a[k]);
  const bad = vals.some(n => isNaN(n) || n < 0);
  $('total').textContent = bad ? '—' : money(vals.reduce((s, n) => s + n, 0));
}

function showMsg(type, html) {
  const m = $('revMsg');
  m.className = 'msg ' + type;
  m.innerHTML = html;
  m.hidden = false;
}

async function submit(force) {
  const a = readAmounts();
  const vals = FIELDS.map(k => a[k]);
  if (vals.some(n => isNaN(n) || n < 0 || !Number.isInteger(n))) return showMsg('err', '金額請填 0 以上的整數');
  if (vals.every(n => n === 0)) return showMsg('err', '請至少填一個金額');
  const d = $('date').value;
  if (!d) return showMsg('err', '請選擇營業日期');

  const btn = $('revSubmit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '送出中…';
  $('revMsg').hidden = true;
  try {
    const r = await Api.call({
      action: 'add', date: d, ...a, note: $('note').value.trim(),
      force: force || existing,
      expectedWage: expected && !expected.none ? expected.total : ''
    }, settings);
    if (r.ok) {
      let html = `已${existing ? '更新' : '寫入'} ${esc(U.fdw(d))}（工作表1 ${esc(r.cell)}），收入合計 ${money(r.income)} 元`;
      if (r.wage) html += `，Wage ${money(r.wage)} 元`;
      if (r.created) html += `<br>已自動新增「${esc(r.month)}」月份表`;
      showMsg('ok', html);
      existing = true;
      setDayState('existing');
      Months.reload(d);
      $('note').value = '';
      loadRecent();
    } else if (r.duplicate) {
      const e = r.existing || {};
      const show = v => (v === '' || v == null ? '-' : money(v));
      showMsg('warn',
        `${esc(U.fdw(d))} 已經有資料：Card ${show(e.card)}、Cash ${show(e.cash)}、` +
        `Panda ${show(e.panda)}、Wage ${show(e.wage)}。要用這次的數字覆蓋嗎？` +
        `<div class="btns"><button type="button" class="primary" id="revYes">覆蓋</button>` +
        `<button type="button" class="ghost" id="revNo">取消</button></div>`);
      $('revYes').onclick = () => submit(true);
      $('revNo').onclick = () => ($('revMsg').hidden = true);
    } else {
      showMsg('err', esc(r.error || '送出失敗'));
    }
  } catch (e) {
    showMsg('err', esc(e.message));
  } finally {
    btn.disabled = false;
    if (btn.textContent === '送出中…') btn.textContent = existing ? '更新' : label;
  }
}

async function loadRecent() {
  try {
    const r = await Api.call({ action: 'recent' }, settings);
    if (!r.ok || !r.rows || !r.rows.length) { $('recentBox').hidden = true; return; }
    $('recent').innerHTML = r.rows
      .map(x => `<li data-date="${esc(x.date)}" title="按一下打開這天"><span>${esc(/^\d{4}-\d{2}-\d{2}$/.test(x.date) ? U.fdw(x.date) : x.date)}${x.action === '覆蓋' ? '（覆蓋）' : ''}</span><span>${money(x.total)}</span></li>`)
      .join('');
    $('recent').onclick = e => { const li = e.target.closest('li[data-date]'); if (li) setDate(li.dataset.date); };
    $('recentBox').hidden = false;
  } catch (e) {
    // 讀不到最近記錄不影響填寫
  }
}

window.Rev = { start, shown, refresh };
})();
