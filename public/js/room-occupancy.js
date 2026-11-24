const minute = 60_000;
const soonWithin = 15 * minute;
const freshFor = 2 * minute;
const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit"
});
const natural = new Intl.Collator("ru", { numeric: true });
const roomKinds = ["free", "short", "soon", "busy", "unknown"];

function duration(ms) {
  const minutes = Math.ceil(ms / minute);
  if (minutes < 60) return minutes + " мин";
  const remainder = minutes % 60;
  return Math.floor(minutes / 60) + " ч" + (remainder ? " " + remainder + " мин" : "");
}

export function prepareSnapshot(payload) {
  const generated = Date.parse(payload?.generatedAt);
  const end = Date.parse(payload?.dayEnd);
  if (payload?.schema !== 1 || !["published", "unpublished"].includes(payload.state) ||
      !Number.isFinite(generated) || !Number.isFinite(end) || !Array.isArray(payload.rooms)) {
    throw new Error("Invalid room schedule");
  }
  const floors = new Map();
  for (const room of payload.rooms) {
    if (typeof room.name !== "string" || !room.name.trim()) throw new Error("Invalid room");
    let spans = null;
    if (Array.isArray(room.intervals)) {
      const ordered = room.intervals.map(span => [Date.parse(span?.start), Date.parse(span?.end)]);
      if (ordered.every(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && a < b)) {
        spans = [];
        for (const [start, finish] of ordered.sort((a,b) => a[0] - b[0])) {
          const prev = spans.at(-1);
          if (prev && start <= prev[1]) prev[1] = Math.max(prev[1], finish);
          else spans.push([start, finish]);
        }
      }
    }
    const floor = room.floor || null;
    if (!floors.has(floor)) floors.set(floor, []);
    const issue = Number.isSafeInteger(room.issue?.count) && room.issue.count > 0 &&
      typeof room.issue.title === "string" && room.issue.title.trim() ? room.issue : null;
    floors.get(floor).push({ id:room.id ?? room.name, name:room.name, spans, issue });
  }
  const groups = [...floors].sort(([a],[b]) => a === null ? 1 : b === null ? -1 : natural.compare(a,b));
  for (const [,rooms] of groups) rooms.sort((a,b) => natural.compare(a.name,b.name));
  return { generated, end, state: payload.state, groups, issuesUnavailable:payload.issueStatus === "unavailable" };
}

function issueLabel(issue) {
  return issue.title + (issue.count > 1 ? " · ещё\u00a0" + (issue.count - 1) : "");
}

function releaseCount(count) {
  return count + (count === 1 ? " скоро освободится" : " скоро освободятся");
}

export function roomStatus(spans, now) {
  if (!spans) return { kind:"unknown", label:"Нет данных", timing:"" };
  const index = spans.findIndex(([,end]) => end > now);
  if (index === -1) return { kind:"free", label:"Свободен", timing:"До конца дня" };
  const span = spans[index];
  const busy = span[0] <= now;
  const edge = span[busy ? 1 : 0];
  const left = edge - now;
  const soon = left <= soonWithin;
  const relative = left < minute ? "меньше чем через минуту" : "через " + duration(left);
  const timing = (busy ? "Освободится " : "Займут ") + relative + " · " + clock.format(edge) + " МСК";
  if (!busy) return { kind:soon ? "short" : "free", label:soon ? "Свободен ненадолго" : "Свободен", timing };
  const next = spans[index + 1];
  const following = next
    ? "Затем свободен до " + clock.format(next[0]) + " МСК"
    : "Затем свободен до конца дня";
  return { kind:soon ? "soon" : "busy", label:soon ? "Скоро освободится" : "Занят", timing, following };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = "room-occ__" + className;
  if (text) node.textContent = text;
  return node;
}

