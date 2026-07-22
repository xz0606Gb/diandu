/* ============ 单词学习应用 ============ */
(function () {
  "use strict";

  const WORDS = window.VOCAB_DATA || [];
  const META = window.VOCAB_META || { unitOrder: [], pagesByUnit: {} };

  /* ---------- 状态 ---------- */
  const state = {
    units: new Set(META.unitOrder),          // 选中的单元
    selected: new Set(),                     // 选中的单词索引（指向 WORDS）
    mode: "study",
    showAllZh: false,
    fcMode: "en",                            // en: 英文正面 / zh: 中文正面
    fcIndex: 0,
    fcFlipped: false,
    fcOrder: [],                             // 闪卡顺序（索引数组）
  };

  // 按页码升序，页码相同则保持原始顺序
  function byPageAsc(a, b) {
    return (WORDS[a].page - WORDS[b].page) || (a - b);
  }

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const unitChips = $("unitChips");
  const candidateList = $("candidateList");
  const selCount = $("selCount");
  const studyGrid = $("studyGrid");
  const studyCount = $("studyCount");

  /* ---------- TTS（本地 mp3 优先，浏览器语音回退） ---------- */
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  }
  function pickVoice() {
    if (!voices.length) return null;
    return (
      voices.find((v) => /en[-_]US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null
    );
  }
  // 浏览器语音合成（本地音频缺失时的回退）
  function speak(text, rate) {
    return new Promise((resolve) => {
      if (!synth) { resolve(); return; }
      try { synth.cancel(); } catch (e) {}
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate || 1;
      u.lang = "en-US";
      const v = pickVoice();
      if (v) u.voice = v;
      let done = false;
      const end = () => { if (done) return; done = true; resolve(); };
      u.onend = end;
      u.onerror = end;
      synth.speak(u);
      setTimeout(end, 15000);
    });
  }

  let currentAudio = null;
  let activeAudioResolve = null;
  function stopAudio() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    if (activeAudioResolve) { const r = activeAudioResolve; activeAudioResolve = null; r(); }
  }
  // 播放本地音频 audio/{index}.mp3；失败则回退浏览器 TTS
  function playWord(index, rate) {
    return new Promise((resolve) => {
      // 中断上一个尚未结束的播放
      if (currentAudio && activeAudioResolve) {
        try { currentAudio.pause(); } catch (e) {}
        const prev = activeAudioResolve; activeAudioResolve = null; prev();
      }
      const a = new Audio("audio/" + index + ".mp3");
      a.playbackRate = rate || 1;
      currentAudio = a;
      activeAudioResolve = resolve;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (activeAudioResolve === resolve) activeAudioResolve = null;
        resolve();
      };
      a.onended = finish;
      a.onerror = () => speak(WORDS[index].en, rate).then(finish);
      const p = a.play();
      if (p && p.catch) p.catch(() => speak(WORDS[index].en, rate).then(finish));
      a.onloadedmetadata = () => {
        const maxMs = (a.duration * 1000) / (rate || 1) + 5000;
        setTimeout(finish, Math.min(maxMs, 40000));
      };
      setTimeout(finish, 40000);
    });
  }
  function ttsAvailable() { return !!synth; }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ---------- 工具 ---------- */
  function candidates() {
    return WORDS.map((w, i) => i)
      .filter((i) => state.units.has(WORDS[i].unit))
      .sort(byPageAsc);
  }
  function selectedWords() {
    return Array.from(state.selected)
      .filter((i) => state.units.has(WORDS[i].unit))
      .sort(byPageAsc)
      .map((i) => WORDS[i]);
  }

  /* ---------- 渲染：单元 / 页码 ---------- */
  function renderUnits() {
    unitChips.innerHTML = "";
    META.unitOrder.forEach((u) => {
      const b = document.createElement("button");
      b.className = "chip" + (state.units.has(u) ? " active" : "");
      b.textContent = u;
      b.onclick = () => {
        if (state.units.has(u)) state.units.delete(u);
        else state.units.add(u);
        if (state.units.size === 0) state.units.add(u); // 至少保留一个
        renderUnits();
        renderCandidates();
        renderActiveView();
      };
      unitChips.appendChild(b);
    });
  }

  /* ---------- 渲染：候选列表（多选） ---------- */
  function renderCandidates() {
    const list = candidates();
    candidateList.innerHTML = "";
    if (!list.length) {
      candidateList.innerHTML = '<div class="empty" style="padding:24px 8px;border:none;">该筛选条件下没有单词</div>';
    }
    list.forEach((i) => {
      const w = WORDS[i];
      const row = document.createElement("div");
      row.className = "cand" + (state.selected.has(i) ? " selected" : "");
      row.innerHTML =
        '<div class="check">✓</div>' +
        '<div class="cw">' + escapeHtml(w.en) + "</div>" +
        '<div class="cmeta">' +
          '<span class="cph">/' + escapeHtml(w.phonetic) + "/</span>" +
          '<span class="cp">P' + escapeHtml(String(w.page)) + "</span>" +
        "</div>";
      row.onclick = () => {
        if (state.selected.has(i)) state.selected.delete(i);
        else state.selected.add(i);
        renderCandidates();
        renderActiveView();
        updateCounts();
      };
      candidateList.appendChild(row);
    });
    updateCounts();
  }

  function updateCounts() {
    const n = selectedWords().length;
    selCount.textContent = "已选 " + n + " 个";
  }

  /* ---------- 渲染：点读学习 ---------- */
  function renderStudy() {
    const words = selectedWords();
    studyCount.textContent = "（" + words.length + "）";
    if (!words.length) {
      studyGrid.innerHTML =
        '<div class="empty"><div class="big">🗂️</div><div class="sm">请先在左侧「单元」中筛选，并勾选单词</div></div>';
      return;
    }
    studyGrid.innerHTML = "";
    words.forEach((w, idx) => {
      const gi = WORDS.indexOf(w);
      const card = document.createElement("div");
      card.className = "word-card" + (state.showAllZh ? " show-zh" : "");
      card.innerHTML =
        '<div class="wc-top">' +
          '<span class="wc-index">#' + (idx + 1) + "</span>" +
          '<button class="wc-speak" title="朗读">🔊</button>' +
        "</div>" +
        '<div class="wc-en">' + escapeHtml(w.en) + "</div>" +
        '<div class="wc-ph">/' + escapeHtml(w.phonetic) + "/</div>" +
        '<div class="wc-zh">' + escapeHtml(w.zh) + "</div>" +
        '<div class="wc-toggle">' + (state.showAllZh ? "隐藏释义" : "显示释义") + "</div>";

      const speakBtn = card.querySelector(".wc-speak");
      const play = () => {
        speakBtn.classList.add("playing");
        playWord(gi, 1).then(() => speakBtn.classList.remove("playing"));
      };
      // 点击卡片（非按钮区域）朗读
      card.addEventListener("click", (e) => {
        if (e.target.closest(".wc-toggle")) {
          card.classList.toggle("show-zh");
          card.querySelector(".wc-toggle").textContent = card.classList.contains("show-zh") ? "隐藏释义" : "显示释义";
          return;
        }
        if (e.target.closest(".wc-speak")) { play(); return; }
        play();
      });
      speakBtn.addEventListener("click", (e) => { e.stopPropagation(); play(); });
      studyGrid.appendChild(card);
    });
  }

  /* ---------- 听写模式 ---------- */
  let dictCancel = false;
  let dictRunning = false;

  function renderReview(words) {
    const box = $("dictReview");
    if (!words.length) { box.innerHTML = ""; return; }
    let html = "<h3>听写核对（" + words.length + " 个）</h3><div class='review-list'>";
    words.forEach((w) => {
      const gi = WORDS.indexOf(w);
      html +=
        "<div class='review-item'>" +
          "<button class='ri-speak' data-index='" + gi + "'>🔊</button>" +
          "<span class='ri-en'>" + escapeHtml(w.en) + "</span>" +
          "<span class='ri-ph'>/" + escapeHtml(w.phonetic) + "/</span>" +
          "<span class='ri-zh'>" + escapeHtml(w.zh) + "</span>" +
        "</div>";
    });
    html += "</div>";
    box.innerHTML = html;
    box.querySelectorAll(".ri-speak").forEach((b) => {
      b.onclick = () => playWord(Number(b.getAttribute("data-index")), 1);
    });
  }

  async function runDictation() {
    const words = selectedWords();
    if (!words.length) {
      $("dictStatus").textContent = "请先选择单词";
      return;
    }
    dictCancel = false;
    dictRunning = true;
    $("startDict").disabled = true;
    $("stopDict").disabled = false;
    $("dictReview").innerHTML = "";

    for (let i = 0; i < words.length; i++) {
      if (dictCancel) break;
      const w = words[i];
      $("dictStatus").innerHTML = "正在听写 <span class='cur'>" + escapeHtml(w.en) + "</span> （" + (i + 1) + " / " + words.length + "）";
      $("dictFill").style.width = (i / words.length) * 100 + "%";

      await playWord(WORDS.indexOf(w), 0.75);   // 第 1 遍
      if (dictCancel) break;
      await sleep(1000);                // 间隔 1 秒
      if (dictCancel) break;
      await playWord(WORDS.indexOf(w), 0.75);   // 第 2 遍
      if (dictCancel) break;
      await sleep(3000);                // 单词之间间隔 3 秒
    }

    dictRunning = false;
    $("startDict").disabled = false;
    $("stopDict").disabled = true;
    if (dictCancel) {
      $("dictStatus").textContent = "已停止";
    } else {
      $("dictStatus").textContent = "听写完成 ✅ 请核对下方单词";
      $("dictFill").style.width = "100%";
    }
    renderReview(words);
  }

  /* ---------- 闪卡模式 ---------- */
  function buildFcOrder() {
    state.fcOrder = selectedWords().map((_, i) => i);
  }
  function renderFlashcard() {
    const words = selectedWords();
    const stage = document.querySelector(".fc-stage");
    if (!words.length) {
      stage.innerHTML = '<div class="empty"><div class="big">🃏</div><div class="sm">请先在左侧选择单词</div></div>';
      $("fcCounter").textContent = "";
      return;
    }
    if (!stage.querySelector("#fcCard")) {
      // 恢复卡片 DOM（若之前被空状态替换）
      stage.innerHTML =
        '<div class="fc-card" id="fcCard"><div class="fc-inner">' +
        '<div class="fc-face fc-front"><div class="fc-label" id="fcFrontLabel"></div><div class="fc-main" id="fcFrontMain"></div><div class="fc-sub" id="fcFrontSub"></div></div>' +
        '<div class="fc-face fc-back"><div class="fc-label" id="fcBackLabel"></div><div class="fc-main" id="fcBackMain"></div><div class="fc-sub" id="fcBackSub"></div></div>' +
        "</div></div>";
    }
    bindFcCard();
    if (state.fcOrder.length !== words.length) buildFcOrder();
    if (state.fcIndex >= words.length) state.fcIndex = 0;
    updateFcCard();
  }
  function updateFcCard() {
    const words = selectedWords();
    if (!words.length) return;
    const w = words[state.fcOrder[state.fcIndex]];
    const card = $("fcCard");
    card.classList.remove("flipped");
    state.fcFlipped = false;
    const enFront = state.fcMode === "en";
    $("fcFrontLabel").textContent = enFront ? "英文" : "中文";
    $("fcBackLabel").textContent = enFront ? "中文" : "英文";
    if (enFront) {
      $("fcFrontMain").textContent = w.en;
      $("fcFrontSub").textContent = "/" + w.phonetic + "/";
      $("fcBackMain").textContent = w.zh;
      $("fcBackSub").textContent = "";
    } else {
      $("fcFrontMain").textContent = w.zh;
      $("fcFrontSub").textContent = "";
      $("fcBackMain").textContent = w.en;
      $("fcBackSub").textContent = "/" + w.phonetic + "/";
    }
    $("fcCounter").textContent = (state.fcIndex + 1) + " / " + words.length;
  }
  function bindFcCard() {
    const card = $("fcCard");
    if (!card) return;
    card.onclick = () => {
      card.classList.toggle("flipped");
      state.fcFlipped = !state.fcFlipped;
    };
  }
  function fcNext() {
    const words = selectedWords();
    if (!words.length) return;
    state.fcIndex = (state.fcIndex + 1) % words.length;
    updateFcCard();
  }
  function fcPrev() {
    const words = selectedWords();
    if (!words.length) return;
    state.fcIndex = (state.fcIndex - 1 + words.length) % words.length;
    updateFcCard();
  }

  /* ---------- 转义 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- 模式切换 ---------- */
  function switchMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("view-" + mode).classList.add("active");
    renderActiveView();
  }
  function renderActiveView() {
    if (state.mode === "flashcard") renderFlashcard();
    else if (state.mode === "study") renderStudy();
    // 听写模式在“开始听写”时读取最新选择，无需实时刷新
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $("tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b) switchMode(b.dataset.mode);
    });

    $("selAll").onclick = () => {
      candidates().forEach((i) => state.selected.add(i));
      renderCandidates(); renderActiveView(); updateCounts();
    };
    $("selClear").onclick = () => {
      state.selected.clear();
      renderCandidates(); renderActiveView(); updateCounts();
    };

    $("toggleAllTrans").onclick = () => {
      state.showAllZh = !state.showAllZh;
      $("toggleAllTrans").textContent = state.showAllZh ? "隐藏全部释义" : "显示全部释义";
      renderStudy();
    };
    $("readAll").onclick = () => {
      const words = selectedWords();
      if (!words.length) return;
      speakSequence(words.map((w) => WORDS.indexOf(w)), 1);
    };

    $("startDict").onclick = runDictation;
    $("stopDict").onclick = () => { dictCancel = true; stopAudio(); if (synth) try { synth.cancel(); } catch (e) {} };

    $("fcMode").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-fc]");
      if (!b) return;
      state.fcMode = b.dataset.fc;
      document.querySelectorAll("#fcMode button").forEach((x) => x.classList.toggle("active", x === b));
      updateFcCard();
    });
    $("fcShuffle").onclick = () => {
      buildFcOrder();
      // Fisher-Yates
      for (let i = state.fcOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.fcOrder[i], state.fcOrder[j]] = [state.fcOrder[j], state.fcOrder[i]];
      }
      state.fcIndex = 0;
      updateFcCard();
    };
    $("fcRead").onclick = () => {
      const words = selectedWords();
      if (!words.length) return;
      const w = words[state.fcOrder[state.fcIndex]];
      playWord(WORDS.indexOf(w), 1);
    };
    $("fcNext").onclick = fcNext;
    $("fcPrev").onclick = fcPrev;
    document.addEventListener("keydown", (e) => {
      if (state.mode !== "flashcard") return;
      if (e.key === "ArrowRight") fcNext();
      else if (e.key === "ArrowLeft") fcPrev();
      else if (e.key === " " || e.key === "Enter") {
        const c = $("fcCard");
        if (c) { c.classList.toggle("flipped"); state.fcFlipped = !state.fcFlipped; }
        e.preventDefault();
      }
    });

    // 移动端筛选抽屉
    const sidebar = $("sidebar");
    const scrim = $("scrim");
    const openSidebar = () => { sidebar.classList.add("open"); scrim.classList.add("open"); };
    const closeSidebar = () => { sidebar.classList.remove("open"); scrim.classList.remove("open"); };
    $("mobileFilterToggle").onclick = openSidebar;
    $("sidebarClose").onclick = closeSidebar;
    scrim.onclick = closeSidebar;
  }

  /* ---------- 顺序朗读（朗读全部 / 通用） ---------- */
  let seqToken = 0;
  async function speakSequence(items, rate) {
    const my = ++seqToken;
    for (const it of items) {
      if (my !== seqToken) return;
      await playWord(it, rate);
      if (my !== seqToken) return;
      await sleep(350);
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (!ttsAvailable()) {
      // 不阻断使用，仅提示
      console.warn("当前浏览器不支持语音合成（SpeechSynthesis）。");
    }
    renderUnits();
    renderCandidates();
    renderStudy();
    bindEvents();
    updateCounts();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
