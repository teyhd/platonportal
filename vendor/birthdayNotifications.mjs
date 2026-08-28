import fs from 'node:fs/promises';

export const BIRTHDAY_NOTIFY_RECIPIENT_IDS = Object.freeze([100, 271]);
export const BIRTHDAY_NOTIFY_TIME_ZONE = 'Europe/Moscow';
export const BIRTHDAY_NOTIFY_HOUR = 9;

const DEFAULT_NOTIFY_URL = 'http://127.0.0.1:3901/notify';
const DEFAULT_NOTIFY_KEY_FILE = '/etc/tilda-api/balalaika-notify-key';
const DEFAULT_NOTIFY_SOURCE = 'birthday-reminder';
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 15 * 60 * 1_000;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function calendarDateFromUtc(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addCalendarDays({ year, month, day }, amount) {
  return calendarDateFromUtc(new Date(Date.UTC(year, month - 1, day + amount)));
}

function getZonedParts(date, timeZone = BIRTHDAY_NOTIFY_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function zonedDateTimeToInstant(parts, timeZone = BIRTHDAY_NOTIFY_TIME_ZONE) {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );
  let timestamp = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedParts(new Date(timestamp), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    timestamp += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(timestamp);
}

function calendarDateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getBirthdayTargetDate(referenceDate, timeZone = BIRTHDAY_NOTIFY_TIME_ZONE) {
  return addCalendarDays(getZonedParts(referenceDate, timeZone), 3);
}

export function isBirthdayOnDate(birthDate, targetDate) {
  const parsed = parseBirthDate(birthDate);
  if (!parsed || parsed.year < 1900) return false;

  const effectiveMonth = parsed.month;
  const effectiveDay = parsed.month === 2 && parsed.day === 29 && !isLeapYear(targetDate.year)
    ? 28
    : parsed.day;

  return effectiveMonth === targetDate.month && effectiveDay === targetDate.day;
}

export function formatBirthdayNotification(user) {
  const birthDate = parseBirthDate(user?.birth_date);
  if (!birthDate || birthDate.year < 1900) {
    throw new TypeError('Birthday notification requires a real ISO birth date');
  }

  const formattedDate = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(birthDate.year, birthDate.month - 1, birthDate.day)));
  const fullName = String(user?.name ?? '').trim();
  const department = String(user?.department ?? '').trim() || 'Не указана';

  if (!fullName) throw new TypeError('Birthday notification requires a user name');

  return [
    'Осталось 3 дня до дня рождения пользователя',
    '',
    `ФИО: ${fullName}`,
    `Кафедра: ${department}`,
    `Дата др: ${formattedDate}`,
  ].join('\n');
}

