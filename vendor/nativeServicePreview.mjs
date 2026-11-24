export function createNativeServicePreview({ env = process.env, fetchImpl = fetch } = {}) {
  const token = env.MAINPORTAL_SCHEDULE_TOKEN;
  return {
    supports: service => service === 'schedule' && Boolean(token),
    async launchSchedule({ actorId, targetId, childId }) {
      const endpoint = new URL('/internal/integrations/mainportal/v1/role-preview',
        env.MAINPORTAL_SCHEDULE_URL || 'http://127.0.0.1:3011');
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_id: actorId, subject_id: targetId }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 403) return null;
      if (!response.ok) throw new Error('Native preview unavailable');
      const { code } = await response.json();
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new Error('Invalid native preview code');
      const destination = new URL(childId ? '/audit/schedule/personal' : '/audit/', 'https://rasp.platoniks.ru');
      if (childId) destination.searchParams.set('child_id', childId);
      destination.hash = 'code=' + code;
      return destination.href;
    },
  };
}
