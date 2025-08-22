// routes/kodbox-sso.mjs
import express from "express";
import axios from "axios";
import * as hlp from './hlp.mjs';
import 'dotenv/config'
const router = express.Router();

import { URLSearchParams } from "url";

router.get("/pgmplatform", async (req, res) => {
  const FALLBACK_URL = "https://teacher.platonics.ru/";

  try {
    // 1) Достаем креды из сессии
    const creds = hlp.getLoginByService(req.session?.logins, 6);
    if (!creds?.login || !creds?.pass) {
      return res.redirect(302, FALLBACK_URL);
    }

    // 2) Логинимся и получаем access-токен
    const { data: auth } = await axios.post(
      "https://api.platonics.ru/teacher/login",
      { username: creds.login, password: creds.pass },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
        validateStatus: (s) => s === 200,
      }
    );

    const token = auth?.access;
    const userId = auth?.user_id;
    const name = req.session?.name || "Учитель";

    if (!token || !userId) {
      return res.redirect(302, FALLBACK_URL);
    }

    // 3) Создаём комнату/получаем ссылку (endpoint ожидает form-urlencoded)
    const body = new URLSearchParams({
      userId: String(userId),
      roomId: String(userId),
      name: String(name),
    });
    console.log(body);
    
    const linkResp = await axios.post(
      "https://api.platonics.ru/meeting/teacher.php",
      body.toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
        responseType: "text", // сервер часто отдаёт text/html
        validateStatus: (s) => s === 200,
      }
    );

    // 4) Пытаемся извлечь целевой URL
    let targetUrl = null;

    // Вариант А: сервер вернул JSON со свойством link
    try {
      const maybeJson = JSON.parse(linkResp.data);
      if (maybeJson?.link && typeof maybeJson.link === "string") {
        targetUrl = maybeJson.link;
      }
    } catch {
      // Вариант Б: парсим первую ссылку из HTML/текста
      const m = String(linkResp.data).match(/https?:\/\/[^\s"'<>]+/);
      if (m) targetUrl = m[0];
    }

    // 5) Редиректим, иначе fallback
    if (targetUrl) {
      return res.redirect(302, targetUrl);
    }
    return res.redirect(302, FALLBACK_URL);
  } catch (err) {
    // Любая ошибка — уходим на fallback
    console.error("pgmplatform error:", err?.response?.status, err?.message);
    return res.redirect(302, FALLBACK_URL);
  }
});


export default router;
