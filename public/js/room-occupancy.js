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
    floors.get(floor).push({ name: room.name, spans });
  }
  const groups = [...floors].sort(([a],[b]) => a === null ? 1 : b === null ? -1 : natural.compare(a,b));
  for (const [,rooms] of groups) rooms.sort((a,b) => natural.compare(a.name,b.name));
  return { generated, end, state: payload.state, groups };
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
  const rows = new Map();
  let snapshot, offset = 0, openFloor, pending = false, timer, failure = "";
  let nextId = 0;

  function createGroup(floor) {
    const section = element("div", "group"), button = element("button", "row");
    button.type = "button";
    const label = floor || "Этаж не указан";
    const bar = element("span", "bar"), count = element("span","count");
    bar.setAttribute("aria-hidden","true");
    button.append(element("span","floor",label), bar, count, element("span","arrow"));
    const details = element("div","details");
    details.id = "room-occ-floor-" + (++nextId);
    button.setAttribute("aria-controls", details.id);
    button.addEventListener("click", () => {
      openFloor = openFloor === floor ? undefined : floor;
      draw();
    });
    section.append(button,details);
    return { section, button, label, bar, count, details };
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
    if (hint) message.textContent = hint;
    if (!show) return;
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
      const signature = JSON.stringify(states.map((s,i) => [rooms[i].name,s.kind,s.text]));
      if (group.signature !== signature) {
        group.signature = signature;
        group.bar.replaceChildren(...states.map((state,i) => {
          const mark = element("i");
          mark.dataset.kind = state.kind;
          mark.title = rooms[i].name + " · " + state.text;
          return mark;
        }));
        group.details.replaceChildren(...states.map((state,i) => {
          const item = element("div","room");
          item.dataset.status = state.kind;
          item.append(element("strong",null,rooms[i].name), element("small",null,state.text));
          return item;
        }));
      }
    }
    for (const [floor,group] of rows) {
      if (!seen.has(floor)) { group.section.remove(); rows.delete(floor); }
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
