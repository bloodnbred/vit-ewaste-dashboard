(() => {
  "use strict";

  const DIVISION_ORDER = ["A", "B", "C"];
  const DIVISION_META = {
    A: { label: "CMPN A", slug: "cmpn-a" },
    B: { label: "CMPN B", slug: "cmpn-b" },
    C: { label: "CMPN C", slug: "cmpn-c" },
  };
  const SLUG_TO_DIVISION = Object.fromEntries(
    Object.entries(DIVISION_META).map(([division, meta]) => [meta.slug, division])
  );
  const DEFAULT_DIVISION = "A";
  const PREVIEW_TIMEOUT_MS = 8000;

  // Verified hosts that always refuse to be framed. The submitted link is kept
  // in full and remains available through "Open in new tab".
  const KNOWN_UNEMBEDDABLE_HOSTS = new Set(["project.seucra.tech"]);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 900px)");
  const numberFormatter = new Intl.NumberFormat("en-IN");

  const rawStudents = Array.isArray(window.STUDENTS) ? window.STUDENTS : [];
  const rawDivisions =
    window.DIVISIONS && typeof window.DIVISIONS === "object" ? window.DIVISIONS : {};

  const students = rawStudents
    .map((student, index) => {
      const roll = String(student.roll ?? "").trim().toUpperCase();
      const name = String(student.name ?? "").trim().replace(/\s+/g, " ");
      const mappedDivision = rawDivisions[roll];
      const candidateDivision = String(mappedDivision ?? student.division ?? "")
        .trim()
        .toUpperCase();
      const division = DIVISION_ORDER.includes(candidateDivision) ? candidateDivision : "";
      const link = String(student.link ?? "").trim();

      return {
        roll,
        name,
        division,
        link,
        hasLink: isValidHttpUrl(link),
        sourceIndex: index,
      };
    })
    .filter((student) => student.roll && student.name && student.division)
    .sort((a, b) => a.sourceIndex - b.sourceIndex);

  const studentsByRoll = new Map(students.map((student) => [student.roll, student]));
  const studentsByDivision = new Map(
    DIVISION_ORDER.map((division) => [
      division,
      students.filter((student) => student.division === division),
    ])
  );

  const state = {
    division: DEFAULT_DIVISION,
    search: "",
    selectedRoll: null,
  };

  const elements = {
    header: document.getElementById("site-header"),
    navToggle: document.getElementById("nav-toggle"),
    navMenu: document.getElementById("primary-menu"),
    navLinks: Array.from(document.querySelectorAll(".nav-link")),
    tabs: document.getElementById("division-tabs"),
    panel: document.getElementById("division-panel"),
    search: document.getElementById("student-search"),
    searchClear: document.getElementById("search-clear"),
    quickJump: document.getElementById("quick-jump"),
    quickOpen: document.getElementById("quick-open"),
    listHeading: document.getElementById("student-list-heading"),
    listCount: document.getElementById("list-count"),
    list: document.getElementById("student-list"),
    listEmpty: document.getElementById("list-empty"),
    emptyClear: document.getElementById("empty-clear"),
    viewer: document.getElementById("viewer"),
    viewerBody: document.getElementById("viewer-body"),
    viewerStatus: document.getElementById("viewer-status"),
    toast: document.getElementById("toast"),
    projects: document.getElementById("projects"),
    about: document.getElementById("about"),
    home: document.getElementById("home"),
    statStudents: document.getElementById("stat-students"),
    statStudentsSub: document.getElementById("stat-students-sub"),
    statDivisions: document.getElementById("stat-divisions"),
    statLive: document.getElementById("stat-live"),
    statLiveSub: document.getElementById("stat-live-sub"),
    statSubmitted: document.getElementById("stat-submitted"),
    statSubmittedLabel: document.getElementById("stat-submitted-label"),
    statSubmittedSub: document.getElementById("stat-submitted-sub"),
  };

  const tabButtons = new Map();
  let previewTimer = null;
  let previewToken = 0;
  let toastTimer = null;
  let scrollTicking = false;

  /* ---------- Helpers ---------- */

  function isValidHttpUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatCount(value) {
    return numberFormatter.format(value);
  }

  function normalizeRoll(value) {
    const upper = String(value ?? "").trim().toUpperCase();
    // Tolerate old links containing the 9-character source roll.
    if (/^\d{5}[A-Z]\d{3}$/.test(upper)) {
      return `${upper.slice(0, -3)}0${upper.slice(-3)}`;
    }
    return upper;
  }

  function getStudent(roll) {
    return studentsByRoll.get(normalizeRoll(roll)) ?? null;
  }

  function getDivisionStudents(division) {
    return studentsByDivision.get(division) ?? [];
  }

  function getSelectedStudent() {
    return state.selectedRoll ? getStudent(state.selectedRoll) : null;
  }

  function getFilteredStudents() {
    const query = state.search.trim().toLowerCase();
    const divisionStudents = getDivisionStudents(state.division);

    if (!query) return divisionStudents;

    return divisionStudents.filter(
      (student) =>
        student.name.toLowerCase().includes(query) ||
        student.roll.toLowerCase().includes(query)
    );
  }

  function parseHash() {
    const rawHash = window.location.hash.replace(/^#/, "").trim();
    if (!rawHash) return { division: null, roll: null };

    const parts = rawHash.split("/");
    const slug = (parts[0] ?? "").toLowerCase();
    const division =
      SLUG_TO_DIVISION[slug] ??
      (/^[abc]$/.test(slug) ? slug.toUpperCase() : null);

    let roll = parts.slice(1).join("/").trim();
    if (roll) {
      try {
        roll = decodeURIComponent(roll);
      } catch {
        // Keep the raw roll if it cannot be decoded.
      }
      roll = normalizeRoll(roll) || null;
    }

    return { division, roll };
  }

  function writeHash(division, roll) {
    if (!DIVISION_META[division]) return;

    const hash = roll
      ? `#${DIVISION_META[division].slug}/${encodeURIComponent(roll)}`
      : `#${DIVISION_META[division].slug}`;

    if (window.location.hash === hash) return;

    try {
      window.history.replaceState(null, "", hash);
    } catch {
      window.location.hash = hash;
    }
  }

  /* ---------- Statistics ---------- */

  function renderStats() {
    const total = students.length;
    const live = students.filter((student) => student.hasLink).length;
    const divisionCount = new Set(students.map((student) => student.division)).size;
    const percent = total > 0 ? Math.round((live / total) * 100) : 0;

    elements.statStudents.textContent = formatCount(total);
    elements.statDivisions.textContent = formatCount(divisionCount);
    elements.statLive.textContent = formatCount(live);

    elements.statStudentsSub.textContent =
      divisionCount === 1 ? "in one division" : `across ${divisionCount} divisions`;
    elements.statLiveSub.textContent = `${formatCount(live)} submitted by students`;

    if (total > 0 && live === total) {
      elements.statSubmitted.textContent = "100%";
      elements.statSubmittedLabel.textContent = "Live & Deployed";
      elements.statSubmittedSub.textContent = "every student submitted a link";
    } else {
      elements.statSubmitted.textContent = `${percent}%`;
      elements.statSubmittedLabel.textContent = "Dashboards Submitted";
      elements.statSubmittedSub.textContent = `${formatCount(live)} of ${formatCount(total)} students`;
    }
  }

  /* ---------- Division tabs ---------- */

  function buildTabs() {
    elements.tabs.replaceChildren();
    tabButtons.clear();

    for (const division of DIVISION_ORDER) {
      const divisionStudents = getDivisionStudents(division);
      const live = divisionStudents.filter((student) => student.hasLink).length;
      const meta = DIVISION_META[division];

      const button = document.createElement("button");
      button.type = "button";
      button.className = "division-tab";
      button.id = `tab-${division}`;
      button.dataset.division = division;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(division === state.division));
      button.setAttribute("aria-controls", "division-panel");
      button.setAttribute(
        "aria-label",
        `${meta.label}, ${divisionStudents.length} students, ${live} live dashboards`
      );
      button.tabIndex = division === state.division ? 0 : -1;

      button.append(
        el("span", "division-tab-name", meta.label),
        el(
          "span",
          "division-tab-count",
          `${divisionStudents.length} students · ${live} live`
        )
      );

      button.addEventListener("click", () => activateDivision(division));
      button.addEventListener("keydown", onTabKeydown);

      elements.tabs.append(button);
      tabButtons.set(division, button);
    }
  }

  function onTabKeydown(event) {
    const current = event.currentTarget.dataset.division;
    const index = DIVISION_ORDER.indexOf(current);
    let nextIndex = null;

    if (event.key === "ArrowRight") nextIndex = (index + 1) % DIVISION_ORDER.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + DIVISION_ORDER.length) % DIVISION_ORDER.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DIVISION_ORDER.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();

    const nextDivision = DIVISION_ORDER[nextIndex];
    activateDivision(nextDivision);
    tabButtons.get(nextDivision)?.focus();
  }

  function updateTabSelection() {
    for (const [division, button] of tabButtons) {
      const selected = division === state.division;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    elements.panel.setAttribute("aria-labelledby", `tab-${state.division}`);
  }

  function activateDivision(division, options = {}) {
    const { updateHash = true, force = false } = options;
    if (!DIVISION_META[division]) return;

    if (!force && division === state.division) {
      return;
    }

    state.division = division;
    state.search = "";
    state.selectedRoll = null;
    elements.search.value = "";
    elements.searchClear.hidden = true;
    elements.quickJump.value = "";
    elements.quickOpen.disabled = true;

    updateTabSelection();
    elements.list.scrollTop = 0;
    elements.listHeading.textContent = DIVISION_META[division].label;
    elements.search.placeholder = `Search ${DIVISION_META[division].label} by name or roll no…`;

    populateQuickJump();
    renderList();
    showEmptyViewer();

    if (updateHash) writeHash(division, null);

    elements.viewerStatus.textContent = `${DIVISION_META[division].label} selected.`;
  }

  /* ---------- Student list ---------- */

  function makeStatusPill(hasLink) {
    const pill = el(
      "span",
      `status-pill ${hasLink ? "status-live" : "status-pending"}`
    );
    const dot = el("span", "status-dot");
    dot.setAttribute("aria-hidden", "true");
    pill.append(dot, document.createTextNode(hasLink ? "Live" : "Link not uploaded"));
    return pill;
  }

  function makeStudentCard(student) {
    const item = el("li", "student-item");
    const button = el(
      "button",
      `student-card${student.hasLink ? "" : " is-pending"}${
        state.selectedRoll === student.roll ? " is-selected" : ""
      }`
    );

    button.type = "button";
    button.dataset.roll = student.roll;
    button.setAttribute("aria-pressed", String(state.selectedRoll === student.roll));
    button.setAttribute(
      "aria-label",
      `${student.name}, roll number ${student.roll}, ${
        student.hasLink ? "link uploaded" : "link not uploaded"
      }`
    );

    const avatar = el(
      "span",
      "student-avatar",
      student.name.charAt(0).toUpperCase() || "?"
    );
    avatar.setAttribute("aria-hidden", "true");

    const info = el("span", "student-info");
    info.append(
      el("span", "student-name", student.name),
      el("span", "student-roll", student.roll)
    );

    button.append(avatar, info, makeStatusPill(student.hasLink));
    button.addEventListener("click", () => selectStudent(student.roll));

    item.append(button);
    return item;
  }

  function renderList() {
    const divisionStudents = getDivisionStudents(state.division);
    const filtered = getFilteredStudents();
    const hasSearch = state.search.trim() !== "";
    const fragment = document.createDocumentFragment();

    for (const student of filtered) {
      fragment.append(makeStudentCard(student));
    }

    elements.list.replaceChildren(fragment);
    elements.list.setAttribute(
      "aria-label",
      `Students in ${DIVISION_META[state.division].label}`
    );

    if (hasSearch) {
      elements.listCount.textContent = `${formatCount(filtered.length)} of ${formatCount(
        divisionStudents.length
      )} shown`;
    } else {
      elements.listCount.textContent = `${formatCount(divisionStudents.length)} students`;
    }

    const noResults = filtered.length === 0;
    elements.list.hidden = noResults;
    elements.listEmpty.hidden = !noResults;
    elements.searchClear.hidden = !hasSearch;

    if (noResults) {
      const title = elements.listEmpty.querySelector("h3");
      const copy = elements.listEmpty.querySelector("p");
      if (divisionStudents.length === 0) {
        title.textContent = "No students yet";
        copy.textContent = "Students added to this division will appear here.";
        elements.emptyClear.hidden = true;
      } else {
        title.textContent = "No matches found";
        copy.textContent = "Try a different name or roll number, or clear the search.";
        elements.emptyClear.hidden = false;
      }
    }
  }

  function updateSelectedCards() {
    let selectedCard = null;

    for (const card of elements.list.querySelectorAll(".student-card")) {
      const selected = card.dataset.roll === state.selectedRoll;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      if (selected) selectedCard = card;
    }

    if (selectedCard) scrollSelectedCardIntoView(selectedCard);
  }

  function scrollSelectedCardIntoView(card) {
    const listRect = elements.list.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const padding = 8;

    if (cardRect.top < listRect.top + padding) {
      elements.list.scrollTop -= listRect.top - cardRect.top + padding;
    } else if (cardRect.bottom > listRect.bottom - padding) {
      elements.list.scrollTop += cardRect.bottom - listRect.bottom + padding;
    }
  }

  /* ---------- Quick jump ---------- */

  function populateQuickJump() {
    const options = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a student…";
    options.append(placeholder);

    for (const student of getDivisionStudents(state.division)) {
      const option = document.createElement("option");
      option.value = student.roll;
      option.textContent = `${student.name} · ${student.roll}${
        student.hasLink ? "" : " · Link not uploaded"
      }`;
      options.append(option);
    }

    elements.quickJump.replaceChildren(options);
    elements.quickJump.value = "";
  }

  function syncQuickJump() {
    const selected = getSelectedStudent();
    elements.quickJump.value = selected?.roll ?? "";
    elements.quickOpen.disabled = !selected?.hasLink;
  }

  /* ---------- Viewer ---------- */

  function cancelPreview() {
    previewToken += 1;
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function showEmptyViewer() {
    cancelPreview();
    elements.viewerBody.replaceChildren();

    const wrapper = el("div", "viewer-empty");
    const icon = el("span", "viewer-empty-icon", "🖥️");
    icon.setAttribute("aria-hidden", "true");
    wrapper.append(
      icon,
      el("h3", "", "Select a student"),
      el(
        "p",
        "",
        "Choose a student card or use Quick Jump to preview their deployed dashboard here."
      )
    );

    elements.viewerBody.append(wrapper);
    elements.viewerStatus.textContent = "No student selected.";
  }

  function makeViewerHeader(student) {
    const header = el("div", "viewer-header");
    const tags = el("div", "viewer-tags");
    tags.append(
      el("span", "viewer-chip", DIVISION_META[student.division].label),
      el(
        "span",
        `viewer-chip ${student.hasLink ? "is-live" : "is-muted"}`,
        student.hasLink ? "Link uploaded" : "Link not uploaded"
      )
    );

    const name = el("h2", "viewer-name", student.name);
    const roll = el("p", "viewer-roll", `Roll No. ${student.roll}`);

    header.append(tags, name, roll);
    return header;
  }

  function makeViewerLinkRow(student) {
    const row = el("div", "viewer-link-row");
    const box = el("div", "viewer-link-box");
    box.append(
      el("p", "viewer-link-label", "Dashboard link"),
      el("code", "viewer-url", student.link)
    );

    const actions = el("div", "viewer-link-actions");
    const openLink = el("a", "btn btn-primary btn-small", "Open in new tab ↗");
    openLink.href = student.link;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.setAttribute("aria-label", `Open ${student.name}'s dashboard in a new tab`);

    const copyButton = el("button", "btn btn-outline btn-small", "Copy link");
    copyButton.type = "button";
    copyButton.setAttribute("aria-label", `Copy dashboard link for ${student.name}`);
    copyButton.addEventListener("click", async () => {
      const copied = await copyText(student.link);
      if (copied) {
        copyButton.textContent = "Copied ✓";
        showToast("Dashboard link copied.");
        window.setTimeout(() => {
          copyButton.textContent = "Copy link";
        }, 2200);
      } else {
        showToast("Could not copy — select the link text above instead.");
      }
    });

    actions.append(openLink, copyButton);
    row.append(box, actions);
    return row;
  }

  function makeFallback(student, heading, message) {
    const fallback = el("div", "preview-fallback");
    fallback.hidden = true;

    const icon = el("span", "preview-fallback-icon", "🌐");
    icon.setAttribute("aria-hidden", "true");
    fallback.append(icon, el("h3", "", heading), el("p", "", message));

    const openLink = el("a", "btn btn-primary btn-small", "Open dashboard in new tab ↗");
    openLink.href = student.link;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    fallback.append(openLink);

    return fallback;
  }

  function makePreview(student) {
    const preview = el("div", "viewer-preview");
    const iframe = document.createElement("iframe");
    iframe.loading = "lazy";
    iframe.title = `E-waste dashboard for ${student.name}`;
    iframe.setAttribute("allowfullscreen", "");

    const loading = el("div", "preview-loading");
    const spinner = el("span", "spinner");
    spinner.setAttribute("aria-hidden", "true");
    loading.append(spinner, el("p", "", "Loading dashboard…"));

    const fallback = makeFallback(
      student,
      "Preview didn't load",
      "This dashboard may block embedding or require a sign-in. The submitted link is kept above and can always be opened in a new tab."
    );

    preview.append(iframe, loading, fallback);
    return { preview, iframe, loading, fallback };
  }

  function renderViewer(student) {
    cancelPreview();
    elements.viewerBody.replaceChildren();
    elements.viewerBody.append(makeViewerHeader(student));

    if (!student.hasLink) {
      const pending = el("div", "viewer-pending");
      const icon = el("span", "viewer-pending-icon", "📄");
      icon.setAttribute("aria-hidden", "true");
      pending.append(
        icon,
        el("h3", "", "Link not uploaded"),
        el(
          "p",
          "",
          "This student has not uploaded a dashboard link yet. Check back after the next submission."
        )
      );
      elements.viewerBody.append(pending);
      elements.viewerStatus.textContent = `${student.name}, ${DIVISION_META[student.division].label}, link not uploaded.`;
      return;
    }

    elements.viewerBody.append(makeViewerLinkRow(student));

    let parsedUrl;
    try {
      parsedUrl = new URL(student.link);
    } catch {
      parsedUrl = null;
    }

    const insecureOnHttps =
      parsedUrl?.protocol === "http:" && window.location.protocol === "https:";
    const knownBlocked = parsedUrl
      ? KNOWN_UNEMBEDDABLE_HOSTS.has(parsedUrl.hostname.toLowerCase())
      : false;

    const { preview, iframe, loading, fallback } = makePreview(student);
    elements.viewerBody.append(preview);

    const note = el(
      "p",
      "preview-note",
      "Some dashboards require a sign-in or block embedding. The submitted link above always works in a new tab."
    );
    elements.viewerBody.append(note);

    elements.viewerStatus.textContent = `${student.name}, ${DIVISION_META[student.division].label}, dashboard link ready.`;

    if (insecureOnHttps || knownBlocked) {
      loading.hidden = true;
      iframe.hidden = true;
      fallback.hidden = false;

      const fallbackTitle = fallback.querySelector("h3");
      const fallbackCopy = fallback.querySelector("p");
      if (insecureOnHttps) {
        fallbackTitle.textContent = "Preview blocked by this browser";
        fallbackCopy.textContent =
          "This dashboard uses an HTTP link, which browsers block inside a secure HTTPS page. The submitted link is kept and can be opened in a new tab.";
      } else {
        fallbackTitle.textContent = "Sign-in or embedding blocked";
        fallbackCopy.textContent =
          "This host requires an authenticated Cloudflare Access session and refuses to load inside another page. Open the submitted link in a new tab.";
      }
      return;
    }

    const token = ++previewToken;
    let loaded = false;

    const finishLoading = () => {
      if (token !== previewToken || loaded) return;
      loaded = true;
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
      loading.hidden = true;
      fallback.hidden = true;
      iframe.hidden = false;
    };

    iframe.addEventListener("load", () => {
      if (token !== previewToken) return;

      // Ignore the initial about:blank load. A cross-origin exception means the
      // real (remote) document has taken over the frame.
      try {
        const href = iframe.contentWindow?.location?.href;
        if (!href || href === "about:blank") return;
      } catch {
        // Cross-origin dashboard — it loaded.
      }
      finishLoading();
    });

    iframe.addEventListener("error", () => {
      if (token !== previewToken) return;
      loading.hidden = true;
      iframe.hidden = true;
      fallback.hidden = false;
    });

    previewTimer = window.setTimeout(() => {
      if (token !== previewToken || loaded) return;
      loading.hidden = true;
      iframe.hidden = true;
      fallback.hidden = false;
      fallback.querySelector("h3").textContent = "Preview took too long";
      fallback.querySelector("p").textContent =
        "The dashboard did not finish loading in this frame. It may block embedding or require a sign-in — use the link above to open it directly.";
    }, PREVIEW_TIMEOUT_MS);

    iframe.src = student.link;
  }

  /* ---------- Selection and routing ---------- */

  function selectStudent(roll, options = {}) {
    const { updateHash = true, scroll = true } = options;
    const student = getStudent(roll);
    if (!student) return;

    if (student.division !== state.division) {
      activateDivision(student.division, {
        updateHash: false,
        force: true,
      });
    }

    state.selectedRoll = student.roll;
    updateSelectedCards();
    syncQuickJump();
    renderViewer(student);

    if (updateHash) writeHash(student.division, student.roll);

    if (scroll) {
      window.requestAnimationFrame(scrollViewerIntoView);
    }
  }

  function clearSelection(options = {}) {
    const { updateHash = true } = options;
    state.selectedRoll = null;
    updateSelectedCards();
    elements.quickJump.value = "";
    elements.quickOpen.disabled = true;
    showEmptyViewer();

    if (updateHash) writeHash(state.division, null);
  }

  function scrollViewerIntoView() {
    if (!elements.viewer) return;

    elements.viewer.scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      block: mobileQuery.matches ? "start" : "nearest",
    });
  }

  function handleHashChange() {
    const parsed = parseHash();
    if (!parsed.division && !parsed.roll) return;

    if (parsed.roll) {
      const student = getStudent(parsed.roll);
      if (student) {
        selectStudent(student.roll, { updateHash: false, scroll: true });
        return;
      }
    }

    if (parsed.division) {
      if (parsed.division === state.division) {
        if (!parsed.roll && state.selectedRoll) {
          clearSelection({ updateHash: false });
        }
        return;
      }

      activateDivision(parsed.division, {
        updateHash: false,
        force: true,
      });
    }
  }

  /* ---------- Search ---------- */

  function clearSearch() {
    state.search = "";
    elements.search.value = "";
    elements.searchClear.hidden = true;
    renderList();
    elements.search.focus();
  }

  function setupSearch() {
    elements.search.addEventListener("input", () => {
      state.search = elements.search.value;
      elements.searchClear.hidden = state.search.trim() === "";
      renderList();
    });

    elements.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.search.value !== "") {
        event.preventDefault();
        clearSearch();
      }
    });

    elements.searchClear.addEventListener("click", clearSearch);
    elements.emptyClear.addEventListener("click", clearSearch);
  }

  /* ---------- Quick jump events ---------- */

  function setupQuickJump() {
    elements.quickJump.addEventListener("change", () => {
      if (!elements.quickJump.value) {
        clearSelection();
        return;
      }
      selectStudent(elements.quickJump.value);
    });

    elements.quickOpen.addEventListener("click", () => {
      const student = getSelectedStudent();
      if (!student?.hasLink) return;
      window.open(student.link, "_blank", "noopener,noreferrer");
    });
  }

  /* ---------- Clipboard and toast ---------- */

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the older copy method.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    textarea.remove();
    return copied;
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.hidden = false;

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2800);
  }

  /* ---------- Navigation ---------- */

  function closeMobileMenu() {
    elements.navMenu.classList.remove("is-open");
    elements.navToggle.setAttribute("aria-expanded", "false");
  }

  function toggleMobileMenu() {
    const open = !elements.navMenu.classList.contains("is-open");
    elements.navMenu.classList.toggle("is-open", open);
    elements.navToggle.setAttribute("aria-expanded", String(open));
  }

  function setupNavigation() {
    elements.navToggle.addEventListener("click", toggleMobileMenu);

    for (const link of elements.navLinks) {
      link.addEventListener("click", () => {
        closeMobileMenu();
      });
    }

    document.addEventListener("click", (event) => {
      if (!elements.navMenu.classList.contains("is-open")) return;
      if (event.target instanceof Element && event.target.closest(".nav")) return;
      closeMobileMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.navMenu.classList.contains("is-open")) {
        closeMobileMenu();
        elements.navToggle.focus();
      }
    });

    mobileQuery.addEventListener("change", (event) => {
      if (!event.matches) closeMobileMenu();
    });
  }

  function updateNavHighlight() {
    const marker = window.scrollY + (elements.header?.offsetHeight ?? 72) + 120;
    let activeId = "home";

    for (const section of [elements.home, elements.about, elements.projects]) {
      if (!section) continue;
      const top = section.getBoundingClientRect().top + window.scrollY;
      if (top <= marker) activeId = section.id;
    }

    if (
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2
    ) {
      activeId = "projects";
    }

    for (const link of elements.navLinks) {
      const active = link.getAttribute("href") === `#${activeId}`;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  function setupScrollEffects() {
    const onScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(() => {
        scrollTicking = false;
        elements.header?.classList.toggle("is-scrolled", window.scrollY > 4);
        updateNavHighlight();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Initialisation ---------- */

  function init() {
    const initialHash = parseHash();
    const initialStudent = initialHash.roll ? getStudent(initialHash.roll) : null;

    state.division =
      initialStudent?.division ?? initialHash.division ?? DEFAULT_DIVISION;

    renderStats();
    buildTabs();
    setupNavigation();
    setupSearch();
    setupQuickJump();
    setupScrollEffects();

    activateDivision(state.division, {
      updateHash: false,
      force: true,
    });

    if (initialStudent) {
      selectStudent(initialStudent.roll, {
        updateHash: false,
        scroll: true,
      });

      // Canonicalise the URL, including old 9-character roll aliases.
      writeHash(initialStudent.division, initialStudent.roll);
    } else if (initialHash.division) {
      window.requestAnimationFrame(() => {
        elements.projects?.scrollIntoView({
          behavior: reduceMotion.matches ? "auto" : "smooth",
          block: "start",
        });
      });
    }

    if (!students.length) {
      elements.listCount.textContent = "0 students";
      elements.list.hidden = true;
      elements.listEmpty.hidden = false;
      const title = elements.listEmpty.querySelector("h3");
      const copy = elements.listEmpty.querySelector("p");
      if (title) title.textContent = "Student data unavailable";
      if (copy) copy.textContent = "students.js could not be read. Check the browser console for details.";
      elements.emptyClear.hidden = true;
      showEmptyViewer();
    }

    window.addEventListener("hashchange", handleHashChange);
    window.setTimeout(updateNavHighlight, 0);
  }

  try {
    init();
  } catch (error) {
    console.error("E-Waste dashboard initialisation failed:", error);
    if (elements.statStudents) elements.statStudents.textContent = "—";
    if (elements.viewerBody) {
      elements.viewerBody.replaceChildren(
        el(
          "div",
          "viewer-empty",
          "Student data could not be loaded. Please refresh the page."
        )
      );
    }
  }
})();
