'use strict';

/* =========================================================
   Рабочий график — учёт смен, доп. задач и выплат.
   Всё хранится на устройстве (localStorage), без сервера.
   ========================================================= */

const KEY = 'worklog.v1';
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DOW_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/* ---------- Данные ---------- */

function defaults() {
  return {
    settings: {
      rate: 0,          // ставка, ₽ в час
      start: '09:00',   // начало смены по умолчанию
      end: '18:00',     // конец смены по умолчанию
      payDayA: 5,       // дни выплат. День выплаты входит в закрывающийся период:
      payDayB: 20       // с 6-го по 20-е платят 20-го, с 21-го по 5-е платят 5-го
    },
    tasks: [],          // [{id, name, price}]
    days: {},           // 'YYYY-MM-DD' -> {start, end, note, tasks:[{id,name,price,qty,mins}]}
    paid: {}            // 'YYYY-MM-DD' (начало периода) -> true
  };
}

function cleanSettings(s) {
  delete s.split; delete s.payFirst; delete s.payNext;   // старая схема 1–15 / 16–конец
  const day = (v, def) => Math.min(27, Math.max(1, Math.round(Number(v) || def)));
  s.payDayA = day(s.payDayA, 5);
  s.payDayB = day(s.payDayB, 20);
  if (s.payDayA === s.payDayB) { s.payDayA = 5; s.payDayB = 20; }
  return s;
}

function normalize(d) {
  const base = defaults();
  d = d && typeof d === 'object' ? d : {};
  return {
    settings: cleanSettings(Object.assign(base.settings, d.settings || {})),
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    days: d.days && typeof d.days === 'object' ? d.days : {},
    paid: d.paid && typeof d.paid === 'object' ? d.paid : {}
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* повреждённые данные — начинаем с чистого листа */ }
  return defaults();
}

let db = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    toast('Не удалось сохранить данные');
  }
}

const now = new Date();
const state = {
  tab: 'calendar',
  cursor: { y: now.getFullYear(), m: now.getMonth() },
  edit: null
};

/* ---------- Утилиты ---------- */

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m: 0–11
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
}

function todayStr() {
  const t = new Date();
  return ymd(t.getFullYear(), t.getMonth(), t.getDate());
}

function fmtDateLong(ds) {
  const { y, m, d } = parseDate(ds);
  return `${d} ${MONTHS_GEN[m]}, ${DOW_LONG[new Date(y, m, d).getDay()]}`;
}

function fmtDateShort(ds) {
  const { m, d } = parseDate(ds);
  return `${d} ${MONTHS_GEN[m]}`;
}

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Минуты смены. Если конец раньше начала — смена через полночь.
function workMinutes(start, end) {
  const s = toMin(start), e = toMin(end);
  if (s == null || e == null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 1440;
  return diff;
}

const fmtHM = min => `${Math.floor(min / 60)}:${pad(min % 60)}`;
const fmtHuman = min => `${Math.floor(min / 60)} ч${min % 60 ? ' ' + (min % 60) + ' мин' : ''}`;
const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const money = n => moneyFmt.format(Math.round(n * 100) / 100) + ' ₽';
const short = n => n >= 1000 ? String(Math.round(n / 100) / 10).replace('.', ',') + 'к' : String(Math.round(n));

// Время доп. задач вычитается из смены: оно оплачивается по цене задачи, а не по ставке.
// Ставка берётся из настроек.
function dayCalc(day) {
  const min = workMinutes(day.start, day.end);
  const taskMin = (day.tasks || []).reduce((s, t) => s + (Number(t.mins) || 0), 0);
  const paidMin = Math.max(0, min - taskMin);
  const hoursPay = (paidMin / 60) * (Number(db.settings.rate) || 0);
  const tasksPay = (day.tasks || []).reduce((s, t) => s + t.price * t.qty, 0);
  return { min, taskMin, paidMin, hoursPay, tasksPay, total: hoursPay + tasksPay };
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2500);
}

/* ---------- Периоды выплат ---------- */
/* День выплаты входит в закрывающийся период, а период начинается на следующий день после прошлой выплаты.
   При выплатах 5 и 20: с 6-го по 20-е платят 20-го, с 21-го по 5-е (следующего месяца) платят 5-го. */

function payDays() {
  const a = db.settings.payDayA, b = db.settings.payDayB;
  return a <= b ? [a, b] : [b, a];
}

