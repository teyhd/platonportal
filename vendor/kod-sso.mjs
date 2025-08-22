// routes/kod-sso.js
import express from "express";
import axios from "axios";
import crypto from "crypto";

const router = express.Router();

// Настрой под себя
const KOD_HOST  = process.env.KOD_HOST  ?? "https://cloud.platoniks.ru/";
const APP_NAME  = process.env.KOD_APP_NAME ?? "user:admin"; // можно 'user:admin' или имя плагина

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.headers.host;
  return `${proto}://${host}`;
}

// 1) Стартуем SSO
router.get("/cloud", (req, res) => {
  const to = req.query.to || KOD_HOST; // куда вернём пользователя после мостика
  const callbackUrl = `${baseUrl(req)}/sso/kod/bridge?to=${encodeURIComponent(to)}`;
  const ssoUrl = `${KOD_HOST}?user/sso/apiLogin` +
                 `&appName=${encodeURIComponent(APP_NAME)}` +
                 `&callbackUrl=${encodeURIComponent(callbackUrl)}`;
  res.redirect(ssoUrl);
});

// 2) Принимаем токен от KOD и валидируем его
router.get("/sso/kod/bridge", async (req, res) => {
  const token = req.query.kodTokenApi;
  const to    = req.query.to || KOD_HOST;
  if (!token) return res.status(400).send("kodTokenApi missing");

  try {
    const checkUrl = `${KOD_HOST}?user/sso/apiCheckToken` +
                     `&accessToken=${encodeURIComponent(token)}` +
                     `&appName=${encodeURIComponent(APP_NAME)}`;
    const { data } = await axios.get(checkUrl, { timeout: 2000 });
    // data содержит сведения о пользователе KOD — при желании сохрани в сессию
    req.session.kod = { token, user: data };

    // (необязательно) Кешируем токен как это делает PHP-класс — кука на нашем домене/пути
    const cookiePath = "/sso/kod";
    const hash = crypto.createHash("md5").update(cookiePath).digest("hex").slice(0, 5);
    res.cookie(`kodTokenApi-${hash}`, token, {
      httpOnly: true, sameSite: "Lax", path: cookiePath, maxAge: 24 * 3600 * 1000
    });

    // На этом моменте у браузера уже есть сессия облака (кука на cloud.* выставилась при apiLogin)
    return res.redirect(to);
  } catch (e) {
    console.error("Kod SSO check failed:", e.message);
    return res.status(401).send("Kod SSO failed");
  }
});

export default router;
