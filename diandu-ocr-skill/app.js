// 点读课本 —— 正常模式 + 手动画点读区(编辑模式)

const LS_KEY = "diandu_regions_v1";
const BOOK_ID = (BOOK.pages[0] && BOOK.pages[0].img) || "book";

let cur = 0;
let audio = null;
let playingAll = false;
let allQueue = [];
let editMode = false;
let selected = null;            // 当前选中的编辑区域索引
let currentItems = [];          // 正常模式当前页的可点区域 [{audio,label,key}]
let rate = 1;                   // 播放语速
let coverOpen = false;          // 封面/引导 overlay 是否打开

// 英文归一化(去空格/标点/小写), 用于按文字查中文翻译
function normEn(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function cnFor(text) {
  const t = BOOK.translations;
  return (t && t[normEn(text)]) || null;
}

const wrap = document.getElementById("pagewrap");
const pageimg = document.getElementById("pageimg");
const pageinfo = document.getElementById("pageinfo");
const edPage = document.getElementById("edPage");
const regionText = document.getElementById("regionText");
const regionCn = document.getElementById("regionCn");
const regionList = document.getElementById("regionList");

/* ---------------- 编辑区域的本地存储 ---------------- */
let all = loadRegions();

function loadRegions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveRegions() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); }
  catch (e) { /* file:// 下可能被禁用，靠导出/导入兜底 */ }
}
// 确保当前书有 pages 槽位
function ensureBook() {
  if (!all[BOOK_ID]) all[BOOK_ID] = { pages: BOOK.pages.map(() => []) };
  const p = all[BOOK_ID].pages;
  while (p.length < BOOK.pages.length) p.push([]);
  return all[BOOK_ID];
}
function getEditRegions(i) { return ensureBook().pages[i] || []; }

/* ---------------- 播放 ---------------- */
function stopAll() {
  playingAll = false;
  if (audio) { audio.pause(); audio = null; }
}
function highlightKey(key) {
  document.querySelectorAll(".hit.active").forEach(e => e.classList.remove("active"));
  if (key != null)
    document.querySelectorAll('.hit[data-audio="' + cssEsc(key) + '"]')
      .forEach(e => e.classList.add("active"));
}
function cssEsc(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}
function playAudio(path) {
  if (!path) return;
  if (audio) audio.pause();
  audio = new Audio(path);
  audio.playbackRate = rate;
  audio.play().catch(e => console.warn("play failed", e));
}

/* ---------------- 渲染页面 ---------------- */
function renderPage() {
  const pg = BOOK.pages[cur];
  pageimg.src = pg.img;
  wrap.querySelectorAll(".hit").forEach(e => e.remove());
  wrap.querySelectorAll(".ero, #draw").forEach(e => e.remove());

  if (editMode) buildEditOverlay(pg);
  else buildNormalHits(pg);

  pageinfo.textContent = (cur + 1) + " / " + BOOK.pages.length;
  edPage.textContent = cur + 1;
}

/* 正常模式：优先用烘焙好的 regions，其次本地编辑预览，最后回退到自动分句 */
function buildNormalHits(pg) {
  currentItems = [];
  let items, withAudio = true;

  if (pg.regions && pg.regions.length) {
    const edit = getEditRegions(cur);
    const match = r => edit.find(e =>
      Math.abs(e.x - r.x) < 1e-3 && Math.abs(e.y - r.y) < 1e-3 &&
      Math.abs(e.w - r.w) < 1e-3 && Math.abs(e.h - r.h) < 1e-3);
    items = pg.regions.map(r => {
      let cn = r.cn;
      if (!cn) { const m = match(r); if (m) cn = m.cn; }   // 浏览器里新加的中文
      if (!cn) cn = cnFor(r.text);                          // 词典兜底
      return { audio: r.audio, label: r.text, key: r.audio || r.text, cn: cn };
    });
  } else {
    const edit = getEditRegions(cur);
    if (edit.length) {
      withAudio = false;
      items = edit.map((r, i) => ({ audio: null, label: r.text || "(空)", key: "edit-" + cur + "-" + i, cn: r.cn }));
    } else {
      items = pg.lines.map(l => {
        const a = pg.utts[l.u] && pg.utts[l.u].a;
        return { audio: a, label: l.t, key: a || ("u" + l.u), cn: l.cn || cnFor(l.t) };
      });
    }
  }

  items.forEach(it => {
    currentItems.push(it);
    const d = document.createElement("div");
    d.className = "hit";
    d.dataset.audio = it.key;
    d.style.left = (it._x != null ? it._x : 0) + "%";
    d.addEventListener("click", () => {
      stopAll();
      highlightKey(it.key);
      if (it.audio) playAudio(it.audio);
    });
    wrap.appendChild(d);
  });

  // 用真实坐标定位(编辑预览/烘焙 regions 有坐标；回退行用 lines 坐标)
  positionHits(pg, items, withAudio);
}

