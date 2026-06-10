/* 图书馆座位排列工具
 * 座位布局来源于用户提供的座位表（共 208 个座位）：
 *   第十二排 ~ 第二排：每排 18 座（左 4 / 中 10 / 右 4，两侧各有一条过道）
 *   第六排与第五排之间有一条横向过道
 *   第一排（最靠近主台）：仅中间 10 座
 * 座位编号：靠右为 1，靠左为 18（与原表一致）。
 */

// ---- 座位布局定义 ----
// 网格共 22 列：左区 1-4，过道 5-6，中区 7-16，过道 17-18，右区 19-22。
const LEFT_COLS = [1, 2, 3, 4];        // 座号 18,17,16,15
const MID_COLS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; // 座号 14..5
const RIGHT_COLS = [19, 20, 21, 22];   // 座号 4,3,2,1

// 从上（最后排）到下（最前排，靠主台）的显示顺序。
const ROW_DEFS = [
  { name: '第十二排', rno: 12, type: 'full' },
  { name: '第十一排', rno: 11, type: 'full' },
  { name: '第十排', rno: 10, type: 'full' },
  { name: '第九排', rno: 9, type: 'full' },
  { name: '第八排', rno: 8, type: 'full' },
  { name: '第七排', rno: 7, type: 'full' },
  { name: '第六排', rno: 6, type: 'full' },
  { name: '', rno: 0, type: 'aisle' },
  { name: '第五排', rno: 5, type: 'full' },
  { name: '第四排', rno: 4, type: 'full' },
  { name: '第三排', rno: 3, type: 'full' },
  { name: '第二排', rno: 2, type: 'full' },
  { name: '第一排', rno: 1, type: 'mid' },
];

// 构建所有座位对象
function buildSeats() {
  const seats = [];
  let displayRow = 0; // 用于二维距离计算的纵坐标（含过道占位）
  for (const def of ROW_DEFS) {
    if (def.type === 'aisle') {
      displayRow += 0.6; // 过道带来纵向间隔
      continue;
    }
    displayRow += 1;
    if (def.type === 'full') {
      // 左区 座号 18,17,16,15
      LEFT_COLS.forEach((col, i) => seats.push(makeSeat(def, 18 - i, col, displayRow)));
      // 中区 座号 14..5
      MID_COLS.forEach((col, i) => seats.push(makeSeat(def, 14 - i, col, displayRow)));
      // 右区 座号 4,3,2,1
      RIGHT_COLS.forEach((col, i) => seats.push(makeSeat(def, 4 - i, col, displayRow)));
    } else if (def.type === 'mid') {
      // 第一排：中间 10 座，座号 10..1
      MID_COLS.forEach((col, i) => seats.push(makeSeat(def, 10 - i, col, displayRow)));
    }
  }
  return seats;
}

function makeSeat(def, seatNo, col, displayRow) {
  return {
    id: `${def.rno}-${seatNo}`,
    rowName: def.name,
    rno: def.rno,
    seatNo,
    col,            // 网格列 (1-22)
    x: col,         // 距离计算横坐标
    y: displayRow,  // 距离计算纵坐标
    label: null,
    name: null,
    el: null,
  };
}

// ---- 全局状态 ----
const STORAGE_KEY = 'library-seating-v1';
let seats = buildSeats();
// labels: { [labelName]: { color } }，按添加顺序用于稳定配色
const labels = {};
let hueCursor = Math.random() * 360; // 随机起始色相

// ---- 颜色 ----
const GOLDEN_ANGLE = 137.508;
function nextColor() {
  hueCursor = (hueCursor + GOLDEN_ANGLE) % 360;
  // 柔和底色，深色文字可读
  return `hsl(${Math.round(hueCursor)}, 70%, 84%)`;
}

function ensureLabel(name) {
  if (!labels[name]) {
    labels[name] = { color: nextColor() };
  }
  return labels[name];
}

