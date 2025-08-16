import {mlog,say} from './vendor/logs.js'
process.on('uncaughtException', (err) => {
mlog('Глобальный косяк приложения!!! ', err.stack);
}); //Если все пошло по ***, спасет ситуацию
import 'dotenv/config'
import * as db from './vendor/db.mjs';
import * as hlp from './vendor/hlp.mjs';
import * as vcall from './vendor/vcall.mjs';

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
app.set('trust proxy', 1);

app.use(session({resave:true,saveUninitialized:false, secret: 'keyboard cat', cookie: 
  {secure: false, // ⚠️ обязательно false на HTTP!
  httpOnly: true}
}))

app.use(express.json()); // для application/json
app.use(async function (req, res, next) {
    let page = req._parsedOriginalUrl.pathname;
    console.log('Cookie:', req.headers.cookie);

    if (page!='/data') {
        mlog(page,req.session.uid,req.session.name,req.session.info,req.headers['nip'],hlp.getcurip(req.socket.remoteAddress),req.query)
    }
    
    //next();
    //return 1
    if (page=='/data') {
        next();
        //return 1
    }

    if (req.session.uid==undefined) { // 
        if (page!='/auth' && page!='/bauth' && page!='/data' && page!='/api/update_soft_skills' && page!='/api/update_self_prep' && page!='/api/update_individual_track' && page!='/api/update_progress_card') {
           next(); //res.redirect("/auth")
        } else next();
    } else {
        if (page=='/auth') {
            res.redirect("/")
        } else next();
    } 
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
    {
      link: "http://club8899.studyapps.ru/user/login?ReturnUrl=%2f",
      text: "Дневник",
      pic: "studyapp.png",
    },
   /* {
        link: "http://platon.teyhd.ru:88",
        text: "Закупки",
        pic: "order.png",
    },


    {
      link: "https://docs.google.com/spreadsheets/d/1JiMIcnklI7CGoP-Mfc_kqghuo71kFLfccVtsc6eH_Rw/edit?gid=1961581949#gid=1961581949",
      text: "Расписание",
      pic: "calend.png",
    },*/
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
    mlog(req.session.role)
    if(req.session.role>=2){
        menu.unshift(
        {
            link: "#lesson",
            text: "V.CALL - онлайн урок",
            pic: "vcall.png",
        }
    )    }
    if (req.session.role>=2){
        menu.push(
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

       /* {
            link: "http://port.platoniks.ru",
            text: "Docker",
            pic: "port.png",
        },*/
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
app.get('/auth',async (req,res)=>{
    console.log(req.query);
    if (req.query.pin!=undefined){
        let ans = await db.auth_user(req.query.pin);
        if (ans!=undefined){
            req.session.uid = ans.id
            req.session.name = ans.name
            let roles = await db.get_roles(req.session.uid)
            console.log(roles);
            mlog(roles[0].role)
            req.session.role = roles[0].role
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
