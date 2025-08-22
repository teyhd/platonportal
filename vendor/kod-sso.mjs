// routes/kodbox-sso.mjs
import express from "express";
import axios from "axios";
import https from "https";
import 'dotenv/config'
const router = express.Router();

// ==== НАСТРОЙКИ ====
// URL облака без завершающего слеша
const KODBOX_URL = (process.env.KODBOX_URL || "https://cloud.platoniks.ru").replace(/\/+$/,"");
// Куда вести пользователя по умолчанию (можно KODBOX_URL)
const KODBOX_TO_DEFAULT = process.env.KODBOX_TO_DEFAULT || `${KODBOX_URL}/`;
// Если у тебя самоподписанный TLS на облаке (НЕ рек. для прод)
const KODBOX_REJECT_UNAUTHORIZED = (process.env.KODBOX_REJECT_UNAUTHORIZED || "true") !== "false";

// ====== ПРОСТЕЙШИЙ TTL-КЭШ ТОКЕНОВ (в памяти процесса) ======
const tokenCache = new Map(); // key: `${KODBOX_URL}:${name}` -> {token, exp}

// ====== МАППИНГ ПОЛЬЗОВАТЕЛЯ ТВОЕЙ СИСТЕМЫ -> УЧЁТКА KODBOX ======
// Ожидается, что ты положишь в req.usercluod.kodUser / req.usercluod.kodPass связку для облака.
// Если этого нет — вернём 403, чтобы не ломать UX неожиданным редиректом на логин облака.
function mapUserToKodbox(req) {
  let usercluod = { kodUser: process.env.DEV_KOD_USER, kodPass: process.env.DEV_KOD_PASS };
  const u = usercluod || {};
  console.dir(u)
  const name = u.kodUser || u.email || u.login;   // можно поменять логику
  const password = u.kodPass;                     // хранить отдельно от пароля твоего портала!
  if (!name || !password) return null;
  return { name, password };
}

// ====== ПОЛУЧЕНИЕ TOKEN У KODBOX ======
async function fetchKodboxToken({ name, password }) {
  // Эндпоинт входа токеном (устойчив к капче, когда включены isAjax & getToken)
  const url = `${KODBOX_URL}/?user/loginSubmit&isAjax=1&getToken=1`;

  const httpsAgent = new https.Agent({ rejectUnauthorized: KODBOX_REJECT_UNAUTHORIZED });
  const form = new URLSearchParams({ name, password });

  // 2 попытки на случай сетевой хрупкости
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const { data } = await axios.post(url, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 4000,
        httpsAgent
      });
     // console.dir(data);
      // Ответы kodbox бывают разных видов: ищем accessToken во всех популярных местах
      const token =
        data?.data?.accessToken ||
        data?.info ||
        data?.accessToken ||
        data?.data ||
        data?.token;
        //console.dir(token);
      if (typeof token === "string" && token.trim()) return token.trim();
      throw new Error("accessToken not found in response");
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 200)); // короткий бэкофф
    }
  }
  throw lastErr || new Error("Kodbox token fetch failed");
}

async function getKodboxTokenCached({ name, password }) {
  const key = `${KODBOX_URL}:${name}`;
  const now = Date.now();
  const hit = tokenCache.get(key);
  if (hit && hit.exp > now) return hit.token;

  const token = await fetchKodboxToken({ name, password });
  // токены у kodbox краткоживущие — кэшируем совсем ненадолго (например, 90 секунд)
  tokenCache.set(key, { token, exp: now + 90_000 });
  return token;
}

// ====== ГЛАВНЫЙ РОУТ: /cloud ======
// Пример: GET /cloud            -> авторизует и ведёт в корень облака
//         GET /cloud?to=...     -> после авторизации ведёт по указанному URL (на том же домене)
router.get("/cloud", async (req, res) => {
  try {
    const m = mapUserToKodbox(req);
    console.dir(m)
    if (!m) return res.status(403).send("KodExplorer: учетная запись не привязана");

    const token = await getKodboxTokenCached(m);

    // Целевая страница в облаке (безопасно: не даём увести на другой домен)
    const toRaw = req.query.to || KODBOX_TO_DEFAULT;
    const toUrl = new URL(toRaw, KODBOX_URL);
    if (toUrl.origin !== new URL(KODBOX_URL).origin) {
      return res.status(400).send("Некорректный redirect-параметр");
    }

    // Kodbox сам поглотит ?accessToken=... и установит сессию пользователю
    // (у некоторых сборок поддерживается параметр callbackUrl, но самый совместимый путь — простой вход)
    const loginUrl = `${KODBOX_URL}/?accessToken=${encodeURIComponent(token)}`;
    console.dir(loginUrl)
    // Трюк с промежуточной страницей:
    // 1) Логиним через ?accessToken, 2) затем JS-редирект на toUrl —
    //     так гарантируем попадание в нужную секцию UI после установки сессии.
    const html = `<!doctype html><meta charset="utf-8">
      <title>Вход в облако…</title>
      <link rel="icon" href="data:,">
      <script>
        (async () => {
          try {
            // Первый заход — чтобы kodbox поставил cookie сессии
            const resp = await fetch(${JSON.stringify(loginUrl)}, { credentials: "include" });
            // После входа — отправляем на желаемую страницу
            alert(resp)
            location.replace(${JSON.stringify(toUrl.href)});
          } catch (e) {
           // location.href = ${JSON.stringify(`${KODBOX_URL}/#user/login`)};
          }
        })();
      </script>
      Входим в облако…`;
    return res.status(200).send(html);
  } catch (e) {
    console.error("Kodbox SSO error:", e?.message);
    return res.redirect(`${KODBOX_URL}/#user/login`);
  }
});

export default router;
