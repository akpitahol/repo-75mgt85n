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
  let vrow = 0;       // 可视行号（忽略过道，1..12），用于框选
  for (const def of ROW_DEFS) {
    if (def.type === 'aisle') {
      displayRow += 0.6; // 过道带来纵向间隔
      continue;
    }
    displayRow += 1;
    vrow += 1;
    if (def.type === 'full') {
      // 左区 座号 18,17,16,15
      LEFT_COLS.forEach((col, i) => seats.push(makeSeat(def, 18 - i, col, displayRow, vrow)));
      // 中区 座号 14..5
      MID_COLS.forEach((col, i) => seats.push(makeSeat(def, 14 - i, col, displayRow, vrow)));
      // 右区 座号 4,3,2,1
      RIGHT_COLS.forEach((col, i) => seats.push(makeSeat(def, 4 - i, col, displayRow, vrow)));
    } else if (def.type === 'mid') {
      // 第一排：中间 10 座，座号 10..1
      MID_COLS.forEach((col, i) => seats.push(makeSeat(def, 10 - i, col, displayRow, vrow)));
    }
  }
  return seats;
}

function makeSeat(def, seatNo, col, displayRow, vrow) {
  return {
    id: `${def.rno}-${seatNo}`,
    rowName: def.name,
    rno: def.rno,
    seatNo,
    col,            // 网格列 (1-22)
    vrow,           // 可视行号 (1-12)
    x: col,         // 距离计算横坐标
    y: displayRow,  // 距离计算纵坐标
    label: null,
    name: null,
    el: null,
  };
}

function getSeatById(id) {
  return seats.find((s) => s.id === id) || null;
}

// ---- 全局状态 ----
const STORAGE_KEY = 'library-seating-v1';
let seats = buildSeats();
// labels: { [labelName]: { color } }，按添加顺序用于稳定配色
const labels = {};
let hueCursor = Math.random() * 360; // 随机起始色相

// ---- 交互状态 ----
let regionMode = false;            // 手动选区模式
const selection = new Set();       // 已选座位 id 集合
let dragSrcId = null;              // 拖拽移动的源座位 id
let selDownId = null;              // 框选起点座位 id
let selDragging = false;           // 是否正在框选
let selMoved = false;              // 框选过程中是否移动到其它座位

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

// ---- 文字自适应（保证姓名一行完整显示）----
const FONT_FAMILY = '-apple-system, "Segoe UI", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif';
const _measCtx = document.createElement('canvas').getContext('2d');
function fitFontSize(text, maxWidth, maxFont, minFont) {
  for (let fs = maxFont; fs >= minFont; fs--) {
    _measCtx.font = `600 ${fs}px ${FONT_FAMILY}`;
    if (_measCtx.measureText(text).width <= maxWidth) return fs;
  }
  return minFont;
}

// ---- 姓名解析 ----
function parseNames(raw) {
  return raw
    .split(/[\s,，、;；]+/)
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
    // 新标签：从最靠前（主台方向，即第一排）的空位开始，从前往后排座
    free.sort((a, b) => (b.y - a.y) || (a.x - b.x));
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
      // 轻微偏好靠前（主台方向）、靠左，作为平局打破
      d = d - f.y * 0.001 + f.x * 0.0001;
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
      el.className = 'seat' + (s.name ? ' occupied' : '') + (selection.has(s.id) ? ' selected' : '');
      el.style.gridColumn = String(s.col + 1); // +1 因为第 1 列是行号
      el.dataset.seatId = s.id;
      // 普通模式下，已占用座位可拖拽移动
      el.draggable = !regionMode && !!s.name;
      if (s.name) {
        el.style.background = labels[s.label].color;
        el.title = `${def.name} ${s.seatNo}号 · ${s.label} · ${s.name}（拖动可移动/交换，双击移除）`;
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = s.name;
        // 自适应字号，保证姓名一行完整显示（座位内可用宽约 54px）
        nm.style.fontSize = fitFontSize(s.name, 54, 15, 9) + 'px';
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
    sw.title = '点击更换颜色';
    sw.addEventListener('click', () => recolorLabel(name));

    const nm = document.createElement('span');
    nm.className = 'lg-name';
    nm.textContent = name;
    nm.title = '双击重命名标签';
    nm.addEventListener('dblclick', () => beginRename(name, nm));

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

// 标签换色
function recolorLabel(name) {
  if (!labels[name]) return;
  labels[name].color = nextColor();
  render();
}

// 标签重命名（若与已有标签同名则合并）
function applyRename(oldName, rawName) {
  const newName = (rawName || '').trim();
  if (!newName || newName === oldName || !labels[oldName]) return;
  if (labels[newName]) {
    // 合并到已有标签：座位归入新标签，保留新标签颜色
    for (const s of seats) if (s.label === oldName) s.label = newName;
    delete labels[oldName];
  } else {
    labels[newName] = labels[oldName];
    delete labels[oldName];
    for (const s of seats) if (s.label === oldName) s.label = newName;
  }
  render();
}

// 内联重命名（不弹窗，避免阻塞）
function beginRename(oldName, nmEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lg-rename';
  input.value = oldName;
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    applyRename(oldName, input.value);
    if (labels[oldName]) render(); // 名称未变化时也重渲染还原
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { done = true; render(); }
  });
  input.addEventListener('blur', commit);
  nmEl.replaceWith(input);
  input.focus();
  input.select();
}