// 给每个 hit 设置 left/top/width/height
function positionHits(pg, items, withAudio) {
  let src; // 坐标来源数组，元素需有 x,y,w,h
  if (pg.regions && pg.regions.length) src = pg.regions;
  else if (getEditRegions(cur).length) src = getEditRegions(cur);
  else src = pg.lines;

  const hits = wrap.querySelectorAll(".hit");
  items.forEach((it, i) => {
    const b = src[i];
    if (!b) return;
    const el = hits[i];
    el.style.left = (b.x * 100) + "%";
    el.style.top = (b.y * 100) + "%";
    el.style.width = (b.w * 100) + "%";
    el.style.height = (b.h * 100) + "%";
    const showText = document.body.classList.contains("showtext");
    const showCn = document.body.classList.contains("showcn");
    if ((showText && it.label) || (showCn && it.cn)) {
      const t = document.createElement("span");
      t.className = "txt";
      if ((b.x + b.w / 2) > 0.5) { t.style.left = "auto"; t.style.right = "0"; }  // 右侧区域朝左展开
      else { t.style.left = "0"; t.style.right = "auto"; }
      if (showText) {
        const en = document.createElement("span");
        en.className = "en";
        en.textContent = it.label;
        t.appendChild(en);
      }
      if (showCn && it.cn) {
        const cn = document.createElement("span");
        cn.className = "cn";
        cn.textContent = it.cn;
        t.appendChild(cn);
      }
      el.appendChild(t);
    }
  });
}

/* ---------------- 编辑模式 ---------------- */
function buildEditOverlay(pg) {
  const draw = document.createElement("div");
  draw.id = "draw";
  wrap.appendChild(draw);

  // 已有区域
  const regs = getEditRegions(cur);
  regs.forEach((r, i) => draw.appendChild(makeEro(r, i)));

  // 拖拽画框
  let start = null, draft = null;
  draw.addEventListener("pointerdown", e => {
    if (e.target !== draw) return;       // 只从空白区起笔
    e.preventDefault();
    const p = pt(e, draw);
    start = p;
    draft = document.createElement("div");
    draft.className = "ero draft";
    draft.style.left = (p.x * 100) + "%";
    draft.style.top = (p.y * 100) + "%";
    draft.style.width = "0%";
    draft.style.height = "0%";
    draw.appendChild(draft);
    draw.setPointerCapture(e.pointerId);
  });
  draw.addEventListener("pointermove", e => {
    if (!start) return;
    const p = pt(e, draw);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    draft.style.left = (x * 100) + "%";
    draft.style.top = (y * 100) + "%";
    draft.style.width = (w * 100) + "%";
    draft.style.height = (h * 100) + "%";
  });
  draw.addEventListener("pointerup", e => {
    if (!start) return;
    const p = pt(e, draw);
    const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    start = null;
    if (draft) { draft.remove(); draft = null; }
    if (w < 0.01 || h < 0.01) return;    // 太小忽略
    const t = textInside(pg, x, y, w, h);
    addRegion({ x, y, w, h, text: t, cn: cnFor(t) });
  });

  refreshList();
}

function pt(e, el) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

// 收集落在框内的 OCR 行文字
function textInside(pg, x, y, w, h) {
  const inside = pg.lines.filter(l => {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  });
  inside.sort((a, b) => a.y - b.y || a.x - b.x);
  return inside.map(l => l.t).join(" ");
}

