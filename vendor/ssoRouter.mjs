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
  return client?.service_scoped_access_token
    ? getClientServiceName(client)
    : requestedAudience;
}

export function createScopedAccessToken({
  issuer,
  jwtSecret,
  subject,
  name,
  rights,
  logins,
  audience,
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

  // code -> { sub, client_id, srv_name, scope }
  const CODES = new Map();

  router.use(bodyParser.urlencoded({ extended: false }));

  // --- Демо-логин (замени на свою авторизацию) ---
  router.get('/auth',async (req,res)=>{
      if (req.query.pin!=undefined){
          let ans = await db.auth_user(req.query.pin);
          if (ans!=undefined){
              req.session.uid = ans.id
              req.session.name = ans.name
              req.session.right = await db.get_user_rights(ans.id)
              req.session.logins = await db.get_user_logins(ans.id)
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
              req.session.uid = ans.id
              req.session.name = ans.name
              req.session.right = await db.get_user_rights(ans.id)
              req.session.logins = await db.get_user_logins(ans.id)
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
            req.session.uid = ans.id
            req.session.name = ans.name
            req.session.right = await db.get_user_rights(ans.id)
            req.session.logins = await db.get_user_logins(ans.id)
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

  router.post("/login", (req, res) => {
    const email = req.body?.email || "user@example.com";
    // Привяжи sub к своему users.id (здесь демо: 123)
    req.session.uid = 123;
    const back = req.session.return_to || "/"; req.session.return_to = null;
    res.redirect(back);
  });

  // --- /authorize ---
  // Legacy-клиенты передают audience сами. Service-scoped клиенты фиксируют его в конфигурации.
  router.get("/authorize", (req, res) => {
    const { client_id, redirect_uri, state, audience } = req.query;
    const cl = CLIENTS[client_id];
    if (!cl || cl.redirect_uri !== redirect_uri) return res.status(400).send("invalid client");

    if (!req.session.uid) {
      req.session.return_to = req.originalUrl;
      return res.redirect("/sso/login");
    }


    const code = crypto.randomBytes(16).toString("hex");
    const serviceScopedAccessToken = cl.service_scoped_access_token === true;
    CODES.set(code, {
      sub: req.session.uid,       // users.id
      name : req.session.name,
      right: serviceScopedAccessToken ? undefined : req.session.right,
      logins: req.session.logins, 
      client_id,
      srv_name: getAuthorizationAudience(cl, audience),
      service_scoped_access_token: serviceScopedAccessToken,
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  // --- /token ---
  router.post("/token", async (req, res) => {
    const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;
    const cl = CLIENTS[client_id];
    if (!cl || cl.client_secret !== client_secret || cl.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: "invalid_client" });
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
      ? await db.getUserRolesForsrvnam(entry.sub, entry.srv_name)
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
      now,
    });

    const id_token = jwt.sign(
      { iss: ISS, sub: entry.sub, iat: now, exp: now + 600 },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );

    const refresh_token = jwt.sign(
      { sub: entry.sub, typ: "refresh", iat: now, exp: now + 7 * 24 * 3600 },
      JWT_SECRET,
      { algorithm: 'HS256' }
    );

    res.json({
      token_type: "Bearer",
      access_token,
      id_token,
      refresh_token,
      expires_in: 600
    });
  });

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
  router.get('/logout', (req, res) => {
    const { post_logout_redirect_uri, client_id } = req.query;
    const allowed = (CLIENTS?.[client_id]?.post_logout_redirect_uris) || [];
    const redirectOk = allowed.includes(post_logout_redirect_uri);

    try { mlog(req.session.name, 'вышел из системы'); } catch {}
    req.session.uid = req.session.name = req.session.right = null;

    req.session.destroy(() => {
      res.clearCookie('sso.sid', { path: '/' /* , domain: process.env.SSO_COOKIE_DOMAIN если задавали */ });
      res.redirect(redirectOk ? post_logout_redirect_uri : (process.env.SSO_DEFAULT_REDIRECT || '/'));
    });
  });


  router.get("/", (_req, res) => res.send("SSO is up"));
  return router;
}