// 移除单个座位上的人
function clearSeat(id) {
  const s = getSeatById(id);
  if (!s || !s.name) return;
  const label = s.label;
  s.label = null;
  s.name = null;
  // 若该标签已无人，移除标签
  if (label && !seats.some((x) => x.label === label && x.name)) delete labels[label];
  render();
}

// ---- 拖拽移动 / 交换 ----
function onSeatDragStart(e) {
  const el = e.target.closest('.seat');
  if (!el || regionMode) return;
  const s = getSeatById(el.dataset.seatId);
  if (!s || !s.name) return;
  dragSrcId = s.id;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', s.id); } catch (err) { /* ignore */ }
}

function onSeatDragOver(e) {
  if (regionMode || !dragSrcId) return;
  const el = e.target.closest('.seat');
  if (!el) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  el.classList.add('drop-target');
}

function onSeatDragLeave(e) {
  const el = e.target.closest('.seat');
  if (el) el.classList.remove('drop-target');
}

function onSeatDrop(e) {
  if (regionMode || !dragSrcId) return;
  const el = e.target.closest('.seat');
  if (!el) return;
  e.preventDefault();
  el.classList.remove('drop-target');
  const src = getSeatById(dragSrcId);
  const dst = getSeatById(el.dataset.seatId);
  dragSrcId = null;
  if (!src || !dst || src === dst) return;
  // 移动 / 交换（标签与姓名一并搬移）
  const tmp = { label: dst.label, name: dst.name };
  dst.label = src.label;
  dst.name = src.name;
  if (tmp.name) {
    src.label = tmp.label;
    src.name = tmp.name;
  } else {
    src.label = null;
    src.name = null;
  }
  render();
}

// ---- 手动选区（框选）----
function setRegionMode(on) {
  regionMode = on;
  if (!on) selection.clear();
  document.getElementById('selInfo').hidden = !on;
  document.body.classList.toggle('region-mode', on);
  render();
  updateSelInfo();
}

function boxBetween(aId, bId) {
  const a = getSeatById(aId);
  const b = getSeatById(bId);
  if (!a || !b) return [];
  const minV = Math.min(a.vrow, b.vrow), maxV = Math.max(a.vrow, b.vrow);
  const minC = Math.min(a.col, b.col), maxC = Math.max(a.col, b.col);
  return seats.filter((s) => s.vrow >= minV && s.vrow <= maxV && s.col >= minC && s.col <= maxC);
}

function applySelectionClasses() {
  for (const s of seats) {
    if (s.el) s.el.classList.toggle('selected', selection.has(s.id));
  }
}

function updateSelInfo() {
  const el = document.getElementById('selCount');
  if (el) el.textContent = String(selection.size);
}

function onSeatMouseDown(e) {
  if (!regionMode) return;
  const el = e.target.closest('.seat');
  if (!el) return;
  e.preventDefault(); // 避免选中文字
  selDownId = el.dataset.seatId;
  selDragging = true;
  selMoved = false;
}

function onSeatMouseOver(e) {
  if (!regionMode || !selDragging) return;
  const el = e.target.closest('.seat');
  if (!el) return;
  const curId = el.dataset.seatId;
  if (curId !== selDownId) selMoved = true;
  // 拖动框选：实时把矩形范围设为当前选区
  selection.clear();
  for (const s of boxBetween(selDownId, curId)) selection.add(s.id);
  applySelectionClasses();
  updateSelInfo();
}