function mount(card) {
  const select = name => card.querySelector("[data-" + name + "]");
  const toggle = select("toggle");
  const body = document.getElementById(toggle.getAttribute("aria-controls"));
  const preview = select("preview"), previewNote = select("preview-note");
  const floors = select("floors"), time = select("time"), legend = select("legend");
  const totals = select("totals") ?? select("total");
  const message = select("message"), retry = select("retry");
  const tooltip = select("issue-tooltip");
  const heading = element("div", "tooltip-heading");
  const status = element("strong", "tooltip-status");
  const timing = element("div", "tooltip-timing");
  const following = element("div", "tooltip-timing");
  const issueText = element("div", "tooltip-issue");
  heading.setAttribute("aria-hidden", "true");
  status.setAttribute("aria-hidden", "true");
  tooltip.replaceChildren(heading, status, timing, following, issueText);
  const rows = new Map();
  const previewItems = new Map();
  const roomByMark = new WeakMap();
  let snapshot, offset = 0, pending = false, timer, failure = "";
  let tooltipAnchor, pinned, hideTimer;

  function hideTooltip() {
    clearTimeout(hideTimer);
    tooltipAnchor?.removeAttribute("aria-describedby");
    pinned?.setAttribute("aria-pressed", "false");
    tooltip.hidden = true;
    tooltipAnchor = pinned = undefined;
  }

  function showTooltip(mark) {
    clearTimeout(hideTimer);
    if (tooltipAnchor !== mark) hideTooltip();
    tooltipAnchor = mark;
    tooltip.hidden = false;
    updateTooltip(mark);
    mark.setAttribute("aria-describedby", tooltip.id);
  }

  function updateTooltip(mark) {
    const { room, state, floor } = roomByMark.get(mark);
    if (tooltip.dataset.kind !== state.kind) tooltip.dataset.kind = state.kind;
    const values = [
      [heading, "Кабинет " + room.name + (floor ? " · " + floor : "")],
      [status, state.label],
      [timing, state.timing],
      [following, state.following ?? ""],
      [issueText, room.issue ? "Проблема · " + issueLabel(room.issue) : ""],
    ];
    for (const [node, value] of values) {
      if (node.textContent !== value) node.textContent = value;
      const hidden = !value;
      if (node.hidden !== hidden) node.hidden = hidden;
    }
    positionTooltip(mark);
  }

  function positionTooltip(mark) {
    const anchor = mark.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.width - width - 8,
      anchor.left - bounds.left + (anchor.width - width) / 2));
    const below = window.innerHeight - anchor.bottom;
    const above = anchor.top >= height + 12 || anchor.top > below;
    const top = above ? anchor.top - height - 6 : anchor.bottom + 6;
    tooltip.style.left = left + "px";
    tooltip.style.top = (top - bounds.top) + "px";
  }

  function leaveTooltip() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pinned && document.activeElement !== tooltipAnchor) hideTooltip();
    }, 200);
  }

  tooltip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  tooltip.addEventListener("pointerleave", leaveTooltip);
  document.addEventListener("pointerdown", event => {
    if (tooltipAnchor && !tooltipAnchor.contains(event.target) && !tooltip.contains(event.target)) hideTooltip();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && tooltipAnchor) hideTooltip();
  });
  window.addEventListener("resize", () => {
    if (tooltipAnchor) positionTooltip(tooltipAnchor);
  });

  toggle.addEventListener("click", () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    hideTooltip();
    draw();
  });

  function updatePreview(groups, hint) {
    const items = groups.flatMap(([floor, entries]) =>
      entries.map(entry => ({ ...entry, floor })));
    const active = document.activeElement;
    const focused = preview.contains(active);
    preview.hidden = !body.hidden || !items.length;
    previewNote.hidden = !body.hidden || !!items.length;
    const note = hint || "Загрузка…";
    if (previewNote.textContent !== note) previewNote.textContent = note;
    if (!body.hidden) return;

    items.sort((a, b) => natural.compare(a.room.name, b.room.name));
    const seen = new Set();
    items.forEach(({ room, state, floor }, index) => {
      seen.add(room.id);
      const interactive = Boolean(room.issue);
      let entry = previewItems.get(room.id);
      if (!entry || entry.controls.interactive !== interactive) {
        const item = entry?.item ?? element("li", "preview-item");
        const controls = createMark(interactive);
        item.removeAttribute("aria-label");
        item.removeAttribute("title");
        item.replaceChildren(controls.mark);
        entry = { item, controls };
        previewItems.set(room.id, entry);
      }
      updateRoomMark(entry.controls, room, state, floor);
      if (preview.children[index] !== entry.item) preview.insertBefore(entry.item, preview.children[index] || null);
    });
    for (const [id, entry] of previewItems) {
      if (!seen.has(id)) { entry.item.remove(); previewItems.delete(id); }
    }
    if (focused && !active.isConnected) (preview.hidden ? toggle : preview).focus({ preventScroll:true });
    if (tooltipAnchor) {
      if (preview.contains(tooltipAnchor)) updateTooltip(tooltipAnchor);
      else hideTooltip();
    }
  }

  function createGroup(floor) {
    const section = element("div", "group");
    const row = element("div", "row");
    const label = floor || "Этаж не указан";
    const bar = element("div", "bar"), count = element("span","count");
    const distribution = element("div","distribution");
    distribution.setAttribute("aria-hidden","true");
    const segments = new Map(roomKinds.map(kind => {
      const segment = element("span");
      segment.dataset.kind = kind;
      distribution.append(segment);
      return [kind, segment];
    }));
    row.append(element("span", "floor", label), count);
    section.append(row, distribution, bar);
    return { section, bar, count, segments, marks: new Map() };
  }

  function createMark(interactive) {
    const mark = element(interactive ? "button" : "span", "mark");
    const name = element("span", "mark-name");
    const clockMark = element("span", "mark-clock");
    const alert = element("span", "alert", "!");
    clockMark.setAttribute("aria-hidden", "true");
    alert.setAttribute("aria-hidden", "true");
    mark.append(name, clockMark, alert);
    if (interactive) {
      mark.type = "button";
      mark.setAttribute("aria-pressed", "false");
      mark.addEventListener("pointerenter", event => {
        if (event.pointerType !== "touch") showTooltip(mark);
      });
      mark.addEventListener("pointerleave", leaveTooltip);
      mark.addEventListener("focus", () => showTooltip(mark));
      mark.addEventListener("blur", () => {
        if (tooltipAnchor === mark) hideTooltip();
      });
      mark.addEventListener("click", () => {
        if (pinned === mark) hideTooltip();
        else {
          showTooltip(mark);
          pinned = mark;
          mark.setAttribute("aria-pressed", "true");
        }
      });
    }
    return { mark, name, clockMark, alert, interactive };
  }

  function updateRoomMark({ mark, name, clockMark, alert, interactive }, room, state, floor) {
    const previous = roomByMark.get(mark);
    roomByMark.set(mark, { room, state, floor });
    if (previous?.room === room && previous.state.kind === state.kind && previous.state.label === state.label && previous.floor === floor) return;
    name.textContent = room.name;
    clockMark.hidden = state.kind !== "soon" && state.kind !== "short";
    alert.hidden = !room.issue;
    mark.dataset.kind = state.kind;
    mark.toggleAttribute("data-issue", Boolean(room.issue));
    const label = ["Кабинет " + room.name, floor, state.label, room.issue && "есть проблема"].filter(Boolean).join(" · ");
    if (interactive) mark.setAttribute("aria-label", label);
    else {
      mark.parentElement.setAttribute("aria-label", label);
      mark.parentElement.title = label;
    }
  }

  function updateMark(group, room, state, index) {
    let controls = group.marks.get(room.id);
    if (!controls) {
      controls = createMark(true);
      group.marks.set(room.id, controls);
    }
    updateRoomMark(controls, room, state);
    if (group.bar.children[index] !== controls.mark) group.bar.insertBefore(controls.mark, group.bar.children[index] || null);
  }

  function updateTotals(counts) {
    const labels = {
      free: (counts.free + counts.short) + " свободно",
      busy: (counts.busy + counts.soon) + " занято",
      soon: "Из них " + releaseCount(counts.soon),
      unknown: counts.unknown + " без данных",
    };
    if (!totals.children.length) {
      totals.textContent = labels.free;
      return;
    }
    for (const total of totals.children) {
      const kind = total.dataset.kind;
      total.hidden = (kind === "unknown" || kind === "soon")
        ? !counts[kind]
        : counts.free + counts.short + counts.busy + counts.soon === 0;
      if (total.textContent !== labels[kind]) total.textContent = labels[kind];
    }
  }

  function draw() {
    const now = Date.now() + offset;
    const expired = snapshot && (now >= snapshot.end || now - snapshot.generated >= freshFor);
    const hint = failure || (expired ? "Данные устарели." :
      snapshot?.state === "unpublished" ? "Нет опубликованного расписания на сегодня." :
      snapshot && !snapshot.groups.length ? "В справочнике нет кабинетов." : "");
    const show = !!snapshot && !hint;
    const issuesCurrent = !failure && !expired && !snapshot?.issuesUnavailable;
    const groups = (snapshot?.groups ?? []).map(([floor, rooms]) => [
      floor,
      rooms.map(room => ({
        room: !issuesCurrent && room.issue ? { ...room, issue:null } : room,
        state: roomStatus(show ? room.spans : null, now),
      })),
    ]);
    updatePreview(groups, hint);
    if (body.hidden) return;

    floors.hidden = totals.hidden = !show;
    if (legend) legend.hidden = !show;
    message.hidden = !hint && !!snapshot;
    retry.hidden = !failure && !expired;
    retry.disabled = pending;
    time.textContent = show ? "По расписанию · " + clock.format(now) + " МСК" : "По расписанию";
    if (show && snapshot.issuesUnavailable) time.textContent += " · Заявки недоступны";
    if (hint) message.textContent = hint;
    if (!show) {
      if (tooltipAnchor) hideTooltip();
      return;
    }
    const totalsByKind = Object.fromEntries(roomKinds.map(kind => [kind, 0]));
    let index = 0;
    let tooltipMoved = false;
    const seen = new Set();
    for (const [floor, entries] of groups) {
      seen.add(floor);
      let group = rows.get(floor);
      if (!group) { group = createGroup(floor); rows.set(floor,group); }
      if (floors.children[index] !== group.section) floors.insertBefore(group.section, floors.children[index] || null);
      index++;
      const counts = Object.fromEntries(roomKinds.map(kind => [kind, 0]));
      for (const { state } of entries) {
        counts[state.kind]++;
        totalsByKind[state.kind]++;
      }
      const signature = JSON.stringify(entries.map(({ room, state }) => [room.id, room.name, room.issue, state]));
      if (group.signature !== signature) {
        group.signature = signature;
        tooltipMoved = true;
        const free = counts.free + counts.short;
        const known = entries.length > counts.unknown;
        group.count.textContent = known ? free + " из " + entries.length + " свободно" : "Нет данных";
        group.count.dataset.freeCount = String(free);
        for (const [kind, segment] of group.segments) {
          segment.hidden = !counts[kind];
          segment.style.flexGrow = counts[kind];
        }
        const currentRooms = new Set(entries.map(({ room }) => room.id));
        for (const [id,{ mark }] of group.marks) {
          if (!currentRooms.has(id)) { mark.remove(); group.marks.delete(id); }
        }
        entries.forEach(({ room, state }, index) => updateMark(group, room, state, index));
      }
    }
    for (const [floor,group] of rows) {
      if (!seen.has(floor)) { group.section.remove(); rows.delete(floor); }
    }
    if (tooltipAnchor) {
      if (!tooltipAnchor.isConnected) hideTooltip();
      else if (tooltipMoved) updateTooltip(tooltipAnchor);
    }
    updateTotals(totalsByKind);
  }

  async function refresh() {
    if (document.hidden || pending) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/room-occupancy",{ signal:controller.signal, cache:"no-store" });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          snapshot = null;
          floors.replaceChildren();
          rows.clear();
        }
        throw new Error("Unavailable");
      }
      const payload = await response.json();
      const data = prepareSnapshot(payload);
      const serverNow = Date.parse(payload.serverTime || response.headers.get("Date"));
      offset = (Number.isFinite(serverNow) ? serverNow : data.generated) - Date.now();
      snapshot = data;
      failure = "";
    } catch {
      failure = "Данные о кабинетах недоступны.";
    } finally {
      clearTimeout(timeout);
      pending = false;
      draw();
    }
  }

  function activate() {
    clearInterval(timer);
    if (!document.hidden) {
      draw();
      refresh();
      let lastPoll = Date.now();
      timer = setInterval(() => {
        draw();
        if (Date.now() - lastPoll >= 30_000) { lastPoll = Date.now(); refresh(); }
      }, 1000);
    }
  }
  retry.addEventListener("click",refresh);
  document.addEventListener("visibilitychange",activate);
  activate();
}

if (typeof document !== "undefined") document.querySelectorAll("[data-room-occupancy]").forEach(mount);
