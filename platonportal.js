import {mlog,say} from './vendor/logs.js'
process.on('uncaughtException', (err) => {
mlog('Глобальный косяк приложения!!! ', err.stack);
}); //Если все пошло по ***, спасет ситуацию
import 'dotenv/config'

import bcrypt from 'bcrypt';
import * as db from './vendor/db.mjs';
import * as hlp from './vendor/hlp.mjs';
import * as vcall from './vendor/vcall.mjs';
import { makeSsoRouter } from "./vendor/ssoRouter.mjs";
import platformsso from "./vendor/platformsso.mjs";

import express from 'express'
import exphbs from 'express-handlebars'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url';
//import { console } from 'inspector/promises';

var PORT = process.env.PORT || 777;
 //PORT = process.env.PORT || 80;
const app = express();
const hbs = exphbs.create({
defaultLayout: 'main',
extname: 'hbs',
helpers: {
    OK: function(){
    i_count = 1
    },
     // простой счётчик (если вдруг пригодится в списках)
    inc() {
        return i_count++;
    },
    reset() {
        i_count = 1;
        return '';
    },

    // взять подстроку: {{substr name 0 1}}
    substr(str, start, len) {
        str = (str ?? '').toString();
        const s = Number(start) || 0;
        const l = (len == null) ? undefined : Number(len);
        return str.substring(s, l ? s + l : undefined);
    },

    // поиск объекта по id в массиве: {{#with (findById types this.type)}}{{name}}{{/with}}
    findById(arr, id) {
        if (!Array.isArray(arr)) return null;
        const target = arr.find(x => String(x?.id) === String(id));
        return target || null;
    },

    // сравнения на всякий случай
    eq(a, b) { return String(a) === String(b); },
    ne(a, b) { return String(a) !== String(b); },
    gt(a, b) { return Number(a) > Number(b); },
    lt(a, b) { return Number(a) < Number(b); },

    // логика
    and() {
        const args = Array.from(arguments).slice(0, -1);
        return args.every(Boolean);
    },
    or() {
        const args = Array.from(arguments).slice(0, -1);
        return args.some(Boolean);
    },

    // отладка/быстрый вывод json
    json(ctx) {
        try { return JSON.stringify(ctx); } catch { return 'null'; }
    },
    I_C: function (opts){
    let anso = ''
    for (let i = 0; i < i_count; i++) {
        anso = anso + "I"
    }
    i_count++
    return anso
    },
    PLS: function (a,opts){

        return a+10
        },
    if_eq: function (a, b, opts) {
        if (a == b){ // Or === depending on your needs
           //  mlog(opts);
            return opts.fn(this);
        } else
            return opts.inverse(this);
    },
    if_more: function (a, b, opts) {
    if (a >= b){ // Or === depending on your needs
        // logman.log(opts);
        return opts.fn(this);
        } else
        return opts.inverse(this);
    },
    for: function(from, to, incr, block) {
        var accum = '';
        for(var i = from; i < to; i += incr)
            accum += block.fn(i);
        return accum;
    }
}
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export let appDir = __dirname;

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');

const viewsPath = path.join(appDir, 'views');
const publicPath = path.join(appDir, 'public');

app.set('views', viewsPath);
mlog(publicPath);
app.use(express.static(publicPath, { redirect: false }));

app.use(cookieParser());
app.set('trust proxy', 1);

app.use(session({name: 'sso.sid',resave:true,saveUninitialized:false, secret: 'hardcode_secret_teyhd', cookie: 
  {secure: false, // ⚠️ обязательно false на HTTP!
  httpOnly: true}
}))

app.use("/sso", makeSsoRouter({
  issuer: process.env.SSOADR,
  jwtSecret: process.env.JWTSECRET,
  clients: {
    "bookpc": { client_secret: "pcbigsectet", redirect_uri: "https://pc.platoniks.ru/cb",
      post_logout_redirect_uris: ['https://pc.platoniks.ru'], srv_name: 'bookpc' },

    "rasp": { client_secret: "Mydirtybigsectetb", redirect_uri: "https://rasp.platoniks.ru/api/cb",
    post_logout_redirect_uris: ['https://rasp.platoniks.ru'], srv_name: 'rasp' },
    
    "buy": { client_secret: process.env.BUY_SSO_CLIENT_SECRET, redirect_uri: "https://buy.platoniks.ru/api/cb",
      post_logout_redirect_uris: ['https://buy.platoniks.ru'], srv_name: 'buy' },

    "report": { client_secret: "ReportDirtySecurFuckTheMind", redirect_uri: "https://rep.platoniks.ru/cb",
      post_logout_redirect_uris: ['https://rep.platoniks.ru'], srv_name: 'report' },

      "diary": { client_secret: "DiaryClientSecret", redirect_uri: "https://diary.platoniks.ru/cb",
      post_logout_redirect_uris: ['https://diary.platoniks.ru'], srv_name: 'diary' },
  }
}));
app.use(platformsso)

app.use(express.json({ limit: "20mb" })); // для application/json
app.use(async function (req, res, next) {
    let page = req._parsedOriginalUrl.pathname;
    //console.log('Cookie:', req.headers);
    //.log('Session:', req.session);
     mlog(page,req.session.uid,req.session.name,req.session.info,req.headers['nip'],hlp.getcurip(req.socket.remoteAddress),req.query)
     next();
})

//app.use(kodSsoRouter);
app.get('/e',(req,res)=>{
    req.session.test = 0
    res.sendStatus(200)
})

const SERVICE_META = [
  { match: /электронный журнал|дневник/i, tag: 'Учебный процесс', summary: 'Оценки, занятия и ежедневная работа.' },
  { match: /расписание/i, tag: 'Календарь', summary: 'Уроки, звонки и быстрый переход к расписанию.' },
  { match: /инструкции/i, tag: 'Навигация', summary: 'Инструкции и ответы по частым вопросам.' },
  { match: /бот платоникс|балалайка/i, tag: 'Коммуникация', summary: 'Сообщения, уведомления и быстрый контакт.' },
  { match: /голосован/i, tag: 'Обратная связь', summary: 'Опросы и сбор мнений.' },
  { match: /облако/i, tag: 'Файлы', summary: 'Документы, материалы и совместная работа в облаке.' },
  { match: /прогресс/i, tag: 'Аналитика', summary: 'Отчеты и динамика обучения.' },
  { match: /аренда пк|управление пк/i, tag: 'Техника', summary: 'Компьютеры, устройства и заявки по технике.' },
  { match: /v\.call/i, tag: 'Онлайн-уроки', summary: 'Быстрый вход в активную комнату или запуск нового урока.' },
  { match: /управление пользователями/i, tag: 'Администрирование', summary: 'Роли, права доступа и учетные записи сотрудников.' },
  { match: /лента событий/i, tag: 'Медиа', summary: 'Фотографии, события и материалы школьной жизни.' },
];

const INFO_META = [
  { match: /администрац|руководител/i, tag: 'Команда' },
  { match: /wifi|парол/i, tag: 'Инфраструктура' },
  { match: /график|звонки|распределение/i, tag: 'Регламент' },
  { match: /социальн/i, tag: 'Коммуникация' },
  { match: /контрол/i, tag: 'Контроль' },
];

const CATALOG_GROUP_ORDER = new Map(['learning', 'communications', 'materials', 'feedback', 'admin'].map((key, index) => [key, index]));

function pickMeta(title, collection, fallback) {
  const normalized = (title ?? '').toString();
  return collection.find(item => item.match.test(normalized)) ?? fallback;
}

function stripHtml(value = '') {
  return value
    .toString()
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExcerpt(value = '', limit = 140) {
  const plain = stripHtml(value);
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit).trimEnd()}…`;
}

const FALLBACK_CARD_ICON = '/img/platon.png';

function getCardImageSrc(pic = '') {
  const value = (pic ?? '').toString().trim();
  if (!value) return FALLBACK_CARD_ICON;

  if (/^data:image\//i.test(value)) {
    return value;
  }

  if (/^(https?:)?\/\//i.test(value)) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (url.hostname === 'platoniks.ru') {
        return `${url.pathname}${url.search}`;
      }
    } catch (_) {}
    return FALLBACK_CARD_ICON;
  }

  if (value.startsWith('/')) {
    return value;
  }

  const clean = value
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^public\//, '');

  return clean.startsWith('img/') ? `/${clean}` : `/img/${clean}`;
}

function getLinkMeta(href = '') {
  const value = (href ?? '').toString().trim();

  if (!value) {
    return { kindLabel: 'Раздел', destinationLabel: 'на этой странице', detailLabel: 'На этой странице' };
  }

  if (value.startsWith('#')) {
    return { kindLabel: 'Быстрый вход', destinationLabel: 'откроется здесь', detailLabel: 'На этой странице' };
  }

  if (value.startsWith('/')) {
    return { kindLabel: 'Раздел', destinationLabel: 'на этом сайте', detailLabel: 'Сайт Гармонии' };
  }

  try {
    const target = new URL(value);
    const host = target.hostname.replace(/^www\./, '');

    if (host === 't.me' || host.endsWith('.t.me')) {
      return { kindLabel: 'Telegram', destinationLabel: 'откроется отдельно', detailLabel: 'Telegram' };
    }

    if (host === 'platoniks.ru' || host.endsWith('.platoniks.ru') || host.endsWith('.teyhd.ru')) {
      return { kindLabel: 'Сервис', destinationLabel: 'откроется отдельно', detailLabel: 'Сервис Гармонии' };
    }

    return { kindLabel: 'Сервис', destinationLabel: 'откроется отдельно', detailLabel: 'Внешний сервис' };
  } catch (_error) {
    return { kindLabel: 'Раздел', destinationLabel: 'на этой странице', detailLabel: 'На этой странице' };
  }
}

function getAccessMeta(role = 0) {
  if (!role) {
    return {
      accessLabel: 'Гостевой доступ',
      accessNote: 'Войдите по PIN, чтобы увидеть свои уроки, комнаты и сервисы.',
    };
  }

  if (role >= 5) {
    return {
      accessLabel: 'Расширенный доступ',
      accessNote: 'Быстрый доступ к урокам, комнатам и сервисам.',
    };
  }

  return {
    accessLabel: 'Персональный доступ',
    accessNote: 'Быстрый доступ к урокам, комнатам и сервисам.',
  };
}

function normalizeRoleValue(role = 0) {
  if (Array.isArray(role)) {
    const roles = role
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0);

    return roles.length ? Math.max(...roles) : 0;
  }

  const numericRole = Number(role);
  return Number.isFinite(numericRole) && numericRole > 0 ? numericRole : 0;
}

function getSessionPortalRole(sessionRight = 0) {
  if (Array.isArray(sessionRight)) {
    return normalizeRoleValue(hlp.getRolesBySrvId(sessionRight, 1));
  }

  return normalizeRoleValue(sessionRight);
}

function getHomeRoleMeta(role = 0) {
  const normalizedRole = normalizeRoleValue(role);

  if (!normalizedRole) {
    return {
      homeRoleMode: 'guest',
      roleLabel: 'Гостевой доступ',
      homeTitle: 'Сервисы Гармонии',
      homeSubtitle: 'Найдите расписание, журнал, инструкции и публичные сервисы без лишних переходов.',
      homeHint: 'Войдите по PIN, чтобы увидеть персональные уроки, комнаты и закрытые сервисы.',
    };
  }

  if (normalizedRole >= 5) {
    return {
      homeRoleMode: 'admin',
      roleLabel: 'Расширенный доступ',
      homeTitle: 'Рабочий каталог Гармонии',
      homeSubtitle: 'Учебные, коммуникационные и административные сервисы собраны в одном аккуратном каталоге.',
      homeHint: 'Каталог уже адаптирован под вашу роль и показывает доступные рабочие инструменты.',
    };
  }

  return {
    homeRoleMode: 'member',
    roleLabel: 'Персональный доступ',
    homeTitle: 'Ваши сервисы Гармонии',
    homeSubtitle: 'Быстрый доступ к ежедневным учебным действиям, расписанию, материалам и связи.',
    homeHint: 'Каталог уже адаптирован под вашу роль.',
  };
}

function getServicePriority(title = '', href = '') {
  const value = `${title ?? ''} ${href ?? ''}`.toLowerCase();

  if (value.includes('#lesson')) return 10;
  if (value.includes('#room')) return 11;
  if (/электронный журнал|дневник|diary/.test(value)) return 20;
  if (/расписание|rasp/.test(value)) return 30;
  if (/облако|cloud/.test(value)) return 40;
  if (/балалайка|msg\.platoniks/.test(value)) return 50;
  if (/инструкц|manual/.test(value)) return 60;
  if (/управление пользователями|\/users/.test(value)) return 70;

  return 100;
}

function isOperationService(card) {
  const href = (card?.cont ?? '').toString().trim();
  return href === '#lesson' || href === '#room';
}

function getCatalogGroup(card = {}) {
  const value = `${card.title ?? ''} ${card.cont ?? ''} ${card.tag ?? ''} ${card.summary ?? ''}`.toLowerCase();

  if (/\/users|управление пользователями|администр|роль|права/.test(value)) return 'admin';
  if (/#lesson|#room|v\.call|электронный журнал|дневник|распис|урок|diary|rasp|club8899/.test(value)) return 'learning';
  if (/балалайка|бот|telegram|t\.me|msg\.platoniks|сообщен|уведомлен|коммуникац|звон/.test(value)) return 'communications';
  if (/инструкц|manual|облако|cloud|файл|материал|регламент|справк|лента событий|медиа/.test(value)) return 'materials';
  if (/голосован|опрос|обратная связь|feedback|vote/.test(value)) return 'feedback';

  return 'materials';
}

function getRoleServicePriority(card, roleMode = 'guest') {
  const group = card.catalogGroup ?? getCatalogGroup(card);
  const basePriority = card._priority ?? getServicePriority(card.title, card.cont);
  const groupOrder = CATALOG_GROUP_ORDER.get(group) ?? CATALOG_GROUP_ORDER.size;
  let roleOffset = groupOrder * 100;

  if (roleMode === 'guest') {
    roleOffset = {
      learning: 0,
      communications: 1,
      materials: 2,
      feedback: 3,
      admin: 9,
    }[group] ?? 8;
  } else if (roleMode === 'admin') {
    roleOffset = {
      learning: 0,
      admin: 1,
      communications: 2,
      materials: 3,
      feedback: 4,
    }[group] ?? 8;
  } else {
    roleOffset = {
      learning: 0,
      communications: 1,
      materials: 2,
      feedback: 3,
      admin: 8,
    }[group] ?? 8;
  }

  return roleOffset * 100 + basePriority;
}

function buildHomeCatalog(menuCards = [], role = 0) {
  const roleMeta = getHomeRoleMeta(role);
  const rankedCards = [...menuCards]
    .map(card => ({
      ...card,
      _rolePriority: getRoleServicePriority(card, roleMeta.homeRoleMode),
    }))
    .sort((a, b) => a._rolePriority - b._rolePriority || a._menuIndex - b._menuIndex);

  return {
    ...roleMeta,
    catalogServices: rankedCards.filter(card => !isOperationService(card)),
  };
}

function normalizeMenuCard(card, index = 0) {
  const meta = pickMeta(card.title, SERVICE_META, {
    tag: 'Сервис',
    summary: 'Быстрый переход к нужному разделу.',
  });
  const linkMeta = getLinkMeta(card.cont);
  const catalogGroup = getCatalogGroup({ ...card, ...meta });

  return {
    ...card,
    ...meta,
    ...linkMeta,
    _menuIndex: index,
    _priority: getServicePriority(card.title, card.cont),
    catalogGroup,
    excerpt: getExcerpt(meta.summary, 90),
    imageSrc: getCardImageSrc(card.pic),
  };
}

function normalizeInfoCard(card) {
  const meta = pickMeta(card.title, INFO_META, { tag: 'Информация' });

  return {
    ...card,
    ...meta,
    excerpt: getExcerpt(card.cont),
  };
}

function isNoisyIntroInfo(card) {
  const title = (card?.title ?? '').toString();
  const text = stripHtml(card?.cont ?? '');
  return /сервисы платоникса/i.test(title) && /добро пожаловать|коллекция ссылок|ключевые ресурсы/i.test(text);
}

app.get('/',async (req,res)=>{
   
    let rolen = 0
    try {
        rolen = getSessionPortalRole(req.session.right ?? req.session.role ?? 0)
        req.session.rolen = rolen
    } catch (error) {
        mlog(error);
        req.session.rolen = 0
    }
    let cards = await db.get_cards(rolen)
    const menuCards = cards.filter(c => c.type === 0).map((card, index) => normalizeMenuCard(card, index))
    const infoCards = cards.filter(c => c.type === 1).map(normalizeInfoCard)
    const homeCatalog = buildHomeCatalog(menuCards, rolen)
    const prioritizedMenu = [...menuCards].sort((a, b) => getRoleServicePriority(a, homeCatalog.homeRoleMode) - getRoleServicePriority(b, homeCatalog.homeRoleMode) || a._menuIndex - b._menuIndex)
    const operationMenu = prioritizedMenu.filter(isOperationService)
    const serviceMenu = prioritizedMenu.filter(card => !isOperationService(card))
    const primaryMenu = serviceMenu.slice(0, 4)
    const primaryIndexes = new Set(primaryMenu.map(card => card._menuIndex))
    const secondaryMenu = serviceMenu.filter(card => !primaryIndexes.has(card._menuIndex)).slice(0, 8)
    const secondaryIndexes = new Set(secondaryMenu.map(card => card._menuIndex))
    const utilityMenu = serviceMenu.filter(card => !primaryIndexes.has(card._menuIndex) && !secondaryIndexes.has(card._menuIndex))
    const featuredMenu = [...operationMenu, ...primaryMenu].slice(0, 4)
    const helpfulInfo = infoCards.filter(card => !isNoisyIntroInfo(card))
    const infoGroup = {
      title: 'Информация и регламенты',
      description: 'Справка, правила и важные материалы для спокойной работы с сервисами.',
      items: helpfulInfo,
      hasItems: helpfulInfo.length > 0,
    }
    const featuredInfo = null
    const secondaryInfo = helpfulInfo
    const accessMeta = getAccessMeta(rolen)
    const quickMenu = primaryMenu.slice(0, 3)

    res.render('new',{
      title: 'Гармония Образования',
      menu: menuCards,
      info: infoCards,
      featuredMenu,
      operationMenu,
      primaryMenu,
      secondaryMenu,
      utilityMenu,
      featuredInfo,
      secondaryInfo,
      quickMenu,
      menuCount: menuCards.length,
      infoCount: infoCards.length,
      menuOverflowCount: secondaryMenu.length,
      utilityCount: utilityMenu.length,
      infoOverflowCount: secondaryInfo.length,
      auth: rolen,
      isGuestHome: homeCatalog.homeRoleMode === 'guest',
      isAdminHome: homeCatalog.homeRoleMode === 'admin',
      infoGroup,
      ...homeCatalog,
      ...accessMeta
    });
  })

// === Страница users.hbs (добавляем allRoles, services для панели) ===
app.get('/balalayka', (req, res) => {
  const openHref = 'https://msg.platoniks.ru/';
  const androidHref = 'https://www.rustore.ru/catalog/app/ru.platoniks.balalaika';
  const iosHref = 'https://testflight.apple.com/join/REkhmRaq';

  const heroHighlights = [
    { value: 'Задачи', label: 'Задачи не теряются в переписке и остаются в рабочем контексте.' },
    { value: 'Файлы', label: 'Фото, видео и документы остаются рядом с перепиской.' },
    { value: 'Live', label: 'Аудио- и видеозвонки доступны прямо из чатов.' }
  ];

  const proofPoints = [
    { title: 'Меньше шума', text: 'Важные сообщения легче заметить, когда чаты, задачи и уведомления не смешиваются.' },
    { title: 'Быстрый вход', text: 'Войти в аккаунт можно через Яндекс, Apple и другими удобными способами.' },
    { title: 'Для ежедневной работы', text: 'Подходит для коротких сообщений, обсуждений и встреч.' },
    { title: 'На разных устройствах', text: 'Открывается в браузере, на Android и на iPhone через TestFlight.' },
    { title: 'Привычные действия', text: 'Реакции, файлы, статусы сообщений и звонки работают в интуитивном и хорошо знакомом формате.' }
  ];

  const showcaseItems = [
    {
      id: 'forums',
      label: 'Задачи',
      eyebrow: 'Организация',
      title: 'Держите задачи команды в понятной структуре.',
      description: 'Поручения, решения и договоренности проще вести, когда они не теряются в общей переписке.',
      points: [
        'видно, где появилась новая активность',
        'важные задачи не теряются среди коротких сообщений',
        'обсуждение и решение остаются рядом'
      ]
    },
    {
      id: 'reactions',
      label: 'Реакции',
      eyebrow: 'Быстрый ответ',
      title: 'Отвечайте коротко, когда не нужен новый текст.',
      description: 'Реакции помогают подтвердить, согласовать или отметить идею без лишних сообщений.',
      points: [
        'быстрая обратная связь в один жест',
        'реакции работают привычно на телефоне и в браузере',
        'меньше лишних “ок” и “принято” в чатах'
      ]
    },
    {
      id: 'media',
      label: 'Медиа',
      eyebrow: 'Файлы и материалы',
      title: 'Делитесь фото, видео и документами без лишних переходов.',
      description: 'Материалы остаются в контексте переписки, поэтому к ним проще вернуться позже.',
      points: [
        'прогресс загрузки виден сразу',
        'фото и видео удобно смотреть в сообщениях',
        'документы и вложения легко открыть повторно'
      ]
    },
    {
      id: 'notifications',
      label: 'Уведомления',
      eyebrow: 'Спокойный ритм',
      title: 'Получайте уведомления без лишнего шума.',
      description: 'Балалайка помогает заметить важное и не отвлекает повторно, когда вы уже в чате.',
      points: [
        'понятный текст уведомлений',
        'меньше лишних уведомлений, когда чат уже открыт',
        'понятные уведомления на разных устройствах'
      ]
    },
    {
      id: 'live',
      label: 'Live',
      eyebrow: 'Комнаты',
      title: 'Подключайтесь к комнате прямо из обсуждения.',
      description: 'Когда переписки недостаточно, можно быстро перейти к аудио- или видеозвонку.',
      points: [
        'не нужно искать отдельную ссылку',
        'участникам понятно, куда подключаться',
        'обсуждение и встреча остаются рядом'
      ]
    }
  ];

  const platformCards = [
    {
      id: 'web',
      name: 'Браузер',
      status: 'без установки',
      description: 'Откройте Балалайку в браузере и продолжайте общение без установки приложения.',
      note: 'Для компьютера и быстрого входа',
      href: openHref,
      cta: 'Открыть в браузере'
    },
    {
      id: 'android',
      name: 'Android',
      status: 'RuStore',
      description: 'Установите Android-версию из RuStore и получайте сообщения на телефоне.',
      note: 'Официальная страница приложения',
      href: androidHref,
      cta: 'Скачать в RuStore'
    },
    {
      id: 'ios',
      name: 'iPhone',
      status: 'TestFlight',
      description: 'Подключитесь к iOS-версии через TestFlight, если пользуетесь iPhone.',
      note: 'Установка через Apple TestFlight',
      href: iosHref,
      cta: 'Установить через TestFlight'
    }
  ];

  const updateCards = [
    {
      eyebrow: 'Задачи',
      title: 'Задачи легче держать в фокусе.',
      text: 'Новые поручения, договоренности и активность видно сразу, без долгого поиска по переписке.'
    },
    {
      eyebrow: 'Медиа',
      title: 'Файлы и видео стали понятнее в работе.',
      text: 'Загрузка показывает прогресс, а фото и видео меньше выбиваются из переписки.'
    },
    {
      eyebrow: 'Стабильность',
      title: 'Повышено удобство и корректность работы мессенджера',
      text: 'Улучшены реакции, статусы сообщений, уведомления и запуск чатов на iPhone.'
    }
  ];

  const footerLinks = [
    { href: openHref, label: 'Открыть в браузере' },
    { href: androidHref, label: 'Android' },
    { href: iosHref, label: 'iPhone' }
  ];

  res.render('balalayka', {
    title: 'Балалайка',
    pageTitle: 'Балалайка, мессенджер для команды',
    openHref,
    heroHighlights,
    proofPoints,
    showcaseItems,
    platformCards,
    updateCards,
    footerLinks,
    auth: req.session?.rolen || 0
  });
});

app.get('/users', async (req, res) => {
  const rolen = Number(req.session?.right ?? 0);
  if (rolen < 5) return res.redirect('/');

  try {
    const users    = await db.get_users();
    const types    = await db.get_types();
    const kafs     = await db.get_kafs();
    const services = await db.get_services_with_allowed_roles(); // для вкладок/панели
    const allRoles = await db.get_all_roles();
    const errrules = await db.get_err_roles_users();

    res.render('users', {
      title: 'Пользователи',
      users,
      types,
      kafs,
      services,
      allRoles,
      errrules,
      auth: req.session.rolen
    });
  } catch (e) {
    console.error(e);
    res.status(500).render('errors/500', { title:'Ошибка сервера' });
  }
});

// === API для справочника "какие роли доступны в каждом сервисе" ===
// Требуем хотя бы роль > 0. Для UI-страницы можно поставить redirect, для API — 403.
app.get('/api/srvs-roles', async (req, res) => {
  const rolen = Number(req.session?.role ?? 0);
  if (rolen === 0) return res.status(403).json({ ok:false, message:'forbidden' });

  try {
    const services = await db.get_services_with_allowed_roles(); // [{id,name,roles:[{id,name}]}]
    const allRoles = await db.get_all_roles();                   // [{id,name}]
    res.json({ ok:true, services, allRoles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Сохранить связки целиком (UI отправляет полный набор pairs)
app.put('/api/srvs-roles', async (req, res) => {
  const rolen = Number(req.session?.role ?? 0);
  if (rolen === 0) return res.status(403).json({ ok:false, message:'forbidden' });

  const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
  // ожидается: [{ srv_name: <number>, role_id: <number> }, ...]

  try {
    await db.replace_srvs_roles(pairs);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Получить полный профиль пользователя (для шторки)
app.get('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.get_user_by_id(id);
  if (!user) return res.status(404).json({ ok:false, message: 'Not found' });

  const rights = await db.get_user_rights(id);
  const logins = await db.get_user_logins(id);
  res.json({ ok:true, user, rights, logins});
});

// Создать пользователя
app.post('/api/users', async (req, res) => {
  const body = req.body || {};
  const data = {
    name: String(body.name ?? '').trim(),
    nickname: String(body.nickname ?? '').trim(),
    msgnickname: String(body.msgnickname ?? '').trim(),
    msgnickname_normalized: String(body.msgnickname_normalized ?? '').trim(),
    email: String(body.email ?? '').trim(),
    kaf: (body.kaf === '' || body.kaf == null || Number.isNaN(Number(body.kaf))) ? null : Number(body.kaf),
    type: Number(body.type ?? 0),
    status: Number(body.status ?? 0),
    pin:  String(body.pin ?? '').trim(),
    tg_id: (body.tg_id === '' || body.tg_id == null || Number.isNaN(Number(body.tg_id))) ? null : Number(body.tg_id),
    allow_discovery_outside_harmony: Number(body.allow_discovery_outside_harmony ?? 0),
    avatar_url_custom: String(body.avatar_url_custom ?? '').trim(),
    display_name_custom: String(body.display_name_custom ?? '').trim(),
  };
  if (!data.name) return res.status(400).json({ ok:false, message:'name required' });
  try {
    const id = await db.create_user(data);
    res.json({ ok:true, id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok:false, message:'PIN уже используется' });
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Обновить пользователя
app.put('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const data = {
    name: String(body.name ?? '').trim(),
    nickname: String(body.nickname ?? '').trim(),
    msgnickname: String(body.msgnickname ?? '').trim(),
    msgnickname_normalized: String(body.msgnickname_normalized ?? '').trim(),
    email: String(body.email ?? '').trim(),
    kaf: (body.kaf === '' || body.kaf == null || Number.isNaN(Number(body.kaf))) ? null : Number(body.kaf),
    type: Number(body.type ?? 0),
    status: Number(body.status ?? 0),
    pin:  String(body.pin ?? '').trim(),
    tg_id: (body.tg_id === '' || body.tg_id == null || Number.isNaN(Number(body.tg_id))) ? null : Number(body.tg_id),
    allow_discovery_outside_harmony: Number(body.allow_discovery_outside_harmony ?? 0),
    avatar_url_custom: String(body.avatar_url_custom ?? '').trim(),
    display_name_custom: String(body.display_name_custom ?? '').trim(),
  };
  if (!id) return res.status(400).json({ ok:false, message:'bad id' });
  if (!data.name) return res.status(400).json({ ok:false, message:'name required' });

  try {
    const ok = await db.update_user(id, data);
    if (!ok) return res.status(404).json({ ok:false, message:'Not found' });
    res.json({ ok:true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok:false, message:'PIN уже используется' });
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Заменить набор ролей пользователя целиком
app.put('/api/users/:id/rights', async (req, res) => {
  const id = Number(req.params.id);
  const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
  // ожидается массив объектов {srv_name, role_id}

  if (!id) return res.status(400).json({ ok:false, message:'bad id' });
  try {
    await db.replace_user_rights(id, pairs);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Сохранить логины по сервисам (батч)
app.put('/api/users/:id/logins', async (req, res) => {
  const id = Number(req.params.id);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  // ожидается массив {srv_name, login, new_password}

  if (!id) return res.status(400).json({ ok:false, message:'bad id' });

  // Хэшируй только если пароль передан
  for (const r of rows) {
    if (r.new_password) {
      r.pass_hash = String(r.new_password)//await bcrypt.hash(String(r.new_password), 10);
      delete r.new_password;
    }
  }
  try {
    await db.upsert_user_logins(id, rows);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

// Удалить пользователя
app.delete('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok:false, message:'bad id' });
  try {
    const ok = await db.delete_user(id);
    if (!ok) return res.status(404).json({ ok:false, message:'Not found' });
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'db error' });
  }
});

app.get('/manual',(req,res)=>{
    let files = fs.readdirSync(path.join(appDir,"public/docs"))
    console.log(files);
    res.render('manual',{
        title: 'Инструкции',
        auth: req.session.rolen,
        files:files
    });
})

let ROOMS = { }
app.get('/getvlinks',async (req,res)=>{
    let roomid = hlp.translit(req.session.name)
    if (roomid==null) {
        res.send({roomid:'Перезагрузите старницу'})
        return 1
    }
    let pub = req.query?.pub || ROOMS[roomid]?.pub || true
    let need_auth = req.query?.need_auth || ROOMS[roomid]?.need_auth || false
    let acc={pub:pub,need_auth:need_auth}
    ROOMS[roomid] = acc
    let ans = await vcall.openroom(roomid,req.session.name,`id0000${req.session.uid}`,true, acc)
    //console.log(ROOMS[roomid]);
    
    ans.roomid = `jointo?roomid=${roomid}`
    ans.acc = acc
    res.send(ans)    
})
app.get('/jointo',async (req,res)=>{
    if (req.query.roomid==undefined){
        res.redirect('/')
    }    
    let need_auth = ROOMS[req.query.roomid]?.need_auth || false
    console.log(`NEED AUTH ${need_auth}`);
    
    if (need_auth == true){
        if (req.session.name==undefined || req.session.name==null){
          res.redirect('/sso/err')
          return 1
        } 
    }
    let name = req.session.name ||= `user${Math.floor(Math.random()*100000)}`;
    let uid = req.session.uid  ||= `id0000${Math.floor(100000 + Math.random()*900000)}`;

    let roomid = hlp.translit(name)
    let admin = roomid == req.query.roomid
    
    let ans = await vcall.openroom(req.query.roomid,name,`id0000${uid}`,admin)
    res.redirect(ans.link)
    
})
app.post('/vcalllog',async (req,res)=>{
    const body = req.body || {};
    console.dir(body)
    //say(body)
    res.send('ok')
})

app.get('/rooms',async (req,res)=>{
    mlog(req.session.rolen)
    if (req.session.rolen>=1){
        let ans = await vcall.rooms_info() 
        ans.acc = ROOMS
        res.send(ans)
    } else{
        res.sendStatus(403)
    }
})

app.get('/getanalyt',async (req,res)=>{
    mlog(req.session.rolen)
    if (req.session.rolen==5){
        const query = req.query.roomid || {};
        let ans = await vcall.get_analytic(query)
        res.send(ans)
    } else{
        res.sendStatus(403)
    }
})
/*
.header-logo {
    background-image: url(./assets/imgs/app-banner.jpg) !important;
}
*/
app.get('/closeroom',async (req,res)=>{
    mlog(req.session.rolen)
    if (req.session.rolen==5){
        const query = req.query.roomid || {};
        let ans = await vcall.close_room(query)
        res.send(ans)
    } else{
        res.sendStatus(403)
    }
})

app.get('/auth',async (req,res)=>{
    if (req.query.pins!=undefined){
        let ans = await db.auth_user(req.query.pin);
        if (ans!=undefined){
            let right = await db.get_user_rights(ans.id)
            let logins = await db.get_user_logins(ans.id)
            req.session.uid = ans.id
            req.session.name = ans.name
            req.session.role = ans.role//roles[0].role
            req.session.right = ans.role
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

app.get('/logout', function(req, res) {
    mlog( req.session.name,"вышел из системы");
    req.session.uid = null;
    req.session.name = null
    req.session.uid = null
    req.session.roles = null
    //res.send('ok');
    req.session.save(function (err) {
      if (err) next(err)
      req.session.regenerate(function (err) {
        if (err) next(err)
        res.redirect('/')
      })
    })
})

// server/tg-probe.js
app.get('/tg-probe', (req, res) => {
  const ua  = req.get('user-agent') || '';
  const ref = req.get('referer') || '';
  const xrw = (req.get('x-requested-with') || '').toLowerCase();

  const isTelegramHeader =
    xrw === 'org.telegram.messenger' || xrw === 'org.telegram.messenger.web';

  const isTelegramUA = /\b(Telegram|TgApp)\b/i.test(ua);
  const isTMeRef     = /\b(t\.me|telegram\.me)\b/i.test(ref);
  mlog(xrw,
    isTelegramHeader,
    isTelegramUA,
    isTMeRef)
  res.set('Cache-Control', 'no-store');
  res.json({
    xrw,
    isTelegramHeader,
    isTelegramUA,
    isTMeRef
  });
});
//SSO
app.get("/cloud", (req, res) => {
  let login = process.env.KID_CLOUD
  let pass = process.env.KID_CLOUD

  mlog(req.session.rolen)
  switch (req.session.rolen) {
    case 1:
      login = process.env.KID_CLOUD
      pass = process.env.KID_CLOUD
    break;
    case 2:
    case 3:
    case 4:
      login = process.env.TEACH_CLOUD
      pass = process.env.TEACH_CLOUD
    break;
    case 5:
      login = process.env.DEV_KOD_USER
      pass = process.env.DEV_KOD_PASS
    break;
  default:
    res.redirect(302, process.env.KODBOX_URL);
    return 0;
  }

  let cloud_url = `${process.env.KODBOX_URL}?user/loginSubmit&name=${login}&password=${pass}&auto=1`
  return res.redirect(302, cloud_url);
});

app.get("/diary", (req, res) => {
  let creds = hlp.getLoginByService(req.session.logins, 4) 
  if (creds) {
    const ACTION = "https://club8899.studyapps.ru/user/login"; // если есть HTTPS — лучше https://

    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
      <html lang="ru"><head>
        <meta charset="utf-8">
        <title>Вход в дневник…</title>
        <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
      </head>
      <body>
        <form id="f" method="POST" action="${ACTION}">
          <input type="hidden" name="Login" value="${creds.login}">
          <input type="hidden" name="Password" value="${creds.pass}">
        </form>
        <script>document.getElementById('f').submit();</script>
        <noscript>
          <p>Нажмите кнопку для входа:</p>
          <button type="submit" form="f">Войти</button>
        </noscript>
      </body></html>`);
} else {
  return res.redirect(302, `https://club8899.studyapps.ru/user/login?ReturnUrl=%2f`);
}

});

