export const SSO_CLIENT_SECRET_ENV_NAMES = {
  bookpc: 'BOOKPC_SSO_CLIENT_SECRET',
  rasp: 'RASP_SSO_CLIENT_SECRET',
  buy: 'BUY_SSO_CLIENT_SECRET',
  report: 'REPORT_SSO_CLIENT_SECRET',
  diary: 'DIARY_SSO_CLIENT_SECRET',
  atten: 'ATTEN_SSO_CLIENT_SECRET',
  vote: 'VOTE_SSO_CLIENT_SECRET',
};

export function getRequiredEnvironmentValue(name, env = process.env) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be configured`);
  }
  return value;
}

export function getSsoClientSecrets(env = process.env) {
  return Object.fromEntries(
    Object.entries(SSO_CLIENT_SECRET_ENV_NAMES).map(([clientId, envName]) => [
      clientId,
      getRequiredEnvironmentValue(envName, env),
    ])
  );
}
