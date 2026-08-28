import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BIRTHDAY_NOTIFY_RECIPIENT_IDS,
  createBalalaikaNotifyClient,
  formatBirthdayNotification,
  getBirthdayTargetDate,
  isBirthdayOnDate,
  runBirthdayNotifications,
  startBirthdayNotificationScheduler,
} from '../vendor/birthdayNotifications.mjs';
import {
  get_active_users_with_birthdays,
  get_birthday_notification_user_by_id,
} from '../vendor/db.mjs';

test('birthday target is three Moscow calendar days ahead across year boundaries', () => {
  assert.deepEqual(
    getBirthdayTargetDate(new Date('2026-12-30T07:00:00Z')),
    { year: 2027, month: 1, day: 2 }
  );
});

test('birthday matching excludes placeholders and maps February 29 to February 28', () => {
  assert.equal(isBirthdayOnDate('2000-02-29', { year: 2026, month: 2, day: 28 }), true);
  assert.equal(isBirthdayOnDate('2000-02-29', { year: 2028, month: 2, day: 28 }), false);
  assert.equal(isBirthdayOnDate('2000-02-29', { year: 2028, month: 2, day: 29 }), true);
  assert.equal(isBirthdayOnDate('1799-02-28', { year: 2026, month: 2, day: 28 }), false);
  assert.equal(isBirthdayOnDate(null, { year: 2026, month: 2, day: 28 }), false);
});

test('birthday text contains the requested fields and a safe department fallback', () => {
  assert.equal(
    formatBirthdayNotification({
      name: 'Владислав Сергеевич',
      department: 'Информатика',
      birth_date: '2000-10-28',
    }),
    [
      'Осталось 3 дня до дня рождения пользователя',
      '',
      'ФИО: Владислав Сергеевич',
      'Кафедра: Информатика',
      'Дата др: 28 октября 2000 г.',
    ].join('\n')
  );

  assert.match(
    formatBirthdayNotification({ name: 'Тестовый пользователь', birth_date: '2001-01-02' }),
    /Кафедра: Не указана/
  );
});

test('daily run sends only matching birthdays with a stable annual request key', async () => {
  const requests = [];
  const result = await runBirthdayNotifications({
    referenceDate: new Date('2026-10-25T06:00:00Z'),
    getCandidates: async () => [
      { id: 100, name: 'Владислав Сергеевич', department: 'Информатика', birth_date: '2000-10-28' },
      { id: 101, name: 'Другой пользователь', department: 'Школа', birth_date: '2000-10-29' },
    ],
    sendNotification: async payload => {
      requests.push(payload);
      return { ok: true };
    },
  });

  assert.deepEqual(result, { targetDate: '2026-10-28', matched: 1, delivered: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestKey, 'birthday-reminder:2026-10-28:100');
  assert.equal(requests[0].source, 'birthday-reminder');
  assert.match(requests[0].text, /ФИО: Владислав Сергеевич/);
});

test('Balalaika client uses protected credentials and validates both recipients', async () => {
  const calls = [];
  const sendNotification = createBalalaikaNotifyClient({
    notifyUrl: 'https://notify.example.test/notify',
    notifyKeyFile: '/protected/key',
    readFile: async path => {
      assert.equal(path, '/protected/key');
      return 'test-only-key\n';
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            status: 'completed',
            total_recipients: 2,
            sent_recipients: 2,
            failed_recipients: 0,
          };
        },
      };
    },
  });

  await sendNotification({
    text: 'Тест',
    requestKey: 'birthday-reminder:2026-10-28:100',
    source: 'birthday-reminder',
  });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('title'), 'День рождения');
  assert.equal(url.searchParams.get('type'), '2');
  assert.equal(url.searchParams.get('who'), BIRTHDAY_NOTIFY_RECIPIENT_IDS.join(','));
  assert.equal(url.searchParams.get('request_key'), 'birthday-reminder:2026-10-28:100');
  assert.equal(url.searchParams.has('key'), false);
  assert.equal(calls[0].options.headers['X-Notify-Key'], 'test-only-key');
});

test('Balalaika client rejects incomplete delivery', async () => {
  const sendNotification = createBalalaikaNotifyClient({
    readFile: async () => 'test-only-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          status: 'completed',
          total_recipients: 2,
          sent_recipients: 1,
          failed_recipients: 1,
        };
      },
    }),
  });

  await assert.rejects(
    sendNotification({ text: 'Тест', requestKey: 'test', source: 'test' }),
    /delivery was not completed/
  );
});

test('scheduler catches up after 09:00 Moscow and retries failures within the day', async () => {
  const current = new Date('2026-08-28T07:00:00Z');
  const timers = [];
  let attempts = 0;

  const stop = startBirthdayNotificationScheduler({
    now: () => current,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; },
    async run() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary failure');
      return { targetDate: '2026-08-31', matched: 1, delivered: 1 };
    },
  });

  assert.equal(timers[0].delay, 0);
  await timers[0].callback();
  assert.equal(timers[1].delay, 15 * 60 * 1_000);
  await timers[1].callback();
  assert.equal(attempts, 2);
  assert.equal(timers[2].delay, 23 * 60 * 60 * 1_000);

  stop();
  assert.equal(timers[2].cleared, true);
});

test('birthday DB helpers keep selection active-only and query a single test user', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (params.length) {
        return [[{ id: 100, name: 'Владислав Сергеевич', birth_date: '2000-10-28', department: 'Информатика' }]];
      }
      return [[{ id: 200, name: 'Пользователь', birth_date: '2001-01-01', department: 'Кафедра' }]];
    },
  };

  const candidates = await get_active_users_with_birthdays(pool);
  const user = await get_birthday_notification_user_by_id(100, pool);

  assert.equal(candidates.length, 1);
  assert.equal(user.id, 100);
  assert.match(calls[0].sql, /u\.status = 1/);
  assert.match(calls[0].sql, /u\.lifecycle_state = 'active'/);
  assert.match(calls[0].sql, /YEAR\(u\.birth_date\) >= 1900/);
  assert.deepEqual(calls[1].params, [100]);
});