function periodOf(ds) {
  const { y, m, d } = parseDate(ds);
  const [lo, hi] = payDays();
  const at = (yy, mm, k) => { const t = yy * 12 + mm + k; return [Math.floor(t / 12), t % 12]; };
  let pay, prev;                                   // дата выплаты за период и дата прошлой выплаты
  if (d <= lo) {
    const [py, pm] = at(y, m, -1);
    pay = [y, m, lo]; prev = [py, pm, hi];
  } else if (d <= hi) {
    pay = [y, m, hi]; prev = [y, m, lo];
  } else {
    const [ny, nm] = at(y, m, 1);
    pay = [ny, nm, lo]; prev = [y, m, hi];
  }
  const start = new Date(prev[0], prev[1], prev[2] + 1);
  return {
    from: ymd(start.getFullYear(), start.getMonth(), start.getDate()),
    to: ymd(pay[0], pay[1], pay[2]),
    pay: ymd(pay[0], pay[1], pay[2])
  };
}

function fmtRange(from, to) {
  const f = parseDate(from), t = parseDate(to);
  return f.m === t.m
    ? `${f.d}–${t.d} ${MONTHS_GEN[t.m]}`
    : `${f.d} ${MONTHS_GEN[f.m]} – ${t.d} ${MONTHS_GEN[t.m]}`;
}

function buildPeriods() {
  const map = new Map();
  const get = ds => {
    const p = periodOf(ds);
    if (!map.has(p.from)) map.set(p.from, Object.assign({ days: [] }, p));
    return map.get(p.from);
  };
  const today = todayStr();
  get(today);
  for (const ds of Object.keys(db.days)) get(ds).days.push(ds);

  const list = [...map.values()].sort((a, b) => (a.from < b.from ? 1 : -1));
  for (const p of list) {
    p.days.sort();
    p.min = 0; p.paidMin = 0; p.hoursPay = 0; p.tasksPay = 0; p.total = 0;
    p.byTask = {};
    for (const ds of p.days) {
      const c = dayCalc(db.days[ds]);
      p.min += c.min; p.paidMin += c.paidMin; p.hoursPay += c.hoursPay; p.tasksPay += c.tasksPay; p.total += c.total;
      for (const t of db.days[ds].tasks || []) {
        const k = t.name + '|' + t.price;
        if (!p.byTask[k]) p.byTask[k] = { name: t.name, price: t.price, qty: 0 };
        p.byTask[k].qty += t.qty;
      }
    }
    p.paid = !!db.paid[p.from];
    p.current = p.from <= today && today <= p.to;
  }
  return list;
}

/* ---------- Отрисовка ---------- */

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const view = $('view');
  if (state.tab === 'calendar') view.innerHTML = renderCalendar();
  else if (state.tab === 'summary') view.innerHTML = renderSummary();
  else view.innerHTML = renderSettings();
}

function renderCalendar() {
  const { y, m } = state.cursor;
  const n = dim(y, m);
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const today = todayStr();
  let cells = '';
  let mMin = 0, mTotal = 0, mDays = 0;

  for (let i = 0; i < offset; i++) cells += '<div class="cell empty"></div>';
  for (let d = 1; d <= n; d++) {
    const ds = ymd(y, m, d);
    const day = db.days[ds];
    const col = (offset + d - 1) % 7;
    let cls = 'cell';
    if (col >= 5) cls += ' weekend';
    if (ds === today) cls += ' today';
    let inner = `<span class="n">${d}</span>`;
    if (day) {
      const c = dayCalc(day);
      cls += ' work';
      mMin += c.min; mTotal += c.total; mDays++;
      inner += `<span class="t">${c.min ? fmtHM(c.min) : '—'}</span>`;
      if (c.total > 0) inner += `<span class="m">${short(c.total)}</span>`;
      if ((day.tasks || []).length) inner += '<i class="dot"></i>';
    }
    cells += `<button class="${cls}" data-action="open-day" data-date="${ds}" aria-label="${esc(fmtDateLong(ds))}">${inner}</button>`;
  }

  const onboarding = (!db.settings.rate && !db.tasks.length)
    ? `<div class="banner">Чтобы приложение считало деньги, укажите почасовую ставку и список доп. задач с ценами.
         <br><button class="btn small primary" data-action="goto-settings">Открыть настройки</button></div>`
    : '';

  return `
    <div class="cal-head">
      <button class="icon-btn" data-action="prev-month" aria-label="Предыдущий месяц">‹</button>
      <h1>${MONTHS[m]} ${y}</h1>
      <button class="icon-btn" data-action="next-month" aria-label="Следующий месяц">›</button>
    </div>
    <div style="text-align:center;margin-bottom:10px"><button class="today-btn" data-action="today">Сегодня</button></div>
    ${onboarding}
    <div class="month-stats">
      <div><b>${mDays}</b><small>дней</small></div>
      <div><b>${mMin ? fmtHuman(mMin) : '0 ч'}</b><small>часов</small></div>
      <div><b>${money(mTotal)}</b><small>за месяц</small></div>
    </div>
    <div class="dow">${DOW.map(x => `<span>${x}</span>`).join('')}</div>
    <div class="grid">${cells}</div>`;
}

