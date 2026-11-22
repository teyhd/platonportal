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
  return issue.title + (issue.count > 1 ? " · ещё " + (issue.count - 1) : "");
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
  const roomByMark = new WeakMap();
  let snapshot, offset = 0, openFloor, pending = false, timer, failure = "";
  let nextId = 0;
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
    const { room, state } = roomByMark.get(mark);
    tooltip.dataset.kind = state.kind;
    heading.textContent = "Кабинет " + room.name;
    status.textContent = state.label;
    timing.textContent = state.timing;
    timing.hidden = !state.timing;
    following.textContent = state.following ?? "";
    following.hidden = !state.following;
    issueText.textContent = room.issue ? "Проблема · " + issueLabel(room.issue) : "";
    issueText.hidden = !room.issue;
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

  function createGroup(floor) {
    const section = element("div", "group"), button = element("button", "row");
    button.type = "button";
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
    button.append(element("span","floor",label), count, element("span","arrow"));
    const details = element("div","details");
    details.id = "room-occ-floor-" + (++nextId);
    button.setAttribute("aria-controls", details.id);
    function toggleFloor() {
      openFloor = openFloor === floor ? undefined : floor;
      draw();
    }
    button.addEventListener("click", toggleFloor);
    section.append(button,distribution,bar,details);
    return { section, button, label, bar, count, details, segments, marks:new Map() };
  }

  function updateMark(group, room, state, index) {
    let controls = group.marks.get(room.id);
    if (!controls) {
      const mark = element("button", "mark");
      const name = element("span", "mark-name");
      const clockMark = element("span", "mark-clock");
      const alert = element("span", "alert", "!");
      clockMark.setAttribute("aria-hidden", "true");
      alert.setAttribute("aria-hidden", "true");
      mark.type = "button";
      mark.setAttribute("aria-pressed", "false");
      mark.append(name, clockMark, alert);
      controls = { mark, name, clockMark, alert };
      group.marks.set(room.id, controls);
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
    const { mark, name, clockMark, alert } = controls;
    roomByMark.set(mark, { room, state });
    name.textContent = room.name;
    clockMark.hidden = state.kind !== "soon" && state.kind !== "short";
    alert.hidden = !room.issue;
    if (group.bar.children[index] !== mark) group.bar.insertBefore(mark, group.bar.children[index] || null);
    mark.dataset.kind = state.kind;
    mark.toggleAttribute("data-issue", Boolean(room.issue));
    mark.setAttribute("aria-label", ["Кабинет " + room.name, state.label, room.issue && "есть проблема"].filter(Boolean).join(" · "));
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
    for (const [floor, rooms] of snapshot.groups) {
      seen.add(floor);
      let group = rows.get(floor);
      if (!group) { group = createGroup(floor); rows.set(floor,group); }
      if (floors.children[index] !== group.section) floors.insertBefore(group.section, floors.children[index] || null);
      index++;
      const states = rooms.map(room => roomStatus(room.spans,now));
      const expanded = openFloor === floor;
      if (group.details.hidden === expanded) tooltipMoved = true;
      group.button.setAttribute("aria-expanded", String(expanded));
      group.details.hidden = !expanded;
      const counts = Object.fromEntries(roomKinds.map(kind => [kind, 0]));
      for (const state of states) {
        counts[state.kind]++;
        totalsByKind[state.kind]++;
      }
      const signature = JSON.stringify(states.map((s,i) => [rooms[i].id,rooms[i].name,rooms[i].issue,s]));
      if (group.signature !== signature) {
        group.signature = signature;
        tooltipMoved = true;
        const free = counts.free + counts.short;
        const busy = counts.busy + counts.soon;
        const known = rooms.length > counts.unknown;
        group.count.textContent = known ? free + " из " + rooms.length + " свободно" : "Нет данных";
        group.count.dataset.freeCount = String(free);
        group.button.setAttribute("aria-label", [
          group.label, group.count.textContent, known && busy + " занято",
          counts.soon && releaseCount(counts.soon),
          counts.short && counts.short + (counts.short === 1 ? " свободен ненадолго" : " свободны ненадолго"),
          counts.unknown && counts.unknown + " без данных",
        ].filter(Boolean).join(" · "));
        for (const [kind, segment] of group.segments) {
          segment.hidden = !counts[kind];
          segment.style.flexGrow = counts[kind];
        }
        const currentRooms = new Set(rooms.map(room => room.id));
        for (const [id,{ mark }] of group.marks) {
          if (!currentRooms.has(id)) { mark.remove(); group.marks.delete(id); }
        }
        states.forEach((state,i) => updateMark(group,rooms[i],state,i));
        group.details.replaceChildren(...states.map((state,i) => {
          const item = element("div","room");
          const { name, issue } = rooms[i];
          item.dataset.status = state.kind;
          item.append(element("strong",null,name), element("small",null,[state.label,state.timing].filter(Boolean).join(" · ")));
          if (issue) item.append(element("small","issue-text",issueLabel(issue)));
          return item;
        }));
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
          openFloor = undefined;
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