function onDocMouseUp() {
  if (!regionMode || !selDragging) return;
  selDragging = false;
  if (!selMoved && selDownId) {
    // 单击：切换该座位的选中状态
    if (selection.has(selDownId)) selection.delete(selDownId);
    else selection.add(selDownId);
    applySelectionClasses();
    updateSelInfo();
  }
  selDownId = null;
}

function clearSelection() {
  selection.clear();
  applySelectionClasses();
  updateSelInfo();
}

// 把一批人排到当前选区（按从上到下、从左到右顺序填入空位）
function assignToSelection(labelName, names) {
  ensureLabel(labelName);
  const selSeats = seats
    .filter((s) => selection.has(s.id))
    .sort((a, b) => (b.vrow - a.vrow) || (b.col - a.col)); // 从最下面一排往上、每排从右往左
  let placed = 0;
  for (const s of selSeats) {
    if (placed >= names.length) break;
    if (s.name) continue; // 跳过已占用
    s.label = labelName;
    s.name = names[placed];
    placed += 1;
  }
  return { placed, overflow: names.length - placed };
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

  const useSelection = regionMode && selection.size > 0;
  const { placed, overflow } = useSelection
    ? assignToSelection(labelName, names)
    : addGroup(labelName, names);
  if (useSelection) clearSelection();
  render();
  const labelEl = document.getElementById('labelInput');
  labelEl.value = '';
  document.getElementById('namesInput').value = '';
  labelEl.focus();

  const where = useSelection ? '到选中区域' : '';
  if (overflow > 0) {
    const reason = useSelection ? '选区空位不足' : '座位已满';
    setStatus(`已为「${labelName}」安排 ${placed} 人${where}；${reason}，还有 ${overflow} 人未排座。`, 'err');
  } else {
    setStatus(`已为「${labelName}」安排 ${placed} 人${where}。`, 'ok');
  }
}