// ---- 姓名解析 ----
function parseNames(raw) {
  return raw
    .split(/[\n\r,，、;；\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---- 座位分配（同标签聚集，尽量同一区域）----
function freeSeats() {
  return seats.filter((s) => !s.name);
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * 6; // 纵向权重更大，使同一片区域优先在相邻排
  return dx * dx + dy * dy;
}

// 为某标签分配 count 个座位：以该标签现有座位（或最靠前的空位）为锚点做区域生长
function assignSeats(labelName, count) {
  const assigned = [];
  let free = freeSeats();
  if (free.length === 0) return assigned;

  const existing = seats.filter((s) => s.label === labelName && s.name);
  // 选锚点
  let cluster;
  if (existing.length > 0) {
    cluster = existing.slice();
  } else {
    // 新标签：从最靠前（主台方向）、最靠右的空位开始，保证布局紧凑有序
    free.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    cluster = [free[0]];
    assigned.push(free[0]);
    free[0].name = '__reserved__'; // 占位，避免循环中被重复选中
  }

  while (assigned.length < count) {
    free = freeSeats();
    if (free.length === 0) break;
    // 选择距离当前簇最近的空位
    let best = null;
    let bestD = Infinity;
    for (const f of free) {
      let d = Infinity;
      for (const c of cluster) {
        const dd = dist2(f, c);
        if (dd < d) d = dd;
      }
      // 轻微偏好靠前、靠右，作为平局打破
      d = d + f.y * 0.001 + f.x * 0.0001;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) break;
    assigned.push(best);
    cluster.push(best);
    // 标记为占用，避免重复选择
    best._reserved = true;
    best.name = '__reserved__';
  }
  // 解除占位标记（真正赋值在调用处）
  for (const s of assigned) {
    if (s.name === '__reserved__') s.name = null;
  }
  return assigned;
}

// ---- 主操作：添加一批 ----
function addGroup(labelName, names) {
  ensureLabel(labelName);
  const free = freeSeats();
  const placeCount = Math.min(names.length, free.length);
  const targetSeats = assignSeats(labelName, placeCount);
  for (let i = 0; i < targetSeats.length; i++) {
    const s = targetSeats[i];
    s.label = labelName;
    s.name = names[i];
  }
  const overflow = names.length - targetSeats.length;
  return { placed: targetSeats.length, overflow };
}

// ---- 渲染 ----
function render() {
  renderSeatmap();
  renderLegend();
  renderStat();
  save();
}

function renderSeatmap() {
  const map = document.getElementById('seatmap');
  map.innerHTML = '';
  for (const def of ROW_DEFS) {
    if (def.type === 'aisle') {
      const a = document.createElement('div');
      a.className = 'aisle-row';
      map.appendChild(a);
      continue;
    }
    // 行号
    const lbl = document.createElement('div');
    lbl.className = 'row-label';
    lbl.textContent = def.name;
    lbl.style.gridColumn = '1';
    map.appendChild(lbl);

    const rowSeats = seats.filter((s) => s.rno === def.rno);
    for (const s of rowSeats) {
      const el = document.createElement('div');
      el.className = 'seat' + (s.name ? ' occupied' : '');
      el.style.gridColumn = String(s.col + 1); // +1 因为第 1 列是行号
      el.dataset.seatId = s.id;
      if (s.name) {
        el.style.background = labels[s.label].color;
        el.title = `${def.name} ${s.seatNo}号 · ${s.label} · ${s.name}`;
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = s.name;
        el.appendChild(nm);
      } else {
        el.textContent = s.seatNo;
        el.title = `${def.name} ${s.seatNo}号（空）`;
      }
      s.el = el;
      map.appendChild(el);
    }
  }
}

function renderLegend() {
  const ul = document.getElementById('legend');
  ul.innerHTML = '';
  const order = Object.keys(labels);
  for (const name of order) {
    const count = seats.filter((s) => s.label === name && s.name).length;
    const li = document.createElement('li');

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = labels[name].color;

    const nm = document.createElement('span');
    nm.className = 'lg-name';
    nm.textContent = name;

    const ct = document.createElement('span');
    ct.className = 'lg-count';
    ct.textContent = `${count} 人`;

    const rm = document.createElement('button');
    rm.className = 'lg-remove';
    rm.textContent = '×';
    rm.title = '移除该标签的所有人';
    rm.addEventListener('click', () => removeLabel(name));

    // hover 高亮该标签座位
    li.addEventListener('mouseenter', () => highlightLabel(name, true));
    li.addEventListener('mouseleave', () => highlightLabel(name, false));

    li.append(sw, nm, ct, rm);
    ul.appendChild(li);
  }
}

function highlightLabel(name, on) {
  for (const s of seats) {
    if (s.el && s.label === name && s.name) {
      s.el.classList.toggle('highlight', on);
    }
  }
}

function renderStat() {
  const occupied = seats.filter((s) => s.name).length;
  document.getElementById('seatStat').textContent = `已坐 ${occupied} / ${seats.length}`;
}

function removeLabel(name) {
  for (const s of seats) {
    if (s.label === name) {
      s.label = null;
      s.name = null;
    }
  }
  delete labels[name];
  render();
}

// ---- 持久化 ----
function save() {
  const data = {
    hueCursor,
    labels,
    seats: seats
      .filter((s) => s.name)
      .map((s) => ({ id: s.id, label: s.label, name: s.name })),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    /* ignore */
  }
}

function load() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (e) {
    data = null;
  }
  if (!data) return;
  if (typeof data.hueCursor === 'number') hueCursor = data.hueCursor;
  if (data.labels) {
    for (const k of Object.keys(data.labels)) labels[k] = data.labels[k];
  }
  if (Array.isArray(data.seats)) {
    const byId = {};
    for (const s of seats) byId[s.id] = s;
    for (const rec of data.seats) {
      const s = byId[rec.id];
      if (s) {
        s.label = rec.label;
        s.name = rec.name;
      }
    }
  }
}

// ---- 事件绑定 ----
function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

function onAdd() {
  const labelName = document.getElementById('labelInput').value.trim();
  const namesRaw = document.getElementById('namesInput').value;
  const names = parseNames(namesRaw);
  if (!labelName) {
    setStatus('请先输入标签名称。', 'err');
    return;
  }
  if (names.length === 0) {
    setStatus('请粘贴至少一个姓名。', 'err');
    return;
  }
  const { placed, overflow } = addGroup(labelName, names);
  render();
  document.getElementById('namesInput').value = '';
  if (overflow > 0) {
    setStatus(`已为「${labelName}」安排 ${placed} 人；座位已满，还有 ${overflow} 人未排座。`, 'err');
  } else {
    setStatus(`已为「${labelName}」安排 ${placed} 人。`, 'ok');
  }
}

function onClear() {
  if (!confirm('确定清空全部座位与标签吗？')) return;
  seats = buildSeats();
  for (const k of Object.keys(labels)) delete labels[k];
  hueCursor = Math.random() * 360;
  render();
  setStatus('已清空。', 'ok');
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();
  document.getElementById('addBtn').addEventListener('click', onAdd);
  document.getElementById('clearBtn').addEventListener('click', onClear);
});
