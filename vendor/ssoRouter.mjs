// ssoRouter.js
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import * as db from './db.mjs';
import {mlog,say} from './logs.js'

export function getClientServiceName(client) {
  if (typeof client?.srv_name !== 'string' || !client.srv_name) {
    throw new Error('SSO client must have a service name');
  }
  return client.srv_name;
}

export function getAuthorizationAudience(client, requestedAudience) {
  if (client?.service_scoped_access_token) {
    return getClientServiceName(client);
  }

  // Legacy services validate a numeric aud value. Keep it in their client
  // configuration instead of letting a browser request choose another service.
  if (client?.legacy_audience !== undefined && client?.legacy_audience !== null) {
    return String(client.legacy_audience);
  }

  return requestedAudience;
}

export function createScopedAccessToken({
  issuer,
  jwtSecret,
  subject,
  name,
  rights,
  logins,
  audience,
  sid,
  now,
}) {
  return jwt.sign(
    {
      iss: issuer,
      sub: subject,
      aud: audience,
      name,
      right: rights,
      logins,
      sid: sid || undefined,
      iat: now,
      exp: now + 600,
    },
    jwtSecret,
    { algorithm: 'HS256' }
  );
}

export function makeSsoRouter(config = {}) {
  const router = express.Router();

  const ISS        = config.issuer    || process.env.SSOADR;
  const JWT_SECRET = config.jwtSecret || process.env.JWTSECRET;
  const CLIENTS    = config.clients   || {};
  const getServiceRoles = config.getServiceRoles || db.getUserRolesForsrvnam;
  const tokenStore = config.tokenStore || null;
  const lifecycle = config.lifecycle || null;
  const asyncRoute = handler => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

  // code -> { sub, client_id, srv_name, scope }
  const CODES = new Map();

  router.use(bodyParser.urlencoded({ extended: false }));

  async function establishAuthenticatedUser(req, ans) {
    const right = await db.get_user_rights(ans.id);
    const logins = await db.get_user_logins(ans.id);
    if (lifecycle?.establish) {
      await lifecycle.establish(req, {
        id: ans.id,
        name: ans.name,
        role: ans.role,
        right,
        logins,
      });
      return;
    }
    req.session.uid = ans.id;
    req.session.name = ans.name;
    req.session.role = ans.role;
    req.session.right = right;
    req.session.logins = logins;
  }

  // --- Демо-логин (замени на свою авторизацию) ---
  router.get('/auth',async (req,res)=>{
      if (req.query.pin!=undefined){
          let ans = await db.auth_user(req.query.pin);
          if (ans!=undefined){
              await establishAuthenticatedUser(req, ans)
              const back = req.session.return_to || "/"; req.session.return_to = null;
              //res.redirect(back);
              res.send('ok')
          } else {
              res.send('nok')
          }
      } else{
          res.render('auth',{
              title: 'Авторизация'
          });
      }
  }) 

  router.get('/bauth',async (req,res)=>{
      if (req.query.pin!=undefined){
          let ans = await db.auth_user(req.query.pin);
          if (ans!=undefined){
              await establishAuthenticatedUser(req, ans)
              const back = req.session.return_to || "/"; req.session.return_to = null;
              //res.redirect(back);
              res.send(`
              <html>
                <head>
                  <meta http-equiv="refresh" content="0.3; url=/" />
                  <title>Авторизация</title>
                </head>
                <body>
                  <p>Авторизация успешна. Перенаправление...</p>
                </body>
              </html>
            `);
          } else {
              res.send('Ошибка, неверная ссылка!')
          }
      } else{
          res.render('auth',{
              title: 'Авторизация'
          });
      }
  }) 

  router.post('/auth',async (req,res)=>{
    if (req.body.pin!=undefined){
        let ans = await db.auth_user(req.body.pin);
        if (ans!=undefined){
            await establishAuthenticatedUser(req, ans)
            const back = req.session.return_to || "/"; req.session.return_to = null;
            res.redirect(back);
            //res.send('ok')
        } else {
            res.send('Ошибка авторизации')
        }
    } else{
        res.render('auth',{
            title: 'Авторизация'
        });
    }
  }) 
  router.get("/login", (_req, res) => {
    res.redirect("/auth");
/*
    res.send(`<form method="post" action="/sso/login">
      <input name="email" placeholder="email" />
      <button>Login</button></form>`);*/
  });

  router.post("/login", (_req, res) => {
    res.status(405).send('Use /sso/auth to sign in');
  });

  // --- /authorize ---
  // Calendar uses its service name. Legacy clients use their configured numeric audience.
  router.get("/authorize", (req, res) => {
    const { client_id, redirect_uri, state, audience } = req.query;
    const cl = CLIENTS[client_id];
    if (!cl || cl.redirect_uri !== redirect_uri) return res.status(400).send("invalid client");

    if (!req.session.uid) {
      req.session.return_to = req.originalUrl;
      return res.redirect("/sso/login");
    }


    req.session.sso_clients = [...new Set([...(req.session.sso_clients || []), client_id])];
    req.session.save(error => {
      if (error) return res.status(500).send('session save failed');
      const code = crypto.randomBytes(16).toString("hex");
      const serviceScopedAccessToken = cl.service_scoped_access_token === true;
      CODES.set(code, {
        sub: req.session.uid,       // users.id
        name : req.session.name,
        right: serviceScopedAccessToken ? undefined : req.session.right,
        logins: req.session.logins,
        sid: req.sessionID,
        client_id,
        srv_name: getAuthorizationAudience(cl, audience),
        service_scoped_access_token: serviceScopedAccessToken,
      });

      const url = new URL(redirect_uri);
      url.searchParams.set("code", code);
      if (state) url.searchParams.set("state", state);
      res.redirect(url.toString());
    });
  });

  // --- /token ---
  router.post("/token", asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token } = req.body;
    const cl = CLIENTS[client_id];
    if (!cl || cl.client_secret !== client_secret || (grant_type === 'authorization_code' && cl.redirect_uri !== redirect_uri)) {
      return res.status(400).json({ error: "invalid_client" });
    }

    if (grant_type === 'refresh_token') {
      if (!cl.revocable_sessions || !tokenStore || !refresh_token) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      const previous = await tokenStore.consume(refresh_token);
      if (!previous || previous.client_id !== client_id || !await lifecycle?.isActive(previous.sid, previous.sub)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      const rights = await getServiceRoles(previous.sub, cl.srv_name);
      const nextRefresh = await tokenStore.issue(previous);
      const now = Math.floor(Date.now() / 1000);
      const accessToken = createScopedAccessToken({
        issuer: ISS,
        jwtSecret: JWT_SECRET,
        subject: previous.sub,
        name: previous.name,
        rights,
        logins: [],
        audience: previous.audience,
        sid: previous.sid,
        now,
      });
      return res.json({
        token_type: 'Bearer',
        access_token: accessToken,
        refresh_token: nextRefresh.token,
        expires_in: 600,
        refresh_expires_in: nextRefresh.expiresAt - now,
      });
    }

    if (grant_type !== "authorization_code") {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }

    const entry = CODES.get(code);
    if (!entry || entry.client_id !== client_id) {
      return res.status(400).json({ error: "invalid_code" });
    }
    CODES.delete(code);

    const rights = entry.service_scoped_access_token
      ? await getServiceRoles(entry.sub, entry.srv_name)
      : entry.right;

    const now = Math.floor(Date.now() / 1000);
    const access_token = createScopedAccessToken({
      issuer: ISS,
      jwtSecret: JWT_SECRET,
      subject: entry.sub,
      name: entry.name,
      rights,
      logins: entry.logins,
      audience: entry.srv_name,
      sid: entry.sid,
      now,
    });

    const id_token = jwt.sign(
      { iss: ISS, sub: entry.sub, iat: now, exp: now + 600 },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );

    let issuedRefreshToken;
    let refreshExpiresIn;
    if (cl.revocable_sessions) {
      if (!tokenStore || !entry.sid) return res.status(503).json({ error: 'revocable_sessions_unavailable' });
      const issued = await tokenStore.issue({
        client_id,
        sub: entry.sub,
        name: entry.name,
        sid: entry.sid,
        srv_name: cl.srv_name,
        audience: entry.srv_name,
      });
      issuedRefreshToken = issued.token;
      refreshExpiresIn = issued.expiresAt - now;
    } else {
      issuedRefreshToken = jwt.sign(
        { sub: entry.sub, typ: "refresh", iat: now, exp: now + 7 * 24 * 3600 },
        JWT_SECRET,
        { algorithm: 'HS256' }
      );
    }

    res.json({
      token_type: "Bearer",
      access_token,
      id_token,
      refresh_token: issuedRefreshToken,
      expires_in: 600,
      ...(refreshExpiresIn ? { refresh_expires_in: refreshExpiresIn } : {}),
    });
  }));

  router.post('/introspect', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const credentials = parseBasicCredentials(req.get('authorization'));
    const client = credentials ? CLIENTS[credentials.clientId] : null;
    if (!client || client.client_secret !== credentials.clientSecret) {
      res.set('WWW-Authenticate', 'Basic realm="sso-introspection"');
      return res.status(401).json({ active: false });
    }
    if (!client.revocable_sessions || !tokenStore) return res.json({ active: false });

    const record = await tokenStore.inspect(req.body?.token);
    if (!record || record.client_id !== credentials.clientId || !await lifecycle?.isActive(record.sid, record.sub)) {
      return res.json({ active: false });
    }
    const right = await getServiceRoles(record.sub, client.srv_name);
    const authorizationVersion = crypto
      .createHash('sha256')
      .update(JSON.stringify([...right].sort((left, rightValue) => Number(left) - Number(rightValue))))
      .digest('hex')
      .slice(0, 24);
    return res.json({
      active: true,
      sub: record.sub,
      name: record.name,
      right,
      sid: record.sid,
      iss: ISS,
      aud: record.audience,
      exp: record.exp,
      authorization_version: authorizationVersion,
    });
  }));

  router.get('/err',async (req,res)=>{
    let err = 1
    if (req.query.err == undefined) err = 0
    res.render('accerr',{
      title: 'Ошибка',
      err:err,
      auth: req.session.rolen
    });
  })
  // --- Единый выход ---
// sso mainportal
  router.get('/logout', asyncRoute(async (req, res) => {
    const { post_logout_redirect_uri, client_id } = req.query;
    const allowed = (CLIENTS?.[client_id]?.post_logout_redirect_uris) || [];
    const redirectOk = allowed.includes(post_logout_redirect_uri);

    try { mlog(req.session.name, 'вышел из системы'); } catch {}
    if (lifecycle?.logout) await lifecycle.logout(req, 'logout');
    else await new Promise(resolve => req.session.destroy(resolve));
    res.clearCookie('sso.sid', { path: '/' });
    res.redirect(redirectOk ? post_logout_redirect_uri : (process.env.SSO_DEFAULT_REDIRECT || '/'));
  }));


  router.get("/", (_req, res) => res.send("SSO is up"));
  return router;
}

function parseBasicCredentials(header) {
  const match = /^Basic\s+(.+)$/i.exec(String(header || '').trim());
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator <= 0) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}
