import {mlog,say} from './vendor/logs.js'
process.on('uncaughtException', (err) => {
mlog('Глобальный косяк приложения!!! ', err.stack);
}); //Если все пошло по ***, спасет ситуацию
import 'dotenv/config'
import * as db from './vendor/db.mjs';
mlog(await db.getUsers());
import express from 'express'
import exphbs from 'express-handlebars'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs-extra'
import { fileURLToPath } from 'url';

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
app.use(session({name: 'login',resave:false,saveUninitialized:false, secret: 'platonsecretcokie', cookie: { domain: ".platoniks.ru" }}));

app.use(async function (req, res, next) {
    let page = req._parsedOriginalUrl.pathname;
    req.session.test == undefined ? req.session.test = 0 : req.session.test
    mlog(req.session);
    mlog("ТЕСТ",req.session.test)
    req.session.counter = req.session.counter || 0;
    req.session.test = req.session.test+1
    mlog(page,req.headers['nip'],req.query)
    next();
})

app.get('/e',(req,res)=>{
    req.session.test = 0
    res.sendStatus(200)
})

app.get('/',(req,res)=>{
    var menu = [
    {
        link: "http://cloud.platoniks.ru",
        text: "Облако",
        pic: "cloud.png",
    },
    {
        link: "https://pc.platoniks.ru",
        text: "Аренда ПК",
        pic: "pc.png",
    },
    {
        link: "https://rep.platoniks.ru/",
        text: "Прогресс репорт",
        pic: "grp.png",
    },
    {
        link: "https://t.me/platonicsbot",
        text: "Бот Платоникс",
        pic: "tg.png",
    },
   /* {
        link: "http://platon.teyhd.ru:88",
        text: "Закупки",
        pic: "order.png",
    },*/
    {
      link: "http://club8899.studyapps.ru/user/login?ReturnUrl=%2f",
      text: "Дневник",
      pic: "studyapp.png",
    },

    {
        link: "https://teacher.platonics.ru/",
        text: "Платформа",
        pic: "platon.png",
    },
    {
        link: "https://vote.platoniks.ru/",
        text: "Черный ящик",
        pic: "vote.png",
    },

    {
      link: "/manual",
      text: "Инструкции",
      pic: "manu.png",
    },
    {
        link: "https://forms.gle/MmGPPEBr51uWj93Q9",
        text: "Геймификация",
        pic: "stud.png",
    },
        {
      link: "https://docs.google.com/spreadsheets/d/1JiMIcnklI7CGoP-Mfc_kqghuo71kFLfccVtsc6eH_Rw/edit?gid=1961581949#gid=1961581949",
      text: "Расписание",
      pic: "calend.png",
    }
    ]

    if (req.session.role>0){
        menu.unshift(
        {
            link: "http://platon.teyhd.ru:86/upd",
            text: "Расписание",
            pic: "time.png",
        },
        {
            link: "https://pc.platoniks.ru/ctrl",
            text: "Управление ПК",
            pic: "pc.png",
        },
        {
        link: "http://activ.platoniks.ru",
        text: "NODE JS панель",
        pic: "node.png",
        },
        {
            link: "http://db.platoniks.ru",
            text: "База данных",
            pic: "db.png",
        },
        {
            link: "http://plex.platoniks.ru/web/index.html#!/",
            text: "PLEX",
            pic: "plex.png",
        },
        {
            link: "http://port.platoniks.ru",
            text: "Docker",
            pic: "port.png",
        },
        {
            link: "http://vpn.platoniks.ru/",
            text: "VPN",
            pic: "vpn.png",
        },
        {
            link: "https://tilda.ru/projects/",
            text: "Tilda",
            pic: "tilda.png",
        },
        {
            link: "https://photo.platoniks.ru",
            text: "Фото",
            pic: "photo.png",
        }
    )
}

    var info = [{
        title:"Сервисы Платоникса!",
        content: "Добро пожаловать на страницу с важными сервисами для сотрудников компании! Здесь представлена коллекция ссылок на ключевые ресурсы, которые помогут вам в работе. От инструментов управления проектами до внутренних порталов и обучающих материалов. Используйте эту страницу для повышения продуктивности и эффективности!"
    },
    {
        title:"WIFI Пароли",
        content: `Пароли от WIFI
TSchool_Sibur
platon2023`
    },
    
    {
        title:"Распределение наставников",
        content:`1 класс — Алина 
2-3-4 классы — Миша 
5-6 классы и Святогор — Нина 
7-е классы — Полина 
8-е классы — Элина 
9 класс — Семен 
10-11 классы — Никита `
    },
    {
        title:"Распределение тьюторов",
        content:`1 класс — Виктория 
2-3 классы — Любовь 
4-5 классы — Виктория 
6 класс — Дарья 
7-е классы — Константин 
8 АРТ — Константин 
8 МИТ — Любовь 
9-10-11 классы — Дарья`
    },
    {
        title:"Основные контакты",
        content:`Администратор журнала, CRM - Могилянцева Ольга @ems_rosier 
По вопросам закупки канцелярии, пособий и оборудования - <a href="https://t.me/Sergej_Tierbach">Тирбах Сергей</a> 
⭐️ Кафедра математики – Евстафьева Анжелика Анжелика 
⭐️ Кафедра русского языка и литературы – Золотоверхая Мария @M_Zolotoverkhaya 
⭐️ Кафедра иностранного языка – Иогансен Александра Игоревна @Nesnagoi 
⭐️ Кафедра информатики и ИТ – Сорокина Наталья Наталья 
⭐️ Кафедра естественных наук – Коба Дарья @dashkokoba 
⭐️ Кафедра истории и обществознания – Кайгородцева Софья @rinnisognatore 
⭐️ Кафедра начальных классов – Иванова Елена Елена 
⭐️ Кафедра наставников – Юникова Марина 
⭐️ Кафедра тьюторов – Царькова Любовь Дурдымуратовна`
    },  
        {
        title:"Звонки",
        content:`0	8:45	-	9:00
        1	9:00	-	9:40
        1+	9:40	-	9:55
        2	9:55	-	10:35
        3	10:40	-	11:20
        4	11:25	-	12:05
        4+	12:05	-	12:15
        5	12:15	-	12:55
        5+	12:55	-	13:05
        5++	13:05	-	13:45
        6	13:55	-	14:35
        6+	14:35	-	14:45
        7	14:45	-	15:25
        7+	15:25	-	15:35
        8	15:35	-	16:15
        8+	16:15	-	16:25
        9	16:25	-	17:05
        10	17:15	-	17:55
        11	18:00	-	18:40`
    },
]

    res.render('new',{
      title: 'Гармония Образования',
      menu:menu,
      info:info,
      auth: req.session.role
    });
  })

