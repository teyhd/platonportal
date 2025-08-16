export function getCurrentUnixTime() {
    return Math.floor(new Date().getTime() / 1000);
  }

export function formatUnixTime(unixTime) {
// Преобразование Unix time в миллисекунды
var dateTime = new Date(unixTime * 1000);

// Получение компонентов времени
var day = dateTime.getDate();
var month = dateTime.getMonth() + 1; // Месяцы в JavaScript начинаются с 0
var year = dateTime.getFullYear();

var hours = dateTime.getHours();
var minutes = dateTime.getMinutes();
var seconds = dateTime.getSeconds();

// Добавление ведущих нулей при необходимости
day = (day < 10) ? '0' + day : day;
month = (month < 10) ? '0' + month : month;
hours = (hours < 10) ? '0' + hours : hours;
minutes = (minutes < 10) ? '0' + minutes : minutes;
seconds = (seconds < 10) ? '0' + seconds : seconds;

// Формирование строки в нужном формате
var formattedTime = day + '.' + month + ' ' + hours + ':' + minutes + ':' + seconds;

return formattedTime;
}
export function translit(str) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
    'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
    'э':'e','ю':'yu','я':'ya'
  };
  return str.toLowerCase()
            .replace(/\s+/g, '')        // удаляем пробелы
            .split('')
            .map(ch => map[ch] ?? ch)   // транслитерация
            .join('');
}

// Пример:
console.log(translit("Привет Мир")); // privetmir

export function getcurip(str) {
    let arr = str.split(':');
    arr = arr[arr.length-1];
    return arr;
}

export function ucFirst(str) {
  if (!str) return str;

  return str[0].toUpperCase() + str.slice(1);
} //Поднять первую букву
export function formatEpochToDate(epochStr) {
  const date = new Date(epochStr);
  if (isNaN(date)) return null; // безопасная проверка

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // формат DATE
}
export function strtodate(dateString){
  const parts = dateString.split('.');
    
    // Создаем объект Date, указывая год, месяц и день
    // (обратите внимание, что месяцы в объекте Date начинаются с 0, поэтому вычитаем 1 из номера месяца)
    const dateObject = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));

    // Получаем год, месяц и день из объекта Date
    const year = dateObject.getFullYear();
    const month = (dateObject.getMonth() + 1).toString().padStart(2, '0'); // Добавляем ведущий ноль, если месяц состоит из одной цифры
    const day = dateObject.getDate().toString().padStart(2, '0'); // Добавляем ведущий ноль, если день состоит из одной цифры

    // Формируем строку в формате MySQL (YYYY-MM-DD)
    const mysqlDate = `${year}-${month}-${day}`;

    return mysqlDate;
}

export function strtotime(dateString){
  const parts = dateString.split(':');
    const mysqlDate = `${curtime(parseInt(parts[0]))}:${curtime(parseInt(parts[1]))}:00`;
    return mysqlDate;
}

function curtime(p) {
  p<10 ? p = `0${p}` : p = p
  return p
}