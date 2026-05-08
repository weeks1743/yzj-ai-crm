const state = {
  tasks: [],
  bundle: null,
  transcriptItems: [],
  zoom: 1,
  activeTranscriptIndex: -1,
  keywordExpanded: false,
  keywordOverflow: false,
  pendingSeekSeconds: null,
  mindmapPan: { x: 0, y: 0, startLeft: 0, startTop: 0, dragging: false, moved: false },
  globalSpeakerAliases: {},
  taskSpeakerAliases: {},
  selectedSpeakerKey: "",
  profileScenario: "interview",
  profileResult: null,
  profileBusy: false,
  layoutMode: "both",
  leftPanelRatio: 0.5,
  splitterDrag: { active: false, pointerId: null },
};

const GLOBAL_ALIAS_STORAGE_KEY = "meeting-viewer-speaker-aliases-v1";
const TASK_ALIAS_STORAGE_PREFIX = "meeting-viewer-task-aliases-";

const els = {};

function viewerApiPath(path) {
  if (!path || path.startsWith("#") || /^https?:\/\//i.test(path)) {
    return path;
  }
  const prefix = window.location.pathname.includes("/audio-viewer/") ? "/audio-viewer" : "";
  return `${prefix}${path}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  await loadTasks();
  window.addEventListener("resize", renderWorkspaceLayout);
});

function bindElements() {
  els.taskSelect = document.getElementById("taskSelect");
  els.taskMeta = document.getElementById("taskMeta");
  els.displayMode = document.getElementById("displayMode");
  els.transcript = document.getElementById("transcript");
  els.audio = document.getElementById("audio");
  els.playButton = document.getElementById("playButton");
  els.currentTime = document.getElementById("currentTime");
  els.duration = document.getElementById("duration");
  els.speedSelect = document.getElementById("speedSelect");
  els.timeline = document.getElementById("timeline");
  els.timelineSegments = document.getElementById("timelineSegments");
  els.timelineProgress = document.getElementById("timelineProgress");
  els.timelineThumb = document.getElementById("timelineThumb");
  els.timelineTooltip = document.getElementById("timelineTooltip");
  els.timelineRange = document.getElementById("timelineRange");
  els.keywordList = document.getElementById("keywordList");
  els.keywordToggle = document.getElementById("keywordToggle");
  els.summaryContent = document.getElementById("summaryContent");
  els.chaptersList = document.getElementById("chaptersList");
  els.speakerSummaryList = document.getElementById("speakerSummaryList");
  els.qaList = document.getElementById("qaList");
  els.mainTabs = document.getElementById("mainTabs");
  els.overviewTabs = document.getElementById("overviewTabs");
  els.mindmapCanvas = document.getElementById("mindmapCanvas");
  els.zoomInButton = document.getElementById("zoomInButton");
  els.zoomOutButton = document.getElementById("zoomOutButton");
  els.zoomResetButton = document.getElementById("zoomResetButton");
  els.profileScenario = document.getElementById("profileScenario");
  els.analyzeProfileButton = document.getElementById("analyzeProfileButton");
  els.profileOpenLink = document.getElementById("profileOpenLink");
  els.profileSpeakerList = document.getElementById("profileSpeakerList");
  els.speakerAliasInput = document.getElementById("speakerAliasInput");
  els.applySpeakerSingle = document.getElementById("applySpeakerSingle");
  els.applySpeakerGlobal = document.getElementById("applySpeakerGlobal");
  els.globalAliasList = document.getElementById("globalAliasList");
  els.profilePrompt = document.getElementById("profilePrompt");
  els.profileMarkdown = document.getElementById("profileMarkdown");
  els.workspace = document.querySelector(".workspace");
  els.splitter = document.getElementById("splitter");
  els.splitterHandle = document.getElementById("splitterHandle");
  els.showLeftOnly = document.getElementById("showLeftOnly");
  els.showBothPanels = document.getElementById("showBothPanels");
  els.showRightOnly = document.getElementById("showRightOnly");
}

function bindEvents() {
  els.taskSelect.addEventListener("change", () => {
    const taskId = els.taskSelect.value;
    updateTaskQuery(taskId);
    loadTask(taskId);
  });

  els.displayMode.addEventListener("change", () => {
    if (state.bundle) {
      renderTranscript();
    }
  });

  els.playButton.addEventListener("click", togglePlayback);
  els.audio.addEventListener("loadedmetadata", syncAudioUi);
  els.audio.addEventListener("loadedmetadata", applyPendingSeek);
  els.audio.addEventListener("canplay", applyPendingSeek);
  els.audio.addEventListener("timeupdate", syncAudioUi);
  els.audio.addEventListener("play", updatePlayButton);
  els.audio.addEventListener("pause", updatePlayButton);
  els.speedSelect.addEventListener("change", () => {
    els.audio.playbackRate = Number(els.speedSelect.value);
  });
  els.keywordToggle.addEventListener("click", toggleKeywords);

  els.timelineRange.addEventListener("input", onTimelineRangeInput);
  els.timelineRange.addEventListener("change", onTimelineRangeInput);
  els.timelineRange.addEventListener("mousemove", onTimelineRangeHover);
  els.timelineRange.addEventListener("mouseleave", hideTimelineTooltip);
  els.timelineRange.addEventListener("touchstart", onTimelineRangeTouch, { passive: false });
  els.timelineRange.addEventListener("touchmove", onTimelineRangeTouch, { passive: false });
  els.timelineRange.addEventListener("keydown", onTimelineKeyDown);

  els.mainTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) {
      return;
    }
    setActiveTab(els.mainTabs, button.dataset.tab, ".tab", ".view", "data-view");
  });

  els.overviewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-subtab]");
    if (!button) {
      return;
    }
    setActiveTab(
      els.overviewTabs,
      button.dataset.subtab,
      ".subtab",
      ".subview",
      "data-subview",
    );
  });

  els.zoomInButton.addEventListener("click", () => {
    state.zoom = Math.min(2.4, state.zoom + 0.15);
    applyMindmapZoom();
  });
  els.zoomOutButton.addEventListener("click", () => {
    state.zoom = Math.max(0.55, state.zoom - 0.15);
    applyMindmapZoom();
  });
  els.zoomResetButton.addEventListener("click", () => {
    state.zoom = 1;
    applyMindmapZoom();
  });

  els.profileScenario.addEventListener("change", () => {
    state.profileScenario = els.profileScenario.value;
    state.profileResult = null;
    renderProfileView();
  });
  els.analyzeProfileButton.addEventListener("click", analyzeProfile);
  els.applySpeakerSingle.addEventListener("click", applyTaskSpeakerAlias);
  els.applySpeakerGlobal.addEventListener("click", applyGlobalSpeakerAlias);
  els.showLeftOnly.addEventListener("click", () => setWorkspaceLayout("left-only"));
  els.showBothPanels.addEventListener("click", () => setWorkspaceLayout("both"));
  els.showRightOnly.addEventListener("click", () => setWorkspaceLayout("right-only"));
  els.splitterHandle.addEventListener("pointerdown", onSplitterPointerDown);
  window.addEventListener("pointermove", onSplitterPointerMove);
  window.addEventListener("pointerup", onSplitterPointerUp);

  els.mindmapCanvas.addEventListener("pointerdown", onMindmapPointerDown);
  els.mindmapCanvas.addEventListener("pointermove", onMindmapPointerMove);
  els.mindmapCanvas.addEventListener("pointerup", onMindmapPointerUp);
  els.mindmapCanvas.addEventListener("pointerleave", onMindmapPointerUp);
}

async function loadTasks() {
  const response = await fetch(viewerApiPath("/api/tasks"));
  const payload = await response.json();
  state.tasks = payload.tasks || [];

  els.taskSelect.innerHTML = state.tasks
    .map((task) => `<option value="${task.id}">${task.id}</option>`)
    .join("");

  const params = new URLSearchParams(window.location.search);
  const preferredTask = params.get("task");
  const taskId =
    state.tasks.find((task) => task.id === preferredTask)?.id ||
    state.tasks[0]?.id;

  if (!taskId) {
    els.taskMeta.textContent = "未找到 outputs 任务结果";
    return;
  }

  els.taskSelect.value = taskId;
  await loadTask(taskId);
}

async function loadTask(taskId) {
  els.taskMeta.textContent = `正在加载 ${taskId}`;
  const response = await fetch(viewerApiPath(`/api/task/${taskId}`));
  const bundle = await response.json();
  state.bundle = normalizeBundle(bundle);
  state.activeTranscriptIndex = -1;
  state.keywordExpanded = false;
  state.keywordOverflow = false;
  state.profileResult = null;
  state.globalSpeakerAliases = loadJsonStorage(GLOBAL_ALIAS_STORAGE_KEY);
  state.taskSpeakerAliases = loadJsonStorage(taskAliasStorageKey(taskId));
  state.selectedSpeakerKey = state.bundle.speakerLabels[0] || "";
  state.profileScenario = "interview";
  hideTimelineTooltip();
  render();
}

function normalizeBundle(bundle) {
  const assets = bundle.assets || {};
  const transcription = assets.transcription || {};
  const translations = assets.translations || {};
  const textPolish = assets.textPolish || [];
  const summarization = assets.summarization || {};
  const meetingAssistance = assets.meetingAssistance || {};
  const taskStatus = ((bundle.taskResult || {}).output || {}).status;
  const createTime = bundle.meta?.updatedAt || "";

  const translationMap = new Map(
    (translations.paragraphs || []).map((item) => [
      item.paragraphId,
      (item.sentences || []).map((sentence) => sentence.text).join(""),
    ]),
  );

  const polishMap = new Map(
    (textPolish || []).map((item) => [item.paragraphId, item.formalParagraphText]),
  );

  const transcriptItems = (transcription.paragraphs || []).map((paragraph) => {
    const words = paragraph.words || [];
    const start = words[0]?.start || 0;
    const end = words[words.length - 1]?.end || start;
    return {
      paragraphId: paragraph.paragraphId,
      speakerId: paragraph.speakerId || "1",
      start,
      end,
      text: words.map((word) => word.text).join(""),
      translation: translationMap.get(paragraph.paragraphId) || "",
      polish: polishMap.get(paragraph.paragraphId) || "",
    };
  });

  return {
    ...bundle,
    taskStatus,
    createTime,
    transcriptItems,
    keywords: meetingAssistance.keywords || [],
    chapters: assets.autoChapters || [],
    paragraphSummary: summarization.paragraphSummary || "",
    conversationalSummary: summarization.conversationalSummary || [],
    questionsAnsweringSummary: summarization.questionsAnsweringSummary || [],
    mindMapSummary: summarization.mindMapSummary || [],
    audioInfo: transcription.audioInfo || {},
    audioSegments: transcription.audioSegments || [],
    speakerLabels: Array.from(
      new Set(transcriptItems.map((item) => speakerRawLabel(item.speakerId))),
    ),
  };
}

function render() {
  renderWorkspaceLayout();
  renderMeta();
  renderTranscript();
  renderTimeline();
  renderRightPanel();
  renderMindmap();
  renderProfileView();
  renderAudio();
}

function renderMeta() {
  const taskId = state.bundle.id;
  const meta = state.bundle.meta || {};
  const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : "";
  els.taskMeta.textContent = `${taskId} · 状态 ${state.bundle.taskStatus} · 更新于 ${updated}`;
}

function renderWorkspaceLayout() {
  els.workspace.dataset.layout = state.layoutMode;
  els.workspace.style.setProperty("--left-panel-width", `${state.leftPanelRatio * 100}%`);
  els.showLeftOnly.classList.toggle("splitter__button--active", state.layoutMode === "left-only");
  els.showBothPanels.classList.toggle("splitter__button--active", state.layoutMode === "both");
  els.showRightOnly.classList.toggle("splitter__button--active", state.layoutMode === "right-only");
  els.splitter.style.display = window.innerWidth <= 1100 ? "none" : "flex";
}

function renderTranscript() {
  const mode = els.displayMode.value;
  state.transcriptItems = state.bundle.transcriptItems;
  state.activeTranscriptIndex = -1;

  els.transcript.innerHTML = state.transcriptItems
    .map((item, index) => {
      const speakerLabel = getSpeakerDisplayName(speakerRawLabel(item.speakerId));
      const avatar = speakerAvatar(item.speakerId);
      const primaryText = escapeHtml(item.text || "");
      const translationText = escapeHtml(item.translation || "");
      const polishedText = escapeHtml(item.polish || "");
      let body = `<div class="bubble">${primaryText || "暂无内容"}</div>`;

      if (mode === "translation" && translationText) {
        body += `<div class="bubble bubble--secondary">${translationText}</div>`;
      } else if (mode === "polish" && polishedText) {
        body += `<div class="bubble bubble--secondary">${polishedText}</div>`;
      }

      return `
        <article class="transcript-item" data-index="${index}" data-start="${item.start}">
          <div class="speaker-row">
            <span class="avatar" style="background:${avatar.color}">${avatar.label}</span>
            <span>${speakerLabel}</span>
            <span>${formatTime(item.start / 1000)}</span>
          </div>
          ${body}
        </article>
      `;
    })
    .join("");

  els.transcript.querySelectorAll(".transcript-item").forEach((node) => {
    node.addEventListener("click", () => {
      seekTo(Number(node.dataset.start) / 1000);
    });
  });
}

function renderTimeline() {
  const durationMs = getDurationMs();
  const chapters = state.bundle.chapters || [];
  const segments = chapters.length
    ? chapters
    : [
        {
          start: 0,
          end: durationMs,
          headline: "完整录音",
          summary: "当前录音未生成章节，时间轴按完整录音展示。",
        },
      ];

  els.timelineSegments.innerHTML = segments
    .map((segment, index) => {
      const left = durationMs ? (segment.start / durationMs) * 100 : 0;
      const width = durationMs
        ? Math.max(1.2, ((segment.end - segment.start) / durationMs) * 100)
        : 100;
      return `
        <span
          class="timeline-segment"
          data-index="${index}"
          style="left:${left}%;width:${width}%"
        ></span>
      `;
    })
    .join("");

  updateTimelineProgress();
}

function renderRightPanel() {
  renderKeywords();
  renderSummary();
  renderChapters();
  renderSpeakerSummaries();
  renderQaCards();
}

function renderKeywords() {
  const keywords = state.bundle.keywords || [];
  els.keywordList.innerHTML = keywords.length
    ? keywords.map((keyword) => `<span class="keyword-chip">${escapeHtml(keyword)}</span>`).join("")
    : `<span class="keyword-chip">暂无关键词</span>`;

  requestAnimationFrame(() => {
    state.keywordOverflow = els.keywordList.scrollHeight > 38;
    els.keywordToggle.classList.toggle("is-hidden", !state.keywordOverflow);
    els.keywordList.classList.toggle("is-collapsed", !state.keywordExpanded);
    els.keywordList.classList.toggle("is-expanded", state.keywordExpanded);
    els.keywordToggle.textContent = state.keywordExpanded ? "收起" : "展开全部";
  });
}

function renderSummary() {
  els.summaryContent.innerHTML = renderStructuredSummary(state.bundle.paragraphSummary);
}

function renderChapters() {
  const chapters = state.bundle.chapters || [];
  els.chaptersList.innerHTML = chapters
    .map(
      (chapter) => `
        <article class="chapter-card" data-start="${chapter.start}">
          <div class="chapter-card__meta">${formatTime(chapter.start / 1000)} - ${formatTime(chapter.end / 1000)}</div>
          <h4>${escapeHtml(chapter.headline || "未命名章节")}</h4>
          <p>${escapeHtml(chapter.summary || "")}</p>
        </article>
      `,
    )
    .join("");

  els.chaptersList.querySelectorAll(".chapter-card").forEach((node) => {
    node.addEventListener("click", () => {
      seekTo(Number(node.dataset.start) / 1000);
    });
  });
}

function renderSpeakerSummaries() {
  const items = state.bundle.conversationalSummary || [];
  els.speakerSummaryList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="info-card">
              <div class="info-card__meta">${escapeHtml(getSpeakerDisplayName(item.speakerName || speakerRawLabel(item.speakerId || "")))}</div>
              <h4>${escapeHtml(getSpeakerDisplayName(item.speakerName || speakerRawLabel(item.speakerId || "")))}</h4>
              <p>${escapeHtml(item.summary || "")}</p>
            </article>
          `,
        )
        .join("")
    : emptyCard("暂无发言总结");
}

function renderQaCards() {
  const items = state.bundle.questionsAnsweringSummary || [];
  els.qaList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="info-card">
              <div class="info-card__meta">问题</div>
              <h4>${escapeHtml(item.question || "")}</h4>
              <p>${escapeHtml(item.answer || "")}</p>
            </article>
          `,
        )
        .join("")
    : emptyCard("暂无要点回顾");
}

function renderAudio() {
  const playbackUrl = state.bundle.media?.playbackUrl;
  els.audio.src = playbackUrl ? viewerApiPath(playbackUrl) : "";
  els.audio.load();
  els.audio.playbackRate = Number(els.speedSelect.value);
  state.pendingSeekSeconds = null;
  syncAudioUi();
}

function syncAudioUi() {
  const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : 0;
  const currentTime = els.audio.currentTime || 0;
  els.currentTime.textContent = formatTime(currentTime);
  els.duration.textContent = formatTime(duration);
  highlightActiveTranscript(currentTime);
  updateTimelineProgress();
}

function updatePlayButton() {
  els.playButton.textContent = els.audio.paused ? "▶" : "❚❚";
}

function togglePlayback() {
  if (!els.audio.src) {
    return;
  }
  if (els.audio.paused) {
    els.audio.play();
  } else {
    els.audio.pause();
  }
}

function seekTo(seconds, options = {}) {
  if (!els.audio.src) {
    return;
  }
  const { forcePlay = false } = options;
  const shouldResume = forcePlay || !els.audio.paused;
  const safeSeconds = Math.max(0, seconds);
  if (els.audio.readyState < 1) {
    state.pendingSeekSeconds = safeSeconds;
    highlightActiveTranscript(safeSeconds);
    updateTimelineProgressFromSeconds(safeSeconds);
    return;
  }

  els.audio.currentTime = safeSeconds;
  state.pendingSeekSeconds = null;
  if (shouldResume) {
    els.audio.play().catch(() => undefined);
  } else {
    els.audio.pause();
  }
  syncAudioUi();
}

function highlightActiveTranscript(currentTime) {
  const currentMs = currentTime * 1000;
  const items = Array.from(els.transcript.querySelectorAll(".transcript-item"));
  let activeNode = null;
  let activeIndex = -1;
  items.forEach((node, index) => {
    const item = state.transcriptItems[index];
    const isActive = item && currentMs >= item.start && currentMs <= item.end;
    node.classList.toggle("is-active", isActive);
    if (isActive) {
      activeNode = node;
      activeIndex = index;
    }
  });

  if (activeIndex === state.activeTranscriptIndex) {
    return;
  }

  state.activeTranscriptIndex = activeIndex;
  if (activeNode) {
    activeNode.scrollIntoView({ block: "nearest", behavior: "auto" });
  }
}

function updateTimelineProgress() {
  updateTimelineProgressFromSeconds(els.audio.currentTime || 0);
}

function updateTimelineProgressFromSeconds(currentSeconds) {
  const durationMs = getDurationMs();
  const currentMs = currentSeconds * 1000;
  const progress = durationMs ? Math.min(100, (currentMs / durationMs) * 100) : 0;
  els.timelineProgress.style.width = `${progress}%`;
  els.timelineThumb.style.left = `${progress}%`;
  els.timelineRange.value = String(Math.round(progress * 10));

  const segments = Array.from(els.timelineSegments.querySelectorAll(".timeline-segment"));
  const activeIndex = getChapterIndexByMs(currentMs);
  segments.forEach((segment, index) => {
    segment.classList.toggle("is-active", index === activeIndex);
  });
}

function onTimelineKeyDown(event) {
  const durationMs = getDurationMs();
  if (!durationMs) {
    return;
  }
  const stepSeconds = event.shiftKey ? 15 : 5;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekTo(Math.max(0, (els.audio.currentTime || 0) - stepSeconds));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seekTo(Math.min(durationMs / 1000, (els.audio.currentTime || 0) + stepSeconds));
  }
}

function onTimelineRangeInput() {
  const durationMs = getDurationMs();
  if (!durationMs) {
    return;
  }
  const ratio = Number(els.timelineRange.value) / 1000;
  const seconds = (durationMs * ratio) / 1000;
  seekTo(seconds);
  showTimelineTooltip(ratio, seconds * 1000);
}

function onTimelineRangeHover(event) {
  showTimelineTooltipAtEvent(event);
}

function onTimelineRangeTouch(event) {
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  event.preventDefault();
  showTimelineTooltipAtEvent(touch);
}

function seekTimelineByClientX(clientX) {
  const durationMs = getDurationMs();
  if (!durationMs) {
    return;
  }
  const rect = els.timeline.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const seconds = (durationMs * ratio) / 1000;
  seekTo(seconds);
  showTimelineTooltip(ratio, seconds * 1000);
}

function showTimelineTooltipAtEvent(event) {
  const durationMs = getDurationMs();
  if (!durationMs) {
    return;
  }
  const rect = els.timeline.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  showTimelineTooltip(ratio, durationMs * ratio);
}

function showTimelineTooltip(ratio, currentMs) {
  const chapter = getChapterByMs(currentMs);
  const leftPercent = ratio * 100;
  const title = chapter?.headline || "当前时间点";
  const summary =
    chapter?.summary || "拖动时间轴可跳转到录音中对应的内容位置。";
  els.timelineTooltip.innerHTML = `
    <div class="timeline-tooltip__time">${formatTime(currentMs / 1000)}</div>
    <h4 class="timeline-tooltip__title">${escapeHtml(title)}</h4>
    <p class="timeline-tooltip__summary">${escapeHtml(summary)}</p>
  `;
  els.timelineTooltip.style.left = `calc(${leftPercent}% - 36px)`;
  els.timelineTooltip.classList.remove("is-hidden");
}

function hideTimelineTooltip() {
  els.timelineTooltip.classList.add("is-hidden");
}

function applyPendingSeek() {
  if (state.pendingSeekSeconds == null) {
    return;
  }
  const seconds = state.pendingSeekSeconds;
  state.pendingSeekSeconds = null;
  seekTo(seconds);
}

function renderMindmap() {
  const root = {
    title: "智能纪要",
    topic: state.bundle.mindMapSummary || [],
  };
  const nodes = [];
  const links = [];
  let leafIndex = 0;

  function traverse(node, depth, parent = null) {
    const children = node.topic || [];
    if (!children.length) {
      node.x = leafIndex * 94 + 80;
      leafIndex += 1;
    } else {
      children.forEach((child) => traverse(child, depth + 1, node));
      node.x =
        children.reduce((sum, child) => sum + child.x, 0) / Math.max(children.length, 1);
    }
    node.y = depth * 255 + 70;
    nodes.push(node);
    if (parent) {
      links.push({ source: parent, target: node });
    }
  }

  traverse(root, 0);

  const width = Math.max(1100, Math.max(...nodes.map((node) => node.y), 0) + 320);
  const height = Math.max(640, Math.max(...nodes.map((node) => node.x), 0) + 120);

  const linkSvg = links
    .map((link) => {
      const midY = (link.source.y + link.target.y) / 2;
      return `
        <path
          class="mindmap-link"
          d="M ${link.source.y},${link.source.x} C ${midY},${link.source.x} ${midY},${link.target.x} ${link.target.y},${link.target.x}"
        />
      `;
    })
    .join("");

  const nodeSvg = nodes
    .map((node) => {
      const classNames = [
        "mindmap-node",
        node === root ? "is-root" : "",
        !(node.topic || []).length ? "is-leaf" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const clickable = node.beginTime ? `data-start="${node.beginTime}"` : "";
      const textOffset = node === root ? -14 : 16;
      const anchor = node === root ? "end" : "start";
      return `
        <g class="${classNames}" ${clickable} transform="translate(${node.y}, ${node.x})">
          <circle r="${node === root ? 10 : 8}"></circle>
          <text x="${textOffset}" y="5" text-anchor="${anchor}">${escapeHtml(node.title || "")}</text>
        </g>
      `;
    })
    .join("");

  els.mindmapCanvas.innerHTML = `
    <svg class="mindmap-svg" viewBox="0 0 ${width} ${height}">
      <g id="mindmapScene">
        ${linkSvg}
        ${nodeSvg}
      </g>
    </svg>
  `;

  els.mindmapCanvas.querySelectorAll("[data-start]").forEach((node) => {
    node.style.cursor = "pointer";
    node.addEventListener("click", () => {
      if (state.mindmapPan.moved) {
        return;
      }
      seekTo(Number(node.dataset.start) / 1000);
      setActiveTab(els.mainTabs, "overview", ".tab", ".view", "data-view");
      setActiveTab(
        els.overviewTabs,
        "chapters",
        ".subtab",
        ".subview",
        "data-subview",
      );
    });
  });

  applyMindmapZoom();
}

function applyMindmapZoom() {
  const svg = els.mindmapCanvas.querySelector("svg");
  if (!svg) {
    return;
  }
  svg.style.transform = `scale(${state.zoom})`;
  svg.style.transformOrigin = "top left";
}

function onMindmapPointerDown(event) {
  if (event.target.closest("[data-start]")) {
    state.mindmapPan.dragging = true;
    state.mindmapPan.moved = false;
    state.mindmapPan.x = event.clientX;
    state.mindmapPan.y = event.clientY;
    state.mindmapPan.startLeft = els.mindmapCanvas.scrollLeft;
    state.mindmapPan.startTop = els.mindmapCanvas.scrollTop;
    els.mindmapCanvas.classList.add("is-dragging");
    els.mindmapCanvas.setPointerCapture?.(event.pointerId);
    return;
  }

  state.mindmapPan.dragging = true;
  state.mindmapPan.moved = false;
  state.mindmapPan.x = event.clientX;
  state.mindmapPan.y = event.clientY;
  state.mindmapPan.startLeft = els.mindmapCanvas.scrollLeft;
  state.mindmapPan.startTop = els.mindmapCanvas.scrollTop;
  els.mindmapCanvas.classList.add("is-dragging");
  els.mindmapCanvas.setPointerCapture?.(event.pointerId);
}

function onMindmapPointerMove(event) {
  if (!state.mindmapPan.dragging) {
    return;
  }
  const deltaX = event.clientX - state.mindmapPan.x;
  const deltaY = event.clientY - state.mindmapPan.y;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    state.mindmapPan.moved = true;
  }
  els.mindmapCanvas.scrollLeft = state.mindmapPan.startLeft - deltaX;
  els.mindmapCanvas.scrollTop = state.mindmapPan.startTop - deltaY;
}

function onMindmapPointerUp() {
  if (!state.mindmapPan.dragging) {
    return;
  }
  setTimeout(() => {
    state.mindmapPan.moved = false;
  }, 0);
  state.mindmapPan.dragging = false;
  els.mindmapCanvas.classList.remove("is-dragging");
}

function setActiveTab(tabRoot, activeName, buttonSelector, panelSelector, panelAttr) {
  tabRoot.querySelectorAll(buttonSelector).forEach((button) => {
    const buttonName = button.dataset.tab || button.dataset.subtab;
    button.classList.toggle("is-active", buttonName === activeName);
  });

  const panelRoot = tabRoot.closest(".panel");
  panelRoot.querySelectorAll(panelSelector).forEach((panel) => {
    const isActive = panel.getAttribute(panelAttr) === activeName;
    panel.classList.toggle("is-active", isActive);
    if (isActive && "scrollTop" in panel) {
      panel.scrollTop = 0;
    }
  });
}

function renderStructuredSummary(content) {
  if (!content) {
    return '<div class="summary-layout"><p class="summary-plain">暂无摘要内容</p></div>';
  }

  const cleaned = content.replaceAll("@#", "").trim();
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const intro = [];
  const sections = [];
  let currentSection = null;

  lines.forEach((line) => {
    if (line.startsWith("- **")) {
      const heading = parseSummaryHeading(line);
      currentSection = { ...heading, points: [] };
      sections.push(currentSection);
      return;
    }

    if (currentSection && /^\d+\./.test(line)) {
      currentSection.points.push(line.replace(/^\d+\./, "").trim());
      return;
    }

    if (currentSection) {
      currentSection.points.push(line);
      return;
    }

    intro.push(line);
  });

  const introHtml = intro.length
    ? `<p class="summary-intro">${escapeHtml(intro.join(" "))}</p>`
    : "";

  const sectionsHtml = sections.length
    ? `
      <div class="summary-sections">
        ${sections
          .map(
            (section) => `
              <section class="summary-card">
                <div class="summary-card__header">
                  <h4 class="summary-card__title">${escapeHtml(section.title)}</h4>
                  ${section.range ? `<span class="summary-card__range">${escapeHtml(section.range)}</span>` : ""}
                </div>
                <div class="summary-points">
                  ${section.points
                    .map(
                      (point) =>
                        `<div class="summary-point">${formatInlineSummaryText(point)}</div>`,
                    )
                    .join("")}
                </div>
              </section>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  if (!introHtml && !sectionsHtml) {
    return `<div class="summary-layout"><p class="summary-plain">${escapeHtml(cleaned)}</p></div>`;
  }

  return `<div class="summary-layout">${introHtml}${sectionsHtml}</div>`;
}

function renderProfileView() {
  els.profileScenario.value = state.profileScenario;
  renderSpeakerAliasPanel();
  renderProfileResult();
}

function setWorkspaceLayout(mode) {
  state.layoutMode = mode;
  renderWorkspaceLayout();
}

function onSplitterPointerDown(event) {
  if (window.innerWidth <= 1100) {
    return;
  }
  state.layoutMode = "both";
  state.splitterDrag.active = true;
  state.splitterDrag.pointerId = event.pointerId;
  els.splitter.classList.add("is-dragging");
  els.splitterHandle.setPointerCapture?.(event.pointerId);
  updateSplitterRatio(event.clientX);
  renderWorkspaceLayout();
}

function onSplitterPointerMove(event) {
  if (!state.splitterDrag.active) {
    return;
  }
  updateSplitterRatio(event.clientX);
}

function onSplitterPointerUp(event) {
  if (!state.splitterDrag.active) {
    return;
  }
  if (state.splitterDrag.pointerId !== null && event.pointerId !== undefined && state.splitterDrag.pointerId !== event.pointerId) {
    return;
  }
  state.splitterDrag.active = false;
  state.splitterDrag.pointerId = null;
  els.splitter.classList.remove("is-dragging");
}

function updateSplitterRatio(clientX) {
  const rect = els.workspace.getBoundingClientRect();
  const splitterWidth = els.splitter.offsetWidth + 14;
  const usableWidth = rect.width - splitterWidth;
  if (usableWidth <= 0) {
    return;
  }
  const relative = clamp((clientX - rect.left) / usableWidth, 0.24, 0.76);
  state.leftPanelRatio = relative;
  els.workspace.style.setProperty("--left-panel-width", `${relative * 100}%`);
}

function renderSpeakerAliasPanel() {
  const speakerLabels = state.bundle?.speakerLabels || [];
  if (!state.selectedSpeakerKey && speakerLabels.length > 0) {
    state.selectedSpeakerKey = speakerLabels[0];
  }

  els.profileSpeakerList.innerHTML = speakerLabels.length
    ? speakerLabels
        .map((speaker) => {
          const alias = getSpeakerDisplayName(speaker);
          const selected = state.selectedSpeakerKey === speaker ? "is-active" : "";
          return `
            <button class="speaker-chip ${selected}" data-speaker="${speaker}" type="button">
              ${escapeHtml(speaker)}
              ${alias !== speaker ? `<span class="speaker-chip__alias">→ ${escapeHtml(alias)}</span>` : ""}
            </button>
          `;
        })
        .join("")
    : `<div class="helper-text">当前任务没有可编辑的发言人。</div>`;

  els.profileSpeakerList.querySelectorAll("[data-speaker]").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedSpeakerKey = node.dataset.speaker;
      els.speakerAliasInput.value = getStoredAlias(node.dataset.speaker) || "";
      renderSpeakerAliasPanel();
    });
  });

  els.speakerAliasInput.value = getStoredAlias(state.selectedSpeakerKey) || "";
  renderGlobalAliasList();
}

function renderGlobalAliasList() {
  const entries = Object.entries(state.globalSpeakerAliases);
  els.globalAliasList.innerHTML = entries.length
    ? entries
        .map(
          ([raw, alias]) =>
            `<span class="global-alias-pill">${escapeHtml(raw)} → ${escapeHtml(alias)}</span>`,
        )
        .join("")
    : `<span class="helper-text">暂无全局发言人映射。</span>`;
}

function renderProfileResult() {
  if (!state.profileResult) {
    els.profilePrompt.textContent = "选择场景后点击“生成画像 md”，这里会展示用于和大模型交互的提示词。";
    els.profileMarkdown.innerHTML = "生成后的结构化画像会显示在这里，并同步写入 md 文件。";
    els.profileOpenLink.classList.add("is-hidden");
    els.profileOpenLink.removeAttribute("href");
    els.analyzeProfileButton.textContent = state.profileBusy ? "生成中..." : "生成画像 md";
    return;
  }

  els.profilePrompt.textContent = state.profileResult.prompt;
  els.profileMarkdown.innerHTML = renderProfileMarkdown(state.profileResult.markdown);
  els.profileOpenLink.href = viewerApiPath(state.profileResult.markdownUrl);
  els.profileOpenLink.classList.remove("is-hidden");
  els.analyzeProfileButton.textContent = state.profileBusy ? "生成中..." : "生成画像 md";
}

async function analyzeProfile() {
  if (!state.bundle) {
    return;
  }

  state.profileBusy = true;
  renderProfileResult();

  try {
    const response = await fetch(viewerApiPath(`/api/task/${state.bundle.id}/profile-analysis`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scenario: state.profileScenario,
        speaker_aliases: getMergedSpeakerAliases(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "画像分析失败");
    }
    state.profileResult = payload;
  } catch (error) {
    state.profileResult = {
      prompt: "生成失败",
      markdown: `# 画像分析失败\n\n- 错误信息：${(error).message || "未知错误"}`,
      markdownUrl: "#",
    };
  } finally {
    state.profileBusy = false;
    renderProfileResult();
  }
}

function applyTaskSpeakerAlias() {
  const speaker = state.selectedSpeakerKey;
  const alias = els.speakerAliasInput.value.trim();
  if (!speaker || !alias) {
    return;
  }
  state.taskSpeakerAliases[speaker] = alias;
  saveJsonStorage(taskAliasStorageKey(state.bundle.id), state.taskSpeakerAliases);
  state.profileResult = null;
  renderTranscript();
  renderSpeakerSummaries();
  renderSpeakerAliasPanel();
  renderProfileResult();
}

function applyGlobalSpeakerAlias() {
  const speaker = state.selectedSpeakerKey;
  const alias = els.speakerAliasInput.value.trim();
  if (!speaker || !alias) {
    return;
  }
  state.taskSpeakerAliases[speaker] = alias;
  state.globalSpeakerAliases[speaker] = alias;
  saveJsonStorage(taskAliasStorageKey(state.bundle.id), state.taskSpeakerAliases);
  saveJsonStorage(GLOBAL_ALIAS_STORAGE_KEY, state.globalSpeakerAliases);
  state.profileResult = null;
  renderTranscript();
  renderSpeakerSummaries();
  renderSpeakerAliasPanel();
  renderProfileResult();
}

function parseSummaryHeading(line) {
  const match = line.match(/^- \*\*(.+?)\*\*\s*$/);
  const content = match ? match[1] : line.replace(/^- /, "");
  const rangeMatch = content.match(/^(.*?)(\[\d+-\d+\])$/);
  if (!rangeMatch) {
    return { title: content, range: "" };
  }
  return {
    title: rangeMatch[1].trim(),
    range: rangeMatch[2],
  };
}

