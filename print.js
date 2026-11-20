// 給員工看的班表（列印／存成 PDF）
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

(async () => {
  const { printData: d } = await chrome.storage.local.get(['printData']);
  if (!d) {
    document.getElementById('title').textContent = '沒有班表資料，請回到排班頁重新匯出';
    return;
  }
  document.title = d.title;
  document.getElementById('title').textContent = d.title;
  document.getElementById('legend').innerHTML = d.stores
    .map(s => `<span><span class="tag" style="--c:${s.color}">${esc(s.code)}</span></span>`).join('') +
    '<span class="off">off</span><span>＝休假</span>';
  document.getElementById('head').innerHTML = '<tr><th class="name">員工</th>' +
    d.days.map(x => `<th><b>${esc(x.label)}</b><span>${esc(x.wd)}</span></th>`).join('') + '</tr>';
  document.getElementById('body').innerHTML = d.rows.map(r => '<tr><td class="name">' + esc(r.name) + '</td>' +
    r.cells.map(c => {
      if (c.off) return '<td class="off">off</td>';
      return '<td>' + c.shifts.map(s =>
        `<span class="s">${s.store ? `<span class="tag" style="--c:${s.color}">${esc(s.store)}</span>` : ''}${esc(s.time)}</span>`).join('') + '</td>';
    }).join('') + '</tr>').join('');
  document.getElementById('printed').textContent = '列印時間 ' + d.printed;
  document.getElementById('printBtn').onclick = () => window.print();
})();