function renderSummary() {
  const periods = buildPeriods();
  const unpaid = periods.filter(p => !p.paid).reduce((s, p) => s + p.total, 0);

  const cards = periods.map(p => {
    const tasks = Object.values(p.byTask);
    const taskRows = tasks.map(t => `<div class="row" style="cursor:default"><span>${esc(t.name)} × ${t.qty}</span><span>${money(t.price * t.qty)}</span></div>`).join('');
    const dayRows = p.days.map(ds => {
      const c = dayCalc(db.days[ds]);
      return `<button class="row" data-action="open-day" data-date="${ds}"><span>${esc(fmtDateShort(ds))} · ${c.min ? fmtHM(c.min) : '—'}</span><span>${money(c.total)}</span></button>`;
    }).join('');
    const title = fmtRange(p.from, p.to);
    return `
      <div class="card">
        <div class="p-head">
          <div>
            <div class="p-title">${title}${p.current ? '<span class="badge">идёт сейчас</span>' : ''}${p.paid ? '<span class="badge paid">выплачено</span>' : ''}</div>
            <div class="p-sub">выплата ${esc(fmtDateShort(p.pay))}</div>
          </div>
          <div class="amount">${money(p.total)}</div>
        </div>
        <div class="p-chips">
          <span>Смен: <b>${p.days.length}</b></span>
          <span>По ставке: <b>${fmtHuman(p.paidMin)}</b> · ${money(p.hoursPay)}</span>
          <span>Задачи: <b>${money(p.tasksPay)}</b></span>
        </div>
        ${p.days.length ? `
        <details>
          <summary>Подробнее</summary>
          <div class="rows">
            ${tasks.length ? `<h3>Доп. задачи</h3>${taskRows}` : ''}
            <h3>По дням</h3>${dayRows}
          </div>
        </details>` : '<div class="hint">В этом периоде пока нет смен.</div>'}
        ${p.days.length ? `<button class="btn small block" style="margin-top:8px" data-action="toggle-paid" data-from="${p.from}">${p.paid ? 'Снять отметку «выплачено»' : 'Отметить выплаченным'}</button>` : ''}
      </div>`;
  }).join('');

  return `
    <h1 class="page-title">Итоги</h1>
    <div class="card hero">
      <small>Ожидает выплаты</small>
      <span class="amount">${money(unpaid)}</span>
    </div>
    ${cards}`;
}

function payHint() {
  const [lo, hi] = payDays();
  return `День выплаты входит в период. За работу с ${lo + 1}-го по ${hi}-е платят ${hi}-го, за работу с ${hi + 1}-го по ${lo}-е следующего месяца платят ${lo}-го.`;
}

