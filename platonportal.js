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
//import kodSsoRouter from "./vendor/kod-sso.mjs";

import express from 'express'
import exphbs from 'express-handlebars'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url';
import { console } from 'inspector/promises';

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
app.use(express.static(publicPath));

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
  }
}));

app.use(express.json()); // для application/json
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

app.get('/',async (req,res)=>{
   
    let rolen = 0
    try {
        rolen = req.session.right ?? 0;
        rolen = hlp.getRolesBySrvId(rolen,1)
        req.session.rolen = rolen
    } catch (error) {
        mlog(error);
    }
    console.log(rolen);

    let cards = await db.get_cards(rolen)
    res.render('new',{
      title: 'Гармония Образования',
      menu:cards.filter(c => c.type === 0),
      info:cards.filter(c => c.type === 1),
      auth: rolen
    });
  })

// === Страница users.hbs (добавляем allRoles, services для панели) ===
app.get('/users', async (req, res) => {
  const rolen = Number(req.session?.right ?? 0);
  if (rolen < 5) return res.redirect('/');

  try {
    const users    = await db.get_users();
    const types    = await db.get_types();
    const services = await db.get_services_with_allowed_roles(); // для вкладок/панели
    const allRoles = await db.get_all_roles();

    res.render('users', {
      title: 'Пользователи',
      users,
      types,
      services,
      allRoles,
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
  res.json({ ok:true, user, rights, logins });
});

// Создать пользователя
app.post('/api/users', async (req, res) => {
  const body = req.body || {};
  const data = {
    name: String(body.name ?? '').trim(),
    kaf:  String(body.kaf ?? '').trim(),
    type: Number(body.type ?? 0),
    status: Number(body.status ?? 0),
    pin:  String(body.pin ?? '').trim(),
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
    kaf:  String(body.kaf ?? '').trim(),
    type: Number(body.type ?? 0),
    status: Number(body.status ?? 0),
    pin:  String(body.pin ?? '').trim(),
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
app.get('/getvlinks',async (req,res)=>{
    let roomid = hlp.translit(req.session.name)
    let ans = await vcall.openroom(roomid,req.session.name,`id0000${req.session.uid}`,true)
    console.log(ans);
    ans.roomid = `jointo?roomid=${roomid}`
    res.send(ans)    
})
app.get('/jointo',async (req,res)=>{
    if (req.query.roomid==undefined){
        res.redirect('/')
    }    
    let name = req.session.name ||= `user${Math.floor(Math.random()*100000)}`;
    let uid = req.session.uid  ||= `id0000${Math.floor(100000 + Math.random()*900000)}`;

    let roomid = hlp.translit(name)
    let admin = roomid == req.query.roomid
    
    let ans = await vcall.openroom(req.query.roomid,name,`id0000${uid}`,admin)
    console.log(ans);
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
        console.log(ans);
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
        console.log(ans);
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
        console.log(ans);
        res.send(ans)
    } else{
        res.sendStatus(403)
    }
})

app.get('/auth',async (req,res)=>{
    console.log(req.query);
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
        mlog(ans);
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
    console.dir(req.session)
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

  res.set('Cache-Control', 'no-store');
  res.json({
    xrw,
    isTelegramHeader,
    isTelegramUA,
    isTMeRef
  });
});

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
  mlog(cloud_url)
  return res.redirect(302, cloud_url);
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
