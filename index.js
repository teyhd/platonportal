import {mlog} from './vendor/logs.js'
process.on('uncaughtException', (err) => {
mlog('Глобальный косяк приложения!!! ', err.stack);
}); //Если все пошло по ***, спасет ситуацию

import express from 'express'
import exphbs from 'express-handlebars'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs-extra'

var appDir = path.dirname(import.meta.url);
appDir = appDir.split('///')
appDir = appDir[1]

var PORT = process.env.PORT || 777;
 PORT = process.env.PORT || 80;
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
            // logman.log(opts);
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

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views','views');
app.use(express.static(path.join(appDir, 'public')));

app.use(cookieParser());
app.use(session({resave:false,saveUninitialized:false, secret: 'keyboard cat', cookie: {  }}))


app.get('/',(req,res)=>{
    let set = {s:12,m:3,h:3,l:3}
    var menu = [{
      link: "http://club8899.studyapps.ru/user/login?ReturnUrl=%2f",
      text: "Дневник",
      pic: "studyapp.png",
    },
    {
      link: "https://docs.google.com/spreadsheets/d/1GCyzhYJp6EJdZEWvYYqfBzl0762tlZjMkdB2oxD5oF8/edit#gid=1168501255",
      text: "Расписание",
      pic: "calend.png",
    },
    {
      link: "http://platon.teyhd.ru:81",
      text: "Аренда ПК",
      pic: "pc.png",
    },
    {
        link: "https://teacher.platonics.ru/",
        text: "Платформа",
        pic: "platon.png",
    },
    {
        link: "https://panel.bigbencrm.ru/web-app-3.3.8.9/#/app/teacher_home",
        text: "Геймификация",
        pic: "stud.png",
    },
    {
        link: "https://drive.google.com/drive/u/0/folders/1C5FnL33Y1KXxKzYY1A1bzOLyCt__kIOf",
        text: "Прогрес репорт",
        pic: "otrs.png",
    },
    {
      link: "/manual",
      text: "Инструкции",
      pic: "manu.png",
    },
    {
        link: "https://web.telegram.org/",
        text: "Telegream Web",
        pic: "tg.png",
    }
    ]
    var info = [{
        title:"ВАЖНО!",
        content:`Коллеги, добрый день! 
        <br>Прошу Вас быть аккуратнее с ручками, 
        <br>которые на окнах, так как одну ручку просто сломали. 
        <br>И окно невозможно закрыть и
        <br>в кабинете ужасно холодно. 
        <br>И, пожалуйста, помните
        <br>школа - это второй дом,
        <br>так как мы огромное количество
        <br>своего времени находимся здесь. 
        <br>Давайте беречь,
        <br>что у нас есть.
        <br>Благодарю за понимание.🙏🏻`
    },
    {
        title:"Контакты",
        content:`Администратор журнала, CRM - Могилянцева Ольга @ems_rosier 
        <br>По вопросам закупки канцелярии, пособий и оборудования - Тирбах  Сергей  https://t.me/Sergej_Tierbach
        <br>Кафедра математики – Евстафьева Анжелика Анжелика 
        <br>Кафедра русского языка и литературы – Золотоверхая Мария @M_Zolotoverkhaya 
        <br>Кафедра иностранного языка – Иогансен Александра Игоревна @Nesnagoi 
        <br>Кафедра информатики и ИТ – Сорокина Наталья Наталья 
        <br>Кафедра естественных наук – Коба Дарья @dashkokoba 
        <br>Кафедра истории и обществознания – Кайгородцева Софья @rinnisognatore 
        <br>Кафедра начальных классов – Иванова Елена Елена 
        <br>Кафедра наставников – Юникова Марина 
        <br>Кафедра тьюторов – Царькова Любовь Дурдымуратовна`
    },
    {
        title:"Распределение тьюторов",
        content:`Начальная школа 
        <br>1-2 классы Любовь @lubovtsarkova
        <br>3-4 классы Виктория @Ryzhaya_Viktoriya
        <br>
        <br>Средняя и старшая школа:
        <br>5 класс Виктория @Ryzhaya_Viktoriya
        <br>6 классы Лена @flyflybird
        <br>7 АРТ Анастасия
        <br>7 МИТ Любовь @lubovtsarkova
        <br>8-10 классы Дарья @d120833`
    },
    {
        title:"Информация по принтерам",
        content:`⭐️Если ваш документ полностью черно-белый - печатайте, пожалуйста, в первую очередь на принтере hp m227fdw (2644fd), если он свободен, а не на цветном epson
        <br>⭐️Черно-былый принтер в коридоре - это именно m227fdw (2644fd). Пожалуйста, не запускайте печать на принтер из 3 кабинета с похожим названием m227fdw (7c706b)
        <br>⭐️Новый маленький epson пока что еще учится печатать, в частности не знаком с macOS. Но мы его научим (оповещу). Цветная печать с mac доступна на большом epson
        <br>⭐️Если что-то идет не так при печати: замятие, ошибка, полосы и т.п., и вы не уверены в своих способностях самостоятельно решить проблему - обращайтесь напрямую ко мне (можно звонить)`
    },
    
]
    res.render('index',{
      title: 'Сервисы',
     // auth: auth,
      set: set,
      menu:menu,
      info:info
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
            mlog('Порт:',PORT);
        })
    } catch (e) {
        mlog(e);
    }
}
start();