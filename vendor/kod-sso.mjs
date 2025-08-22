// routes/kodbox-sso.mjs — фрагмент
import crypto from "crypto";

const KODBOX_URL = "https://cloud.platoniks.ru";
const API_LOGIN_TONKEN = process.env.KODBOX_API_LOGIN_TONKEN; // тот самый apiLoginTonken из setting_user.php
const KODBOX_TO_DEFAULT = `${KODBOX_URL}/#/home`;

function buildLoginToken(username) {
  const b64 = Buffer.from(username, "utf8").toString("base64");
  const md5 = crypto.createHash("md5").update(username + API_LOGIN_TONKEN, "utf8").digest("hex");
  return `${b64}|${md5}`;
}

router.get("/cloud", (req, res) => {
  // 1) Маппинг твоего пользователя на пользователя kodbox
  const name = req.user?.kodUser || req.user?.email || req.user?.login; // подстрой под себя
  if (!name || !API_LOGIN_TONKEN) return res.status(403).send("Нет связки с облаком или секрета.");

  // 2) Куда вести после логина (в пределах cloud-домена)
  const toRaw = req.query.to || KODBOX_TO_DEFAULT;
  const base = new URL(KODBOX_URL);
  const toUrl = new URL(toRaw, base);
  if (toUrl.origin !== base.origin) return res.status(400).send("Некорректный redirect-параметр");

  // 3) Формируем login_token и финальный URL
  const loginToken = buildLoginToken(name);
  const loginUrl = `${KODBOX_URL}/index.php?user/loginSubmit` +
                   `&login_token=${encodeURIComponent(loginToken)}` +
                   `&link=${encodeURIComponent(toUrl.href)}`;

  return res.redirect(302, loginUrl);
});
