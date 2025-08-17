// ssoRouter.js
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import * as db from './db.mjs';
import {mlog,say} from './logs.js'

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
      console.log(req.query);
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
          console.dir(ans);
      } else{
          res.render('auth',{
              title: 'Авторизация'
          });
      }
  }) 
  router.post('/auth',async (req,res)=>{
    console.log("dddd",req.body);
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
        console.dir(ans);
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
  // Можно передавать audience=srv_name (число). Если нет — берём из конфигурации клиента.
  router.get("/authorize", (req, res) => {
    const { client_id, redirect_uri, state, scope, audience } = req.query;
    const cl = CLIENTS[client_id];
    if (!cl || cl.redirect_uri !== redirect_uri) return res.status(400).send("invalid client");

    if (!req.session.uid) {
      req.session.return_to = req.originalUrl;
      return res.redirect("/sso/login");
    }


    const code = crypto.randomBytes(16).toString("hex");
    CODES.set(code, {
      sub: req.session.uid,       // users.id
      name : req.session.name,
      right: req.session.right,
      logins: req.session.logins, 
      client_id,
      srv_name: audience,                   
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

    // Роли из БД по usr_id + srv_name
    const roles = await db.getUserRolesForsrvnam(entry.sub, entry.srv_name);

    const now = Math.floor(Date.now() / 1000);
    const access_token = jwt.sign(
      {
        iss: ISS,
        sub: entry.sub,
        aud: entry.srv_name,      // <- аудитория = числовой srvs.id
        name: entry.name,
        right: entry.right,                  // роли из rights для данного srv_name
        logins: entry.logins,                // логины из logins для данного srv_name
        iat: now,
        exp: now + 600
      },
      JWT_SECRET
    );

    const id_token = jwt.sign(
      { iss: ISS, sub: entry.sub, iat: now, exp: now + 600 },
      JWT_SECRET
    );

    const refresh_token = jwt.sign(
      { sub: entry.sub, typ: "refresh", iat: now, exp: now + 7 * 24 * 3600 },
      JWT_SECRET
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
      err:err
    });
  })
  // --- Единый выход ---
  router.get("/logout", (req, res) => {
    try {
      mlog(req.session.name,"вышел из системы");
      req.session.uid = null;
      req.session.name = null
      req.session.right = null
      res.clearCookie("sso.sid", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",       // если фронт на другом домене — можно 'none' + secure:true
      secure: false          // true если HTTPS
    });
      req.session.destroy()
      console.log(req.session);
      
      res.redirect('/')
      //res.send('ok');
    } catch (error) {
       res.redirect('/')
    }
    
    // => res.send("SSO logout ok"));
  });

  router.get("/", (_req, res) => res.send("SSO is up"));
  return router;
}