const ACTION = "https://api.platonics.ru/teacher/login";
const TOPICS = "https://api.platonics.ru/teacher/topics/";

app.get("/tplatform", (req, res) => {
  const creds = hlp.getLoginByService(req.session.logins, 6);
  if (!creds) return res.redirect(302, "https://api.platonics.ru/fff");

  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="ru"><head>
  <meta charset="utf-8">
  <title>Вход в дневник…</title>
  <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font:16px/1.5 system-ui,Segoe UI,Roboto,Arial;padding:24px;color:#222}pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:12px;border-radius:8px}</style>
</head>
<body>
  <div id="s">Выполняется вход…</div>
  <noscript>Нужен JavaScript для входа.</noscript>
  <script>
  (async () => {
    const ACTION = "https://api.platonics.ru/teacher/login";
    const TOPICS = "https://api.platonics.ru/teacher/topics/";
    const username = ${JSON.stringify(creds.login)};
    const password = ${JSON.stringify(creds.pass)};
    const esc = (s)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");

    try {
      // 1) Логин: отправляем username/password (и дублируем login на всякий случай)
      const r = await fetch(ACTION, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ username, password, login: username })
      });
      if (!r.ok) throw new Error(await r.text().catch(()=>r.statusText));
      const data = await r.json();
      const access = data && data.access;
      if (!access) throw new Error("Нет access-токена в ответе API.");

      // 2) Запрос тем с Bearer
      const t = await fetch(TOPICS, {
        method: "GET",
        headers: { "Authorization": "Bearer " + access, "Accept": "application/json" }
      });
      if (!t.ok) throw new Error(await t.text().catch(()=>t.statusText));

      const ct = t.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await t.json();
        document.getElementById('s').innerHTML = "<h2>Темы</h2><pre>"+esc(JSON.stringify(json,null,2))+"</pre>";
      } else {
        const html = await t.text();
        document.open(); document.write(html); document.close();
      }
    } catch (err) {
      console.error(err);
      document.getElementById('s').innerHTML =
        "<p>Ошибка входа или запроса тем.</p><pre>"+esc(err && (err.message || err))+"</pre>";
    }
  })();
  </script>