function renderSettings() {
  const s = db.settings;
  const taskRows = db.tasks.map(t => `
    <div class="set-task">
      <input type="text" value="${esc(t.name)}" data-task-field="name" data-id="${t.id}" aria-label="Название задачи">
      <input type="number" inputmode="decimal" step="any" min="0" value="${t.price}" data-task-field="price" data-id="${t.id}" aria-label="Цена">
      <button class="icon-btn" data-action="del-task" data-id="${t.id}" aria-label="Удалить">✕</button>
    </div>`).join('');

  return `
    <h1 class="page-title">Настройки</h1>

    <div class="card">
      <h2>Оплата и смена</h2>
      <label class="field"><span>Ставка, ₽ в час</span>
        <input type="number" inputmode="decimal" step="any" min="0" value="${s.rate}" data-setting="rate"></label>
      <div class="grid2">
        <label class="field"><span>Начало смены</span><input type="time" value="${esc(s.start)}" data-setting="start"></label>
        <label class="field"><span>Конец смены</span><input type="time" value="${esc(s.end)}" data-setting="end"></label>
      </div>
      <p class="hint">Ставка действует для всех дней. Начало и конец смены подставляются в новые дни, в любом дне их можно изменить.</p>
    </div>

    <div class="card">
      <h2>Доп. задачи</h2>
      <p class="hint">Задайте задачи и цены здесь — в дне вы выбираете их из списка и указываете время выполнения.</p>
      ${taskRows || '<p class="hint">Задач пока нет.</p>'}
      <div class="set-task" style="margin-top:12px">
        <input type="text" id="newTaskName" placeholder="Название" aria-label="Название новой задачи">
        <input type="number" id="newTaskPrice" inputmode="decimal" step="any" min="0" placeholder="Цена" aria-label="Цена новой задачи">
        <button class="icon-btn add" data-action="add-task" aria-label="Добавить">＋</button>
      </div>
    </div>

    <div class="card">
      <h2>Периоды выплат</h2>
      <div class="inline">Выплаты <input type="number" inputmode="numeric" min="1" max="27" value="${s.payDayA}" data-setting="payDayA"> и <input type="number" inputmode="numeric" min="1" max="27" value="${s.payDayB}" data-setting="payDayB"> числа</div>
      <p class="hint">${payHint()}</p>
    </div>

    <div class="card">
      <h2>Данные</h2>
      <p class="hint">Данные хранятся только на этом телефоне, внутри приложения. Периодически сохраняйте копию: она откроется в меню «Поделиться», оттуда её можно сохранить в «Файлы» или на Диск либо отправить себе в мессенджер. Если удалить приложение, очистить его данные или сменить телефон, без копии всё пропадёт.</p>
      <div class="btn-row">
        <button class="btn small" data-action="export">Сохранить копию</button>
        <button class="btn small" data-action="import">Загрузить копию</button>
        <button class="btn small danger" data-action="reset">Стереть всё</button>
      </div>
    </div>`;
}

/* ---------- Окно дня ---------- */

function openDay(ds) {
  const ex = db.days[ds];
  const s = db.settings;
  const saved = ex ? ex.tasks || [] : [];
  // mins — время выполнения всей строки задачи, вводится в дне
  const items = db.tasks.map(t => {
    const f = saved.find(x => x.id === t.id);
    if (f) return Object.assign({}, f, { mins: Number(f.mins) || 0 });
    return { id: t.id, name: t.name, price: Number(t.price) || 0, qty: 0, mins: 0 };
  });
  for (const x of saved) {
    if (!db.tasks.some(t => t.id === x.id)) {
      items.push(Object.assign({ legacy: true }, x, { mins: Number(x.mins) || 0 }));
    }
  }
  state.edit = {
    ds,
    isNew: !ex,
    start: ex ? ex.start : s.start,
    end: ex ? ex.end : s.end,
    note: ex ? ex.note || '' : '',
    items
  };
  renderSheet();
}