function formatInlineSummaryText(text) {
  return escapeHtml(text).replace(
    /\*\*(.+?)\*\*/g,
    "<strong>$1</strong>",
  );
}

function updateTaskQuery(taskId) {
  const url = new URL(window.location.href);
  url.searchParams.set("task", taskId);
  window.history.replaceState({}, "", url);
}

function renderProfileMarkdown(markdown) {
  const lines = String(markdown || "").split("\n");
  const html = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (inList) {
    html.push("</ul>");
  }

  return html.join("");
}

function toggleKeywords() {
  if (!state.keywordOverflow) {
    return;
  }
  state.keywordExpanded = !state.keywordExpanded;
  els.keywordList.classList.toggle("is-collapsed", !state.keywordExpanded);
  els.keywordList.classList.toggle("is-expanded", state.keywordExpanded);
  els.keywordToggle.textContent = state.keywordExpanded ? "收起" : "展开全部";
}

function getDurationMs() {
  const fromData = Number(state.bundle?.audioInfo?.duration || 0);
  const fromAudio = Number.isFinite(els.audio.duration) ? els.audio.duration * 1000 : 0;
  return fromData || fromAudio || 0;
}

function getChapterByMs(currentMs) {
  return (state.bundle?.chapters || []).find(
    (chapter) => currentMs >= chapter.start && currentMs <= chapter.end,
  );
}