</body></html>`);

});



app.get('/conf', async (req, res) => {
  const role = Number(req.session?.rolen ?? req.session?.right ?? 0);
  const canUpload = role >= 5;
  const confDir = path.join(publicPath, 'conf');

  try {
    await fs.ensureDir(confDir);
    const names = await fs.readdir(confDir);
    const files = [];

    for (const name of names) {
      const full = path.join(confDir, name);
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      files.push({
        name,
        url: `/conf/${encodeURIComponent(name)}`,
        mtimeTs: st.mtimeMs,
        mtime: new Date(st.mtimeMs).toLocaleString('ru-RU')
      });
    }

    files.sort((a, b) => b.mtimeTs - a.mtimeTs);

    res.render('conf', {
      title: 'Конфигурация',
      canUpload,
      files,
      auth: req.session?.rolen
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('errors/500', { title: 'Ошибка сервера' });
  }
});

app.post('/api/conf/upload', async (req, res) => {
  const role = Number(req.session?.rolen ?? req.session?.right ?? 0);
  if (role < 5) return res.status(403).json({ ok: false, message: 'forbidden' });

  try {
    const { filename, contentBase64 } = req.body || {};

    if (!filename || !contentBase64) {
      return res.status(400).json({ ok: false, message: 'filename/contentBase64 required' });
    }

    const safeName = path.basename(String(filename)).replace(/[^a-zA-Z0-9._\-а-яА-ЯёЁ ]/g, '_');
    if (!safeName || safeName.length > 180) {
      return res.status(400).json({ ok: false, message: 'invalid filename' });
    }

    const buf = Buffer.from(String(contentBase64), 'base64');
    if (!buf.length || buf.length > 15 * 1024 * 1024) {
      return res.status(400).json({ ok: false, message: 'invalid file size' });
    }

    const confDir = path.join(publicPath, 'conf');
    await fs.ensureDir(confDir);

    const filePath = path.join(confDir, safeName);
    await fs.writeFile(filePath, buf);

    return res.json({ ok: true, url: `/conf/${encodeURIComponent(safeName)}` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, message: 'upload failed' });
  }
});


app.get('/uagree', async (req, res) => {
  return res.redirect('/conf/Balalayka%20Terms%20Of%20Service.pdf');
});

app.get('/privacy', async (req, res) => {
  return res.redirect('/conf/Balalayka%20Privacy%20Policy%20(apple-ready).pdf');
});


app.get('/download/balalayka-android', async (req, res) => {
  const baseDir = '/var/www/html/Messanger/Android';

  try {
    const walk = async (dir) => {
      let out = [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build-cache') continue;
          out = out.concat(await walk(full));
          continue;
        }
        if (/\.apk$/i.test(e.name)) out.push(full);
      }
      return out;
    };

    const files = await walk(baseDir);
    if (!files.length) {
      return res.status(404).send('Установочный Android-файл Балалайка пока не найден.');
    }

    let latest = files[0];
    let latestMtime = 0;
    for (const f of files) {
      const st = await fs.stat(f);
      if (st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latest = f;
      }
    }

    return res.download(latest, 'Balalayka-Android.apk');
  } catch (error) {
    console.error(error);
    return res.status(500).send('Ошибка при подготовке файла.');
  }
});

app.get('*',async function(req, res){
    res.render('404', { 
        url: req.url,
        title: '404 Not Found',   
    });
});

async function start(){
    try {
        app.listen(PORT,()=> {
            mlog('Сервер - запущен')
           // say('Распределительный портал - запущен \nПорт: '+PORT)
            mlog('Порт:',PORT);
        })
    } catch (e) {
        mlog(e);
    }
}
start();

