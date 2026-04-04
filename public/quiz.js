(function () {
  "use strict";

  const SESSION_KEY = "WEB_Korean_session";
  const MAX_WEIGHT_PER_ITEM = 30;
  const WRONG_POPUP_MS = 1000;

  /** @type {{ topicsParam: string, promptShows: "korean" | "vietnamese" } | null} */
  let sessionConfig = null;
  /** @type {{ id: number, korean: string, vietnamese: string, topic: string, wrongCount: number }[]} */
  let itemsCache = [];
  /** @type {{ id: number, korean: string, vietnamese: string, topic: string, wrongCount: number }[]} */
  let questionQueue = [];
  /** @type {{ id: number, korean: string, vietnamese: string, topic: string, wrongCount: number } | null} */
  let currentItem = null;
  let isBusy = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let wrongPopupTimer = null;

  const elPromptText = document.getElementById("prompt-text");
  const elAnswerInput = document.getElementById("answer-input");
  const elBtnCheck = document.getElementById("btn-check");
  const elQuizActions = document.getElementById("quiz-actions");
  const elQuizMeta = document.getElementById("quiz-meta");
  const elBack = document.getElementById("btn-back");
  const elBtnFinish = document.getElementById("btn-finish");
  const elWrongOverlay = document.getElementById("wrong-popup-overlay");
  const elWrongText = document.getElementById("wrong-popup-text");
  const elWrongClose = document.getElementById("wrong-popup-close");

  function hideWrongPopup() {
    if (wrongPopupTimer !== null) {
      clearTimeout(wrongPopupTimer);
      wrongPopupTimer = null;
    }
    elWrongText.textContent = "";
    elWrongOverlay.setAttribute("hidden", "");
  }

  function showWrongPopup(expectedRaw) {
    if (wrongPopupTimer !== null) {
      clearTimeout(wrongPopupTimer);
      wrongPopupTimer = null;
    }
    elWrongText.textContent = "Đáp án đúng: " + expectedRaw;
    elWrongOverlay.removeAttribute("hidden");
    elWrongClose.focus();
    wrongPopupTimer = setTimeout(() => {
      wrongPopupTimer = null;
      hideWrongPopup();
    }, WRONG_POPUP_MS);
  }

  function normalizeAnswer(s) {
    return String(s || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function buildSessionQueue(items) {
    const pool = [];
    for (const it of items) {
      const w = 1 + Math.max(0, Number(it.wrongCount) || 0);
      const repeats = Math.min(w, MAX_WEIGHT_PER_ITEM);
      for (let i = 0; i < repeats; i += 1) {
        pool.push(it);
      }
    }
    shuffleInPlace(pool);
    return pool;
  }

  function getExpectedAnswer(item) {
    if (sessionConfig.promptShows === "korean") {
      return item.vietnamese;
    }
    return item.korean;
  }

  function getPromptText(item) {
    if (sessionConfig.promptShows === "korean") {
      return item.korean;
    }
    return item.vietnamese;
  }

  async function fetchItems(topicsParam) {
    const res = await fetch("/api/items?topics=" + encodeURIComponent(topicsParam));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Không tải được từ vựng");
    }
    const data = await res.json();
    return data.items || [];
  }

  async function incrementWrong(id) {
    const res = await fetch("/api/items/" + id + "/wrong", { method: "PATCH" });
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    if (data.item) {
      const idx = itemsCache.findIndex((x) => x.id === data.item.id);
      if (idx >= 0) {
        itemsCache[idx] = data.item;
      }
    }
  }

  function setQuizUiVisible(isActive) {
    if (isActive) {
      elAnswerInput.removeAttribute("hidden");
      elQuizActions.removeAttribute("hidden");
      elBtnFinish.setAttribute("hidden", "");
    } else {
      elAnswerInput.setAttribute("hidden", "");
      elQuizActions.setAttribute("hidden", "");
      elBtnFinish.removeAttribute("hidden");
    }
  }

  function showFinishedState(message) {
    hideWrongPopup();
    currentItem = null;
    elPromptText.textContent = message;
    elQuizMeta.textContent = "";
    elAnswerInput.value = "";
    elAnswerInput.disabled = true;
    elBtnCheck.disabled = true;
    setQuizUiVisible(false);
    elBtnFinish.focus();
  }

  function showNextQuestion() {
    if (questionQueue.length === 0) {
      showFinishedState("Hết từ trong phiên này.");
      return;
    }
    currentItem = questionQueue.shift();
    if (!currentItem) {
      showFinishedState("Hết từ trong phiên này.");
      return;
    }
    elPromptText.textContent = getPromptText(currentItem);
    elAnswerInput.value = "";
    elAnswerInput.disabled = false;
    elBtnCheck.disabled = false;
    elQuizMeta.textContent = "Chủ đề: " + currentItem.topic + " · Còn: " + questionQueue.length;
    elAnswerInput.focus();
  }

  async function checkAnswer() {
    if (!currentItem || isBusy) {
      return;
    }
    const expectedRaw = getExpectedAnswer(currentItem);
    const got = elAnswerInput.value;
    if (normalizeAnswer(got) === normalizeAnswer(expectedRaw)) {
      showNextQuestion();
      return;
    }
    isBusy = true;
    await incrementWrong(currentItem.id);
    showWrongPopup(expectedRaw);
    showNextQuestion();
    isBusy = false;
  }

  elBtnCheck.addEventListener("click", () => {
    void checkAnswer();
  });
  elAnswerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void checkAnswer();
    }
  });
  elWrongClose.addEventListener("click", () => {
    hideWrongPopup();
  });
  elWrongOverlay.addEventListener("click", (e) => {
    if (e.target === elWrongOverlay) {
      hideWrongPopup();
    }
  });
  elBack.addEventListener("click", () => {
    hideWrongPopup();
    window.location.href = "index.html";
  });
  elBtnFinish.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  async function init() {
    hideWrongPopup();
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      window.location.replace("index.html");
      return;
    }
    try {
      sessionConfig = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.replace("index.html");
      return;
    }
    if (
      !sessionConfig ||
      typeof sessionConfig.topicsParam !== "string" ||
      (sessionConfig.promptShows !== "korean" && sessionConfig.promptShows !== "vietnamese")
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.replace("index.html");
      return;
    }
    elBtnFinish.setAttribute("hidden", "");
    elQuizActions.removeAttribute("hidden");
    elAnswerInput.removeAttribute("hidden");
    try {
      itemsCache = await fetchItems(sessionConfig.topicsParam);
    } catch (err) {
      showFinishedState(String(err.message || err));
      return;
    }
    if (itemsCache.length === 0) {
      showFinishedState("Không có từ cho chủ đề đã chọn.");
      return;
    }
    questionQueue = buildSessionQueue(itemsCache);
    showNextQuestion();
  }

  void init();
})();
