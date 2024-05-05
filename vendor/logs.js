import fs from 'fs-extra'
import path from 'path'

import request from 'request'
import rp from 'request-promise'
import urlencode from 'urlencode'

function curdate(minute){
    minute = (minute < 10) ? '0' + minute : minute;
    return minute;
  }
  

export function mlog (par) {
    let datecreate = new Date();
    let texta = `\n ${curdate(datecreate.getHours())}:${curdate(datecreate.getMinutes())}:${curdate(datecreate.getSeconds())}`;
    let obj = arguments;
  
    for (const key in obj) {
      if (typeof obj[key]=='object') {
        for (const keys in obj[key]){
          texta = `${texta} \n ${keys}:${obj[key][keys]}`
        }
      } else {
        texta = `${texta} ${obj[key]}`
      }
      
    } 
    fs.writeFileSync(path.join(`${curdate(datecreate.getDate())}.${curdate(datecreate.getMonth()+1)} log.txt`),
    texta,
    {
      encoding: "utf8",
      flag: "a+",
      mode: 0o666
    });
  
    console.log(texta);
    return texta
  }
export function say(msg,all=false) {
  var numb = ['79176334420','79112315301']
  var tgnum = [304622290,1213835363]
  if (all===true){
    numb.forEach(element => {
      setTimeout(() => send(element,msg), 1500);
    });
    tgnum.forEach(element => {
      setTimeout(() => sendtg(element,msg), 1500);
    });
  } else{
    setTimeout(() => send(numb[0],msg), 1500);
    setTimeout(() => sendtg(tgnum[0],msg), 1500);
  }
  
}
function send(num,msg) {
  rp(`http://websrv:3333/?msg=${urlencode(msg)}&num=${urlencode(num)}`)
  .then(function (body) {
      console.log('Отправка сообщения - пришло:', body); // Print the HTML for the Google homepage.
      return body
  })
  .catch(function (err) {
    //console.dir(err);
  });
}

function sendtg(num,msg) {
  rp(`http://localhost:3334/?msg=${urlencode(msg)}&num=${urlencode(num)}`)
  .then(function (body) {
      console.log('Отправка сообщения - пришло:', body); // Print the HTML for the Google homepage.
      return body
  })
  .catch(function (err) {
    //console.dir(err);
  });
}

export function senderr(num,msg,pic) {
  senderrtg(num,msg,pic)
  const mail = require('./smail.js');
  mail.sendmailerr(msg,`http://news.pansion.spb.ru:500/err/${pic}`,pic)
  rp(`http://websrv:3333/err?msg=${urlencode(msg)}&num=${urlencode(num)}&pic=${urlencode(`http://news.pansion.spb.ru:500/err/${pic}`)}`)
  .then(function (body) {
      console.log('Отправка сообщения - пришло:', body); // Print the HTML for the Google homepage.
      return body
  })
  .catch(function (err) {
    console.dir(err);
  });
}

function senderrtg(num,msg,pic) {
  rp(`http://localhost:3334/err?msg=${urlencode(msg)}&num=${urlencode(num)}&pic=${urlencode(`http://news.pansion.spb.ru:500/err/${pic}`)}`)
  .then(function (body) {
      console.log('Отправка сообщения - пришло:', body); // Print the HTML for the Google homepage.
      return body
  })
  .catch(function (err) {
    console.dir(err);
  });
}
