(function () {
  "use strict";

  const SESSION_KEY = "WEB_Korean_session";

  const elImportForm = document.getElementById("import-form");
  const elImportFile = document.getElementById("import-file");
  const elImportMsg = document.getElementById("import-msg");
  const elManualForm = document.getElementById("manual-form");
  const elManualKorean = document.getElementById("manual-korean");
  const elManualVietnamese = document.getElementById("manual-vietnamese");
  const elManualTopic = document.getElementById("manual-topic");
  const elManualMsg = document.getElementById("manual-msg");
  const elTopicsBox = document.getElementById("topics-box");
  const elTopicAll = document.getElementById("topic-all");
  const elBtnStart = document.getElementById("btn-start");
  const elSetupMsg = document.getElementById("setup-msg");

  async function fetchTopics() {
    const res = await fetch("/api/topics");
    if (!res.ok) {
      throw new Error("Không tải được danh sách chủ đề");
    }
    const data = await res.json();
    return data.topics || [];
  }

  function renderTopicCheckboxes(topics) {
    elTopicsBox.innerHTML = "";
    topics.forEach((t) => {
      const id = "topic-" + encodeURIComponent(t).replace(/%/g, "_");
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = t;
      input.id = id;
      input.className = "topic-cb";
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + t));
      elTopicsBox.appendChild(label);
    });
  }

  function syncTopicAllState() {
    const cbs = elTopicsBox.querySelectorAll(".topic-cb");
    if (cbs.length === 0) {
      elTopicAll.checked = true;
      elTopicAll.disabled = true;
      return;
    }
    elTopicAll.disabled = false;
    const allOn = Array.from(cbs).every((c) => c.checked);
    elTopicAll.checked = allOn;
  }

  elTopicAll.addEventListener("change", () => {
    const cbs = elTopicsBox.querySelectorAll(".topic-cb");
    cbs.forEach((c) => {
      c.checked = elTopicAll.checked;
    });
  });

  elTopicsBox.addEventListener("change", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("topic-cb")) {
      syncTopicAllState();
    }
  });

  async function loadTopicsUi() {
    try {
      const topics = await fetchTopics();
      renderTopicCheckboxes(topics);
      syncTopicAllState();
      elSetupMsg.textContent = topics.length ? "" : "Chưa có dữ liệu. Hãy nhập file Excel hoặc nhập tay.";
    } catch (err) {
      elSetupMsg.textContent = String(err.message || err);
    }
  }

  function getSelectedTopicsParam() {
    if (elTopicAll.checked) {
      return "all";
    }
    const cbs = elTopicsBox.querySelectorAll(".topic-cb:checked");
    const vals = Array.from(cbs).map((c) => c.value);
    return vals.join(",");
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

  function getPromptShows() {
    const r = document.querySelector('input[name="mode"]:checked');
    if (r && r.value === "showKorean") {
      return "korean";
    }
    return "vietnamese";
  }

  elBtnStart.addEventListener("click", async () => {
    elSetupMsg.textContent = "";
    const param = getSelectedTopicsParam();
    if (!elTopicAll.checked && param === "") {
      elSetupMsg.textContent = "Chọn ít nhất một chủ đề hoặc bật Tất cả.";
      return;
    }
    elBtnStart.disabled = true;
    try {
      const items = await fetchItems(param);
      if (items.length === 0) {
        elSetupMsg.textContent = "Không có từ trong các chủ đề đã chọn.";
        return;
      }
      const payload = {
        topicsParam: param,
        promptShows: getPromptShows(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      window.location.href = "quiz.html";
    } catch (err) {
      elSetupMsg.textContent = String(err.message || err);
    } finally {
      elBtnStart.disabled = false;
    }
  });

  elManualForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    elManualMsg.textContent = "";
    const payload = {
      korean: elManualKorean.value,
      vietnamese: elManualVietnamese.value,
      topic: elManualTopic.value,
    };
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        elManualMsg.textContent = data.error || "Không thêm được";
        return;
      }
      elManualMsg.textContent = "Đã thêm: " + (data.item && data.item.korean ? data.item.korean : "");
      elManualKorean.value = "";
      elManualVietnamese.value = "";
      elManualTopic.value = "";
      elManualKorean.focus();
      await loadTopicsUi();
    } catch (err) {
      elManualMsg.textContent = String(err.message || err);
    }
  });

  elImportForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    elImportMsg.textContent = "";
    const f = elImportFile.files && elImportFile.files[0];
    if (!f) {
      elImportMsg.textContent = "Chọn file Excel.";
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/excel", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        elImportMsg.textContent = data.error || "Lỗi nhập file";
        return;
      }
      elImportMsg.textContent = data.message || "Xong.";
      elImportFile.value = "";
      await loadTopicsUi();
    } catch (err) {
      elImportMsg.textContent = String(err.message || err);
    }
  });

  loadTopicsUi();
})();
