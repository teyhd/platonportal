const minute = 60_000;
const freshFor = 2 * minute;
const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit"
});
const natural = new Intl.Collator("ru", { numeric: true });

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

export function roomStatus(spans, now) {
  if (!spans) return { kind:"unknown", text:"Нет данных" };
  const span = spans.find(([,end]) => end > now);
  if (!span) return { kind:"free", text:"Свободен до конца дня" };
  const busy = span[0] <= now;
  const edge = span[busy ? 1 : 0];
  const left = edge - now;
  if (left <= 15 * minute) {
    const duration = left < minute ? "меньше чем через минуту" : "через " + Math.ceil(left / minute) + " мин";
    const action = busy ? "Освободится" : "Займут";
    return { kind:busy ? "soon" : "short", text:action + " " + duration + " · " + clock.format(edge) };
  }
  return { kind:busy ? "busy" : "free", text:(busy ? "Занят до " : "Свободен до ") + clock.format(edge) };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = "room-occ__" + className;
  if (text) node.textContent = text;
  return node;
}

function mount(card) {
  const select = name => card.querySelector("[data-" + name + "]");
  const floors = select("floors"), total = select("total"), time = select("time");
  const message = select("message"), retry = select("retry");
  const tooltip = select("issue-tooltip");
  const rows = new Map();
  let snapshot, offset = 0, openFloor, pending = false, timer, failure = "";
  let nextId = 0;
  let tooltipAnchor, pinned, hideTimer;

  function hideTooltip() {
    clearTimeout(hideTimer);
    tooltipAnchor?.removeAttribute("aria-describedby");
    tooltip.hidden = true;
    tooltipAnchor = pinned = undefined;
  }

  function showTooltip(mark) {
    clearTimeout(hideTimer);
    if (tooltipAnchor !== mark) hideTooltip();
    tooltipAnchor = mark;
    tooltip.textContent = mark.dataset.issue;
    tooltip.hidden = false;
    mark.setAttribute("aria-describedby", tooltip.id);
    positionTooltip(mark);
  }

  function positionTooltip(mark) {
    const anchor = mark.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const left = Math.min(bounds.width - width - 8, Math.max(8, anchor.left - bounds.left + (anchor.width - width) / 2));
    const top = anchor.top >= height + 12 ? anchor.top - height - 6 : anchor.bottom + 6;
    tooltip.style.left = left + "px";
    tooltip.style.top = (top - bounds.top) + "px";
  }

  function leaveTooltip() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pinned && document.activeElement !== tooltipAnchor) hideTooltip();
    }, 120);
  }

  tooltip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  tooltip.addEventListener("pointerleave", leaveTooltip);
  document.addEventListener("pointerdown", event => {
    if (tooltipAnchor && !tooltipAnchor.contains(event.target) && !tooltip.contains(event.target)) hideTooltip();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && tooltipAnchor) hideTooltip();
  });

  function createGroup(floor) {
    const section = element("div", "group"), button = element("button", "row");
    button.type = "button";
    const label = floor || "Этаж не указан";
    const bar = element("span", "bar"), count = element("span","count");
    button.append(element("span","floor",label), count, element("span","arrow"));
    const details = element("div","details");
    details.id = "room-occ-floor-" + (++nextId);
    button.setAttribute("aria-controls", details.id);
    function toggleFloor() {
      openFloor = openFloor === floor ? undefined : floor;
      draw();
    }
    button.addEventListener("click", toggleFloor);
    bar.addEventListener("click", event => {
      if (!event.target.closest("button")) toggleFloor();
    });
    section.append(button,bar,details);
    return { section, button, label, bar, count, details, marks:new Map() };
  }

  function updateMark(group, room, state, index) {
    let mark = group.marks.get(room.id);
    if (!mark || Boolean(room.issue) !== (mark.tagName === "BUTTON")) {
      mark?.remove();
      mark = element(room.issue ? "button" : "span", "mark", room.name);
      group.marks.set(room.id, mark);
      if (room.issue) {
        mark.type = "button";
        const alert = element("span", "alert", "!");
        alert.setAttribute("aria-hidden", "true");
        mark.append(alert);
        mark.addEventListener("pointerenter", event => {
          if (event.pointerType !== "touch") showTooltip(mark);
        });
        mark.addEventListener("pointerleave", leaveTooltip);
        mark.addEventListener("focus", () => showTooltip(mark));
        mark.addEventListener("blur", hideTooltip);
        mark.addEventListener("click", () => {
          if (pinned === mark) {
            hideTooltip();
          } else {
            showTooltip(mark);
            pinned = mark;
          }
        });
      }
    }
    if (group.bar.children[index] !== mark) group.bar.insertBefore(mark, group.bar.children[index] || null);
    mark.dataset.kind = state.kind;
    if (room.issue) {
      mark.dataset.issue = issueLabel(room.issue);
      mark.setAttribute("aria-label", "Кабинет " + room.name + " · " + state.text + " · есть проблема");
    } else {
      mark.title = room.name + " · " + state.text;
    }
  }

  function draw() {
    const now = Date.now() + offset;
    const expired = snapshot && (now >= snapshot.end || now - snapshot.generated >= freshFor);
    const hint = failure || (expired ? "Данные устарели." :
      snapshot?.state === "unpublished" ? "Нет опубликованного расписания на сегодня." :
      snapshot && !snapshot.groups.length ? "В справочнике нет кабинетов." : "");
    const show = !!snapshot && !hint;
    floors.hidden = total.hidden = !show;
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
    let freeTotal = 0, knownTotal = 0, index = 0;
    const seen = new Set();
    for (const [floor, rooms] of snapshot.groups) {
      seen.add(floor);
      let group = rows.get(floor);
      if (!group) { group = createGroup(floor); rows.set(floor,group); }
      if (floors.children[index] !== group.section) floors.insertBefore(group.section, floors.children[index] || null);
      index++;
      const states = rooms.map(room => roomStatus(room.spans,now));
      const free = states.filter(s => s.kind === "short" || s.kind === "free").length;
      const known = states.filter(s => s.kind !== "unknown").length;
      freeTotal += free; knownTotal += known;
      const value = known ? free : "—";
      group.count.textContent = value + "/" + rooms.length;
      group.button.setAttribute("aria-label", group.label + ", свободно " + value + " из " + rooms.length);
      const expanded = openFloor === floor;
      group.button.setAttribute("aria-expanded", String(expanded));
      group.details.hidden = !expanded;
      const signature = JSON.stringify(states.map((s,i) => [rooms[i].id,rooms[i].name,rooms[i].issue,s.kind,s.text]));
      if (group.signature !== signature) {
        group.signature = signature;
        const currentRooms = new Set(rooms.map(room => room.id));
        for (const [id,mark] of group.marks) {
          if (!currentRooms.has(id)) { mark.remove(); group.marks.delete(id); }
        }
        states.forEach((state,i) => updateMark(group,rooms[i],state,i));
        group.details.replaceChildren(...states.map((state,i) => {
          const item = element("div","room");
          const { name, issue } = rooms[i];
          item.dataset.status = state.kind;
          item.append(element("strong",null,name), element("small",null,state.text));
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
      else {
        tooltip.textContent = tooltipAnchor.dataset.issue;
        positionTooltip(tooltipAnchor);
      }
    }
    total.textContent = knownTotal ? freeTotal + " свободно" : "Нет данных";
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
          total.textContent = "";
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
