export const CALENDAR_SSO_CLIENT_ID = 'calendar';
export const CALENDAR_SSO_SERVICE_NAME = 'calendar';
export const CALENDAR_SSO_REDIRECT_URI = 'https://event.platoniks.ru/api/cb';
export const CALENDAR_SSO_POST_LOGOUT_REDIRECT_URI = 'https://event.platoniks.ru';

export function getCalendarSsoClient(env = process.env) {
  const clientSecret = env.CALENDAR_SSO_CLIENT_SECRET;
  if (typeof clientSecret !== 'string' || !clientSecret.trim()) {
    throw new Error('CALENDAR_SSO_CLIENT_SECRET must be configured');
  }

  return {
    client_secret: clientSecret,
    redirect_uri: CALENDAR_SSO_REDIRECT_URI,
    post_logout_redirect_uris: [CALENDAR_SSO_POST_LOGOUT_REDIRECT_URI],
    srv_name: CALENDAR_SSO_SERVICE_NAME,
    service_scoped_access_token: true,
  };
}