function getChapterIndexByMs(currentMs) {
  return (state.bundle?.chapters || []).findIndex(
    (chapter) => currentMs >= chapter.start && currentMs <= chapter.end,
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function speakerRawLabel(speakerId) {
  return `发言人${speakerId}`;
}

function taskAliasStorageKey(taskId) {
  return `${TASK_ALIAS_STORAGE_PREFIX}${taskId}`;
}

function loadJsonStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveJsonStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getStoredAlias(rawLabel) {
  return state.taskSpeakerAliases[rawLabel] || state.globalSpeakerAliases[rawLabel] || "";
}

function getMergedSpeakerAliases() {
  return { ...state.globalSpeakerAliases, ...state.taskSpeakerAliases };
}

function getSpeakerDisplayName(rawLabel) {
  return getStoredAlias(rawLabel) || rawLabel;
}

function speakerAvatar(speakerId) {
  const palette = [
    { color: "linear-gradient(135deg, #ff7a7a, #ff5a5a)", label: "1" },
    { color: "linear-gradient(135deg, #5b83ff, #6bc0ff)", label: "2" },
    { color: "linear-gradient(135deg, #7d6bff, #b476ff)", label: "3" },
    { color: "linear-gradient(135deg, #2fc7a6, #57dfa2)", label: "4" },
  ];
  return palette[((Number(speakerId) || 1) - 1 + palette.length) % palette.length];
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emptyCard(text) {
  return `<article class="info-card"><p>${escapeHtml(text)}</p></article>`;
}
