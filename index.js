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
let iswin = true
var appDir = path.dirname(import.meta.url);
appDir = appDir.split('//')
appDir = appDir[1]

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

if (iswin) {
    app.set('views',path.join('views'));
    app.use(express.static('public'));
} else{
    app.set('views',path.join(appDir, 'views'));
    mlog(path.join(appDir, 'public'));
    app.use(express.static(path.join(appDir, 'public')));
}

app.use(cookieParser());
app.use(session({name: 'login',resave:false,saveUninitialized:false, secret: 'keyboard cat', cookie: { domain: "platoniks.ru" }}));

app.use(async function (req, res, next) {
    let page = req._parsedOriginalUrl.pathname;
    req.session.test == undefined ? req.session.test = 0 : req.session.test
    mlog(req.session);
    mlog("ТЕСТ",req.session.test)
    req.session.counter = req.session.counter || 0;
    req.session.test = req.session.test+1
    next();
    
    mlog(page,req.headers['nip'],req.query)
    
})

app.get('/e',(req,res)=>{
    req.session.test = 0
    res.sendStatus(200)
})

app.get('/',(req,res)=>{
    let set = {s:12,m:3,h:3,l:3}
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
        title:"Сервисы Платоникса!",
        content:`Добро пожаловать на страницу
        <br> с полезными сервисами для сотрудников компании! 
        <br> Здесь вы найдете удобную коллекцию ссылок
        <br>на все необходимые ресурсы, 
        <br> помогающие в работе. 
        <br> От инструментов для управления проектами
        <br> до внутренних порталов и 
        <br> обучающих материалов 
        <br><br>Используйте эту страницу 
        <br для максимальной продуктивности 
        <br>и эффективности в работе!`
    },
    
    {
        title:"Звонки",
        content:`
        0	8:45	-	9:00
        <br>1	9:00	-	9:40
        <br>1+	9:40	-	9:55
        <br>2	9:55	-	10:35
        <br>3	10:40	-	11:20
        <br>4	11:25	-	12:05
        <br>4+	12:05	-	12:15
        <br>5	12:15	-	12:55
        <br>5+	12:55	-	13:05
        <br>5++	13:05	-	13:45
        <br>6	13:55	-	14:35
        <br>6+	14:35	-	14:45
        <br>7	14:45	-	15:25
        <br>7+	15:25	-	15:35
        <br>8	15:35	-	16:15
        <br>8+	16:15	-	16:25
        <br>9	16:25	-	17:05
        <br>10	17:15	-	17:55
        <br>11	18:00	-	18:40`
    },
    {
        title:"Распределение наставников",
        content:`Начальная школа 
        <br>1-4 классы: Михаил Арапов (@doubleHeart_tyler) 
        <br>Нина Долганова (@heather_alle)
        <br><br>5 и 6 АРТ: Ольга Гриценко (@OlgaGritsenkoo)
        <br>6 МИТ: Диана Наговицына (@dianchik_01n)
        <br>7 классы: Юрий Жабин (@Puree_Johnson)
        <br>8-10 классы: Алиса Новикова (@NovikovaAlisa)`
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
        title:"Основные контакты",
        content:`Администратор журнала, CRM - Могилянцева Ольга @ems_rosier 
        <br>По вопросам закупки канцелярии, пособий и оборудования - Тирбах  Сергей  https://t.me/Sergej_Tierbach
        <br>⭐️ Кафедра математики – Евстафьева Анжелика Анжелика 
        <br>⭐️ Кафедра русского языка и литературы – Золотоверхая Мария @M_Zolotoverkhaya 
        <br>⭐️ Кафедра иностранного языка – Иогансен Александра Игоревна @Nesnagoi 
        <br>⭐️ Кафедра информатики и ИТ – Сорокина Наталья Наталья 
        <br>⭐️ Кафедра естественных наук – Коба Дарья @dashkokoba 
        <br>⭐️ Кафедра истории и обществознания – Кайгородцева Софья @rinnisognatore 
        <br>⭐️ Кафедра начальных классов – Иванова Елена Елена 
        <br>⭐️ Кафедра наставников – Юникова Марина 
        <br>⭐️ Кафедра тьюторов – Царькова Любовь Дурдымуратовна`
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
      title: 'Сервисы Платоникса',
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

app.get('/auth',async (req,res)=>{
    console.log(req.query);
    if (req.query.pass!=undefined) {
        let ans = await auth_user(req.query.login,req.query.pass);
        mlog(ans);
        if (ans!=undefined){
            req.session.name = ans.name
            req.session.userid = ans.id
            res.send('ok')
        } else {
            res.send('nok')
        }
    } else{
        res.render('auth',{
            title: 'Авторизация',
            //auth: req.session.userid
        });
    }
}) 

app.get('/logout', function(req, res) {
    mlog( req.session.name,"вышел из системы");
    req.session = null;
    req.session.test = null
    req.session.userid = null
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
function getcurip(str) {
    let arr = str.split(':');
    arr = arr[arr.length-1];
    return arr;
}
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