function renderSheet() {
  const e = state.edit;
  const rows = e.items.map(i => `
    <div class="task ${i.qty > 0 ? 'on' : ''}" data-row="${i.id}">
      <div class="info">
        <div class="name">${esc(i.name)}${i.legacy ? ' <em>(удалена из списка)</em>' : ''}</div>
        <div class="price">${money(i.price)}</div>
        <label class="mins" data-minsrow="${i.id}"${i.qty > 0 ? '' : ' hidden'}>
          <span>Время, мин</span>
          <input type="number" inputmode="numeric" min="0" step="5" value="${i.mins}" data-mins="${i.id}">
        </label>
      </div>
      <div class="stepper">
        <button data-action="qty" data-id="${i.id}" data-delta="-1" aria-label="Меньше">−</button>
        <span class="qty" data-qty="${i.id}">${i.qty}</span>
        <button data-action="qty" data-id="${i.id}" data-delta="1" aria-label="Больше">+</button>
      </div>
    </div>`).join('');

  $('sheetRoot').innerHTML = `
    <div class="backdrop" data-action="close-sheet"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="День">
      <div class="sheet-head">
        <h2>${esc(fmtDateLong(e.ds))}</h2>
        <button class="icon-btn" data-action="close-sheet" aria-label="Закрыть">✕</button>
      </div>

      <div class="grid2">
        <label class="field"><span>Начало</span><input type="time" value="${esc(e.start || '')}" data-edit="start"></label>
        <label class="field"><span>Конец</span><input type="time" value="${esc(e.end || '')}" data-edit="end"></label>
      </div>
      <div class="calc">
        <div><span>Смена</span><b id="shiftTime"></b></div>
        <div id="taskTimeRow"><span>Минус время доп. задач</span><b id="taskTime"></b></div>
        <div><span id="hoursLine"></span><b id="hoursPay"></b></div>
        <div><span>Доп. задачи</span><b id="tasksPay"></b></div>
      </div>
      <p class="hint" id="timeWarn" hidden>Время задач больше смены, поэтому по ставке ничего не начисляется.</p>

      <h3 style="margin-top:14px">Доп. задачи</h3>
      ${rows || `<p class="hint">Список пуст. <a href="#" data-action="goto-settings">Добавьте задачи в настройках</a>.</p>`}

      <label class="field" style="margin-top:12px"><span>Заметка</span><textarea data-edit="note" placeholder="Адрес, что делал…">${esc(e.note)}</textarea></label>

      <div class="totalbar"><span>Итого за день</span><b id="dayTotal"></b></div>
      <div class="actions">
        ${e.isNew ? '' : '<button class="btn danger" data-action="delete-day">Удалить</button>'}
        <button class="btn primary" data-action="save-day">Сохранить</button>
      </div>
    </section>`;
  document.body.classList.add('lock');
  updateSheetTotals();
}

function updateSheetTotals() {
  const e = state.edit;
  if (!e) return;
  const min = workMinutes(e.start, e.end);
  const taskMin = e.items.reduce((s, i) => s + (i.qty > 0 ? i.mins : 0), 0);
  const paidMin = Math.max(0, min - taskMin);
  const rate = Number(db.settings.rate) || 0;
  const hoursPay = (paidMin / 60) * rate;
  const tasksPay = e.items.reduce((s, i) => s + i.price * i.qty, 0);
  $('shiftTime').textContent = fmtHuman(min);
  $('taskTimeRow').hidden = taskMin === 0;
  $('taskTime').textContent = '− ' + fmtHuman(taskMin);
  $('timeWarn').hidden = taskMin <= min;
  $('hoursLine').textContent = `${fmtHuman(paidMin)} × ${money(rate)}/ч`;
  $('hoursPay').textContent = money(hoursPay);
  $('tasksPay').textContent = money(tasksPay);
  $('dayTotal').textContent = money(hoursPay + tasksPay);
}

function closeSheet() {
  $('sheetRoot').innerHTML = '';
  document.body.classList.remove('lock');
  state.edit = null;
}

function saveDay() {
  const e = state.edit;
  db.days[e.ds] = {
    start: e.start || '',
    end: e.end || '',
    note: (e.note || '').trim(),
    tasks: e.items.filter(i => i.qty > 0).map(i => ({
      id: i.id, name: i.name, price: i.price, qty: i.qty, mins: Math.max(0, Math.round(Number(i.mins) || 0))
    }))
  };
  save();
  closeSheet();
  render();
}

/* ---------- События ---------- */