app.get('/manual',(req,res)=>{
    let files = fs.readdirSync(path.join(appDir,"public/docs"))
    console.log(files);
    res.render('manual',{
        title: 'Инструкции',
        // auth: auth,
        files:files
    });
})

app.get('/auth',async (req,res)=>{
    console.log(req.query);
    if (req.query.pass!=undefined) {
        let ans = await auth_user(req.query.pass);
        mlog(ans);
        if (ans!=undefined){
            req.session.name = ans.name
            req.session.userid = ans.id
            req.session.role = ans.role
            res.send('ok')
        } else {
            res.send('nok')
        }
    } else{
        res.render('auth',{
            title: 'Авторизация',
            auth: req.session.role
        });
    }
}) 

async function auth_user(pass) {
    if(pass=='pladmin'){
        return {
            id: 1,
            name: 'Администратор',
            role: 2
        }
    }
}

app.get('/logout', function(req, res, next) {
  const username = req.session?.name;
  mlog(username, 'вышел из системы');

  req.session.destroy(function(err) {
    if (err) return next(err);
    res.redirect('/');
  });
});

app.get('*',async function(req, res){
    res.render('404', { 
        url: req.url,
        title: '404 Not Found',   
    });
});
function getcurip(str) {
    let arr = str.split(':');
    arr = arr[arr.length-1];
    return arr;
}
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