export function createBalalaikaNotifyClient({
  notifyUrl = process.env.BALALAIKA_NOTIFY_URL || DEFAULT_NOTIFY_URL,
  notifyKeyFile = process.env.BALALAIKA_NOTIFY_KEY_FILE || DEFAULT_NOTIFY_KEY_FILE,
  fetchImpl = globalThis.fetch,
  readFile = fs.readFile,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  return async function sendBirthdayNotification({ text, requestKey, source = DEFAULT_NOTIFY_SOURCE }) {
    const key = String(await readFile(notifyKeyFile, 'utf8')).trim();
    if (!key) throw new Error('Balalaika notify credential is empty');

    const url = new URL(notifyUrl);
    url.searchParams.set('title', 'День рождения');
    url.searchParams.set('txt', text);
    url.searchParams.set('type', '2');
    url.searchParams.set('who', BIRTHDAY_NOTIFY_RECIPIENT_IDS.join(','));
    url.searchParams.set('from', source);
    url.searchParams.set('silent', 'false');
    url.searchParams.set('request_key', requestKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'X-Notify-Key': key },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Balalaika notify returned invalid JSON (${response.status})`);
    }

    const accepted = response.ok &&
      result?.ok === true &&
      result?.status === 'completed' &&
      Number(result?.total_recipients) === BIRTHDAY_NOTIFY_RECIPIENT_IDS.length &&
      Number(result?.sent_recipients) === BIRTHDAY_NOTIFY_RECIPIENT_IDS.length &&
      Number(result?.failed_recipients) === 0;

    if (!accepted) {
      const status = result?.status || result?.error || response.status;
      throw new Error(`Balalaika notify delivery was not completed (${status})`);
    }

    return result;
  };
}

export async function sendBirthdayReminderForUser(user, {
  sendNotification,
  occurrenceDate,
  source = DEFAULT_NOTIFY_SOURCE,
  requestKeyPrefix = DEFAULT_NOTIFY_SOURCE,
} = {}) {
  if (typeof sendNotification !== 'function') throw new TypeError('A notify client is required');
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError('Birthday notification requires a valid user id');
  }

  const occurrence = occurrenceDate ?? parseBirthDate(user?.birth_date);
  if (!occurrence) throw new TypeError('Birthday notification requires an occurrence date');

  return sendNotification({
    text: formatBirthdayNotification(user),
    requestKey: `${requestKeyPrefix}:${calendarDateKey(occurrence)}:${userId}`,
    source,
  });
}

export async function runBirthdayNotifications({
  getCandidates,
  sendNotification,
  referenceDate = new Date(),
  timeZone = BIRTHDAY_NOTIFY_TIME_ZONE,
  logger = () => {},
} = {}) {
  if (typeof getCandidates !== 'function') throw new TypeError('A birthday candidate provider is required');

  const targetDate = getBirthdayTargetDate(referenceDate, timeZone);
  const users = await getCandidates();
  const candidates = users.filter(user => isBirthdayOnDate(user.birth_date, targetDate));
  const failures = [];
  let delivered = 0;

  for (const user of candidates) {
    try {
      await sendBirthdayReminderForUser(user, {
        sendNotification,
        occurrenceDate: targetDate,
      });
      delivered += 1;
    } catch (error) {
      failures.push({ userId: Number(user.id), error });
      logger(`Birthday notification failed for user ${Number(user.id)}: ${error.message}`);
    }
  }

  if (failures.length) {
    throw new AggregateError(
      failures.map(item => item.error),
      `Birthday notification delivery failed for ${failures.length} user(s)`
    );
  }

  return {
    targetDate: calendarDateKey(targetDate),
    matched: candidates.length,
    delivered,
  };
}

export function startBirthdayNotificationScheduler({
  run,
  logger = () => {},
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeZone = BIRTHDAY_NOTIFY_TIME_ZONE,
  runHour = BIRTHDAY_NOTIFY_HOUR,
  retryDelayMs = RETRY_DELAY_MS,
} = {}) {
  if (typeof run !== 'function') throw new TypeError('A birthday notification runner is required');

  let timer = null;
  let stopped = false;

  function scheduleAt(instant, callback) {
    if (stopped) return;
    const delay = Math.max(0, instant.getTime() - now().getTime());
    timer = setTimer(callback, delay);
  }

  function scheduleTomorrow() {
    const currentParts = getZonedParts(now(), timeZone);
    const tomorrow = addCalendarDays(currentParts, 1);
    const nextRun = zonedDateTimeToInstant({ ...tomorrow, hour: runHour }, timeZone);
    scheduleAt(nextRun, () => execute(now()));
  }

  async function execute(runDate) {
    if (stopped) return;
    try {
      const result = await run(runDate);
      logger(`Birthday notification run completed: target=${result.targetDate}, matched=${result.matched}, delivered=${result.delivered}`);
      scheduleTomorrow();
    } catch (error) {
      logger(`Birthday notification run failed: ${error.message}`);
      const current = now();
      const retryAt = new Date(current.getTime() + retryDelayMs);
      const runDay = calendarDateKey(getZonedParts(runDate, timeZone));
      const retryDay = calendarDateKey(getZonedParts(retryAt, timeZone));

      if (runDay === retryDay) {
        scheduleAt(retryAt, () => execute(runDate));
      } else {
        scheduleTomorrow();
      }
    }
  }

  const current = now();
  const currentParts = getZonedParts(current, timeZone);
  const todayRun = zonedDateTimeToInstant({ ...currentParts, hour: runHour, minute: 0, second: 0 }, timeZone);

  if (current.getTime() >= todayRun.getTime()) {
    scheduleAt(current, () => execute(current));
  } else {
    scheduleAt(todayRun, () => execute(now()));
  }

  return function stopBirthdayNotificationScheduler() {
    stopped = true;
    if (timer) clearTimer(timer);
  };
}