$('tabs').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (t.tagName === 'A') ev.preventDefault();

  switch (a) {
    case 'prev-month':
      state.cursor.m--; if (state.cursor.m < 0) { state.cursor.m = 11; state.cursor.y--; }
      render(); break;
    case 'next-month':
      state.cursor.m++; if (state.cursor.m > 11) { state.cursor.m = 0; state.cursor.y++; }
      render(); break;
    case 'today': {
      const d = new Date();
      state.cursor = { y: d.getFullYear(), m: d.getMonth() };
      render(); break;
    }
    case 'open-day': openDay(t.dataset.date); break;
    case 'close-sheet': closeSheet(); break;
    case 'save-day': saveDay(); break;
    case 'delete-day':
      if (confirm('Удалить этот день?')) {
        delete db.days[state.edit.ds];
        save(); closeSheet(); render();
      }
      break;
    case 'qty': {
      const item = state.edit.items.find(i => i.id === t.dataset.id);
      if (!item) break;
      item.qty = Math.min(99, Math.max(0, item.qty + Number(t.dataset.delta)));
      if (item.qty === 0) item.mins = 0;
      const q = document.querySelector(`[data-qty="${item.id}"]`);
      if (q) q.textContent = item.qty;
      const mi = document.querySelector(`[data-mins="${item.id}"]`);
      if (mi) mi.value = item.mins;
      const mr = document.querySelector(`[data-minsrow="${item.id}"]`);
      if (mr) mr.hidden = item.qty === 0;
      const row = document.querySelector(`[data-row="${item.id}"]`);
      if (row) row.classList.toggle('on', item.qty > 0);
      updateSheetTotals();
      break;
    }
    case 'goto-settings':
      closeSheet(); state.tab = 'settings'; render(); window.scrollTo(0, 0); break;
    case 'toggle-paid':
      if (db.paid[t.dataset.from]) delete db.paid[t.dataset.from]; else db.paid[t.dataset.from] = true;
      save(); render(); break;
    case 'add-task': {
      const name = $('newTaskName').value.trim();
      const price = Number($('newTaskPrice').value);
      if (!name) { toast('Введите название задачи'); break; }
      db.tasks.push({ id: uid(), name, price: price > 0 ? price : 0 });
      save(); render(); break;
    }
    case 'del-task':
      if (confirm('Удалить задачу из списка? В уже сохранённых днях она останется.')) {
        db.tasks = db.tasks.filter(x => x.id !== t.dataset.id);
        save(); render();
      }
      break;
    case 'export': exportData(); break;
    case 'import': $('importFile').click(); break;
    case 'reset':
      if (confirm('Стереть все дни, задачи и настройки? Это нельзя отменить.')) {
        db = defaults(); save(); render(); toast('Данные стёрты');
      }
      break;
  }
});

document.addEventListener('input', ev => {
  const d = ev.target.dataset;
  if (!d || !state.edit) return;
  if (d.edit) {
    state.edit[d.edit] = ev.target.value;
    updateSheetTotals();
  } else if (d.mins) {
    const item = state.edit.items.find(i => i.id === d.mins);
    if (!item) return;
    item.mins = Math.max(0, Math.round(Number(ev.target.value) || 0));
    updateSheetTotals();
  }
});

document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.dataset) return;

  if (el.dataset.setting) {
    const key = el.dataset.setting;
    const s = db.settings;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
    if (key === 'start' || key === 'end') s[key] = el.value || s[key];
    else if (key === 'rate') s.rate = Math.max(0, Number(el.value) || 0);
    else if (key === 'payDayA' || key === 'payDayB') {
      const v = clamp(el.value, 1, 27);
      const other = key === 'payDayA' ? s.payDayB : s.payDayA;
      if (v === other) toast('Дни выплат должны отличаться');
      else s[key] = v;
    }
    save();
    if (key === 'payDayA' || key === 'payDayB') render();
    return;
  }

  if (el.dataset.taskField) {
    const task = db.tasks.find(x => x.id === el.dataset.id);
    if (!task) return;
    if (el.dataset.taskField === 'name') {
      const v = el.value.trim();
      if (v) task.name = v; else el.value = task.name;
    } else {
      task.price = Math.max(0, Number(el.value) || 0);
    }
    save();
  }
});

$('importFile').addEventListener('change', ev => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.days) throw new Error('bad');
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      db = normalize(data);
      save(); render(); toast('Данные загружены');
    } catch (e) {
      toast('Не удалось прочитать файл');
    }
  };
  reader.readAsText(file);
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && state.edit) closeSheet();
});

// Плагины Capacitor (в приложении). В обычном браузере их нет, и работает запасной вариант.
function nativePlugin(name) {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null);
}

async function exportData() {
  const name = `worklog-${todayStr()}.json`;
  const text = JSON.stringify(db, null, 2);
  const Files = nativePlugin('Filesystem');
  const Share = nativePlugin('Share');

  if (Files && Share) {
    try {
      const file = await Files.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: 'Копия данных «Рабочий график»', files: [file.uri] });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/cancel/i.test(msg)) toast('Не удалось сохранить копию');
    }
    return;
  }

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Запуск ---------- */

render();

// Кнопка «Назад» на телефоне: закрыть окно дня, вернуться в календарь, а на календаре выйти.
const AppPlugin = nativePlugin('App');
if (AppPlugin && AppPlugin.addListener) {
  AppPlugin.addListener('backButton', () => {
    if (state.edit) closeSheet();
    else if (state.tab !== 'calendar') { state.tab = 'calendar'; render(); window.scrollTo(0, 0); }
    else AppPlugin.exitApp();
  });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
