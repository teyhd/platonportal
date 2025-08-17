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

app.get('/',async (req,res)=>{
    let rolen = req.session.role ?? 0;
    let cards = await db.get_cards(rolen)
    let menu = cards.filter(c => c.type === 0);
    let info = cards.filter(c => c.type === 1);
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
app.get('/vcalllogg',async (req,res)=>{
    mlog(req.query)
    res.send('ok')
})
app.get('/rooms',async (req,res)=>{
    if (req.session.role>1){
        let ans = await vcall.rooms_info() 
        console.log(ans);
        res.send(ans)
    } else{
        res.sendStatus(403)
    }

})
app.get('/auth',async (req,res)=>{
    console.log(req.query);
    if (req.query.pin!=undefined){
        let ans = await db.auth_user(req.query.pin);
        if (ans!=undefined){
            req.session.uid = ans.id
            req.session.name = ans.name
           /* let roles = await db.get_roles(req.session.uid)
            console.log(roles);
            mlog(roles[0].role)*/
            req.session.role = ans.role//roles[0].role
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