function makeEro(r, i) {
  const d = document.createElement("div");
  d.className = "ero" + (selected === i ? " sel" : "");
  d.dataset.idx = i;
  d.style.left = (r.x * 100) + "%";
  d.style.top = (r.y * 100) + "%";
  d.style.width = (r.w * 100) + "%";
  d.style.height = (r.h * 100) + "%";
  d.addEventListener("click", ev => { ev.stopPropagation(); selectRegion(i); });
  return d;
}

function addRegion(r) {
  const regs = getEditRegions(cur);
  regs.push(r);
  saveRegions();
  selected = regs.length - 1;
  renderPage();
  selectRegion(selected);
}
function selectRegion(i) {
  selected = i;
  const r = getEditRegions(cur)[i];
  regionText.value = r ? (r.text || "") : "";
  regionCn.value = r ? (r.cn || "") : "";
  wrap.querySelectorAll(".ero").forEach(e =>
    e.classList.toggle("sel", Number(e.dataset.idx) === i));
  refreshList();
}
function refreshList() {
  const regs = getEditRegions(cur);
  regionList.innerHTML = "";
  regs.forEach((r, i) => {
    const li = document.createElement("li");
    li.textContent = (i + 1) + ". " + ((r.text || "").slice(0, 40) || "(空)");
    if (i === selected) li.classList.add("sel");
    li.addEventListener("click", () => selectRegion(i));
    regionList.appendChild(li);
  });
  document.getElementById("delBtn").disabled = selected == null;
}