// ---- 导出图片（纯 Canvas，离线可用）----
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function exportImage() {
  const SEAT_W = 58, SEAT_H = 38, GAP = 6, LABEL_W = 78, COLS = 22, PAD = 28, SCALE = 2;
  const contentW = LABEL_W + COLS * (SEAT_W + GAP);
  const W = PAD * 2 + contentW;

  const ctx = _measCtx;
  // --- 图例分行预计算 ---
  const labelNames = Object.keys(labels);
  const SW = 18, ITEM_PAD = 12, ITEM_GAP = 10, ITEM_H = 30;
  const legendItems = labelNames.map((name) => {
    const count = seats.filter((s) => s.label === name && s.name).length;
    const text = `${name}  ${count}人`;
    ctx.font = `600 14px ${FONT_FAMILY}`;
    const tw = ctx.measureText(text).width;
    return { name, text, w: ITEM_PAD + SW + 8 + tw + ITEM_PAD };
  });
  const legendLines = [];
  let line = [], lineW = 0;
  for (const it of legendItems) {
    if (lineW + it.w > contentW && line.length) {
      legendLines.push(line); line = []; lineW = 0;
    }
    line.push(it); lineW += it.w + ITEM_GAP;
  }
  if (line.length) legendLines.push(line);

  // --- 纵向布局 ---
  let y = PAD;
  const titleY = y; y += 34;        // 标题
  const subY = y; y += 24;          // 副标题
  const legendY = y;
  const legendH = legendLines.length * (ITEM_H + 8);
  y += legendLines.length ? legendH + 10 : 0;
  const gridTop = y;
  // 计算每排 y
  const rowPlan = [];
  for (const def of ROW_DEFS) {
    if (def.type === 'aisle') { y += 16; continue; }
    rowPlan.push({ def, y });
    y += SEAT_H + GAP;
  }
  const gridBottom = y + 6;
  const stageY = gridBottom + 14;
  const stageH = 40;
  const H = stageY + stageH + PAD;

  // --- 画布 ---
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const c = canvas.getContext('2d');
  c.scale(SCALE, SCALE);
  c.textBaseline = 'middle';

  // 背景
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);

  // 标题
  c.fillStyle = '#1f2733';
  c.font = `700 22px ${FONT_FAMILY}`;
  c.textAlign = 'left';
  c.fillText('图书馆座位排列工具', PAD, titleY + 16);
  const occupied = seats.filter((s) => s.name).length;
  c.fillStyle = '#6b7585';
  c.font = `400 13px ${FONT_FAMILY}`;
  c.fillText(`共 ${seats.length} 个座位 · 已坐 ${occupied} 人`, PAD, subY + 12);

  // 图例
  legendLines.forEach((ln, li) => {
    let x = PAD;
    const ly = legendY + li * (ITEM_H + 8);
    for (const it of ln) {
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#e2e6ef';
      c.lineWidth = 1;
      roundRect(c, x, ly, it.w, ITEM_H, 8);
      c.fill(); c.stroke();
      c.fillStyle = labels[it.name].color;
      roundRect(c, x + ITEM_PAD, ly + (ITEM_H - SW) / 2, SW, SW, 5);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      c.stroke();
      c.fillStyle = '#1f2733';
      c.font = `600 14px ${FONT_FAMILY}`;
      c.fillText(it.text, x + ITEM_PAD + SW + 8, ly + ITEM_H / 2);
      x += it.w + ITEM_GAP;
    }
  });

  // 座位
  for (const { def, y: ry } of rowPlan) {
    // 行号
    c.fillStyle = '#6b7585';
    c.font = `400 13px ${FONT_FAMILY}`;
    c.textAlign = 'right';
    c.fillText(def.name, PAD + LABEL_W - 8, ry + SEAT_H / 2);
    c.textAlign = 'left';

    const rowSeats = seats.filter((s) => s.rno === def.rno);
    for (const s of rowSeats) {
      const x = PAD + LABEL_W + (s.col - 1) * (SEAT_W + GAP);
      const filled = !!s.name;
      c.fillStyle = filled ? labels[s.label].color : '#eef1f7';
      c.strokeStyle = filled ? 'rgba(0,0,0,0.12)' : '#d6dbe6';
      c.lineWidth = 1;
      roundRect(c, x, ry, SEAT_W, SEAT_H, 6);
      c.fill(); c.stroke();
      c.textAlign = 'center';
      if (filled) {
        c.fillStyle = '#1f2733';
        const fs = fitFontSize(s.name, SEAT_W - 6, 16, 9);
        c.font = `600 ${fs}px ${FONT_FAMILY}`;
        c.fillText(s.name, x + SEAT_W / 2, ry + SEAT_H / 2);
      } else {
        c.fillStyle = '#9aa3b2';
        c.font = `400 11px ${FONT_FAMILY}`;
        c.fillText(String(s.seatNo), x + SEAT_W / 2, ry + SEAT_H / 2);
      }
      c.textAlign = 'left';
    }
  }

  // 主台
  const stageW = 360;
  const stageX = PAD + LABEL_W + (contentW - LABEL_W - stageW) / 2;
  c.fillStyle = '#2f3a4d';
  roundRect(c, stageX, stageY, stageW, stageH, 8);
  c.fill();
  c.fillStyle = '#ffffff';
  c.font = `600 15px ${FONT_FAMILY}`;
  c.textAlign = 'center';
  c.fillText('主    台', stageX + stageW / 2, stageY + stageH / 2);
  c.textAlign = 'left';

  // 下载
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = '座位表.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setStatus('已导出座位表图片。', 'ok');
}

function onClear() {
  if (!confirm('确定清空全部座位与标签吗？')) return;
  seats = buildSeats();
  for (const k of Object.keys(labels)) delete labels[k];
  hueCursor = Math.random() * 360;
  selection.clear();
  render();
  setStatus('已清空。', 'ok');
}

function onSeatDblClick(e) {
  const el = e.target.closest('.seat');
  if (!el) return;
  const s = getSeatById(el.dataset.seatId);
  if (s && s.name) {
    const nm = s.name;
    clearSeat(s.id);
    setStatus(`已移除「${nm}」。`, 'ok');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  render();
  document.getElementById('addBtn').addEventListener('click', onAdd);
  document.getElementById('clearBtn').addEventListener('click', onClear);
  document.getElementById('exportBtn').addEventListener('click', exportImage);

  const regionChk = document.getElementById('regionMode');
  regionChk.addEventListener('change', () => setRegionMode(regionChk.checked));
  document.getElementById('clearSelBtn').addEventListener('click', clearSelection);

  // 事件委托：座位图上的拖拽移动与框选
  const map = document.getElementById('seatmap');
  map.addEventListener('dragstart', onSeatDragStart);
  map.addEventListener('dragover', onSeatDragOver);
  map.addEventListener('dragleave', onSeatDragLeave);
  map.addEventListener('drop', onSeatDrop);
  map.addEventListener('mousedown', onSeatMouseDown);
  map.addEventListener('mouseover', onSeatMouseOver);
  map.addEventListener('dblclick', onSeatDblClick);
  document.addEventListener('mouseup', onDocMouseUp);
});