/* ---------------- 导入 / 导出 ---------------- */
function exportRegions() {
  const doc = {
    bookId: BOOK_ID,
    voice: BOOK.voice,
    cnVoice: BOOK.cnVoice,
    pages: BOOK.pages.map((_, i) => getEditRegions(i)),
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "regions.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function importRegions(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      if (!Array.isArray(doc.pages)) throw new Error("缺少 pages");
      ensureBook();
      all[BOOK_ID].pages = doc.pages.map(p => Array.isArray(p) ? p : []);
      while (all[BOOK_ID].pages.length < BOOK.pages.length)
        all[BOOK_ID].pages.push([]);
      saveRegions();
      selected = null;
      renderPage();
      alert("已导入 " + doc.pages.length + " 页的区域。");
    } catch (e) {
      alert("导入失败: " + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------- 封面 + 引导 ---------------- */
function buildNav() {
  const img = document.getElementById("coverImg");
  if (BOOK.cover) img.src = BOOK.cover;
  else img.style.display = "none";
  const grid = document.getElementById("navgrid");
  grid.innerHTML = "";
  (BOOK.nav || []).forEach(entry => {
    const b = document.createElement("button");
    b.className = "navbtn";
    b.textContent = entry.label;
    b.onclick = () => gotoPage(entry.page);
    grid.appendChild(b);
    const pg = BOOK.pages[entry.page];          // 预加载单元首图，点选时无解码卡顿
    if (pg && pg.img) { const pre = new Image(); pre.src = pg.img; }
  });
  // 单词学习入口（words_reader，iframe 隔离，与本书脚本零冲突）
  const wb = document.createElement("button");
  wb.className = "navbtn words-entry";
  wb.textContent = "📚 单词学习";
  wb.onclick = openWords;
  grid.appendChild(wb);
}
function openCover() {
  if (!BOOK.cover && !(BOOK.nav && BOOK.nav.length)) return;
  coverOpen = true;
  document.getElementById("cover").classList.remove("hidden");
}
function closeCover() {
  coverOpen = false;
  document.getElementById("cover").classList.add("hidden");
}
function gotoPage(i) {
  closeCover();
  cur = i;
  renderPage();
}

/* ---------------- 单词学习（words_reader 覆盖层） ---------------- */
let wordsOpen = false;
const wordsLayer = document.getElementById("wordsLayer");
const wordsFrame = document.getElementById("wordsFrame");
function openWords() {
  if (!wordsFrame.dataset.loaded) {           // 懒加载，首次打开才载入
    // words_reader 已随 book_reader 自包含部署在 book_reader/words_reader/ 子目录。
    // 直接用相对路径加载，不做 title 检测（file:// 下跨源读取会误判）。
    wordsFrame.src = "words_reader/index.html";
    wordsFrame.dataset.loaded = "1";
  }
  wordsOpen = true;
  wordsLayer.classList.remove("hidden");
}
function closeWords() {
  wordsOpen = false;
  wordsLayer.classList.add("hidden");
}
document.getElementById("wordsBtn").onclick = openWords;
document.getElementById("wordsClose").onclick = closeWords;

/* ---------------- 整页连读 ---------------- */
function playAll() {
  stopAll();
  allQueue = currentItems.filter(it => it.audio).map(it => it.key);
  playingAll = true;
  nextInQueue();
}
function nextInQueue() {
  if (!playingAll) return;
  const key = allQueue.shift();
  if (key == null) { playingAll = false; highlightKey(null); return; }
  highlightKey(key);
  playAudio(currentItems.find(it => it.key === key).audio);
  audio && (audio.onended = nextInQueue);
}

/* ---------------- 模式切换 ---------------- */
function setEdit(on) {
  editMode = on;
  document.body.classList.toggle("editmode", on);
  document.getElementById("editBtn").classList.toggle("active", on);
  document.getElementById("exportBtn").style.display = on ? "" : "none";
  document.getElementById("importBtn").style.display = on ? "" : "none";
  selected = null;
  regionText.value = "";
  regionCn.value = "";
  renderPage();
}

/* ---------------- 事件绑定 ---------------- */
document.getElementById("coverBtn").onclick = openCover;
const coverEl = document.getElementById("cover");
coverEl.addEventListener("click", e => { if (e.target === coverEl) closeCover(); });
document.getElementById("prev").onclick = () => { if (cur > 0) { cur--; renderPage(); } };
document.getElementById("next").onclick = () => { if (cur < BOOK.pages.length - 1) { cur++; renderPage(); } };
document.getElementById("playall").onclick = playAll;
document.getElementById("stop").onclick = stopAll;
document.getElementById("showtext").onchange = e => { document.body.classList.toggle("showtext", e.target.checked); renderPage(); };
document.getElementById("showcn").onchange = e => { document.body.classList.toggle("showcn", e.target.checked); renderPage(); };
const rateEl = document.getElementById("rate");
const rateValEl = document.getElementById("rateVal");
function applyRate(r) {
  rate = r;
  rateValEl.textContent = (Math.round(r * 10) / 10) + "×";
  if (audio) audio.playbackRate = rate;   // 播放中实时调速
}
rateEl.addEventListener("input", e => applyRate(parseFloat(e.target.value)));
applyRate(parseFloat(rateEl.value));
document.getElementById("editBtn").onclick = () => setEdit(!editMode);
document.getElementById("exportBtn").onclick = exportRegions;
document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
document.getElementById("importFile").onchange = e => { if (e.target.files[0]) importRegions(e.target.files[0]); e.target.value = ""; };
document.getElementById("delBtn").onclick = () => {
  if (selected == null) return;
  getEditRegions(cur).splice(selected, 1);
  saveRegions();
  selected = null; regionText.value = "";
  renderPage();
};
document.getElementById("clearBtn").onclick = () => {
  if (!confirm("清空本页所有手绘点读区？")) return;
  getEditRegions(cur).length = 0;
  saveRegions();
  selected = null; regionText.value = "";
  renderPage();
};
regionText.addEventListener("input", () => {
  if (selected == null) return;
  getEditRegions(cur)[selected].text = regionText.value;
  saveRegions();
  refreshList();
});
regionCn.addEventListener("input", () => {
  if (selected == null) return;
  getEditRegions(cur)[selected].cn = regionCn.value;
  saveRegions();
});

document.addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (wordsOpen) {                         // 单词层打开时，Esc 返回，屏蔽本书快捷键
    if (e.key === "Escape") closeWords();
    return;
  }
  if (coverOpen) {
    if (e.key === "Escape") closeCover();
    return;                       // 封面打开时屏蔽翻页/连读
  }
  if (e.key === "ArrowLeft") document.getElementById("prev").click();
  else if (e.key === "ArrowRight") document.getElementById("next").click();
  else if (e.key === " ") { e.preventDefault(); playAll(); }
});

renderPage();

// 打开即显示封面 + 引导(若有封面图)
if (BOOK.cover) { buildNav(); openCover(); }
