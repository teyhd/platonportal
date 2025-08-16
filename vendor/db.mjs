// db/postgres.js
import pkg from 'pg';
const { Pool } = pkg;

const pgPool = new Pool({
  host: process.env.MDBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASS,
  database: process.env.DBNAMES,
  port: 5432,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pgPool.on('connect', () => {
  console.log('PostgreSQL подключён через пул');
});

pgPool.on('error', (err) => {
  console.error('Ошибка в пуле PostgreSQL:', err);
});
const info = await pgPool.query('SELECT current_user, current_database()');
console.log(info.rows);

const res = await pgPool.query(`
  SELECT table_schema, table_name 
  FROM information_schema.tables 
  WHERE table_name ILIKE 'btns'
`);
console.log(res.rows);



export async function getUsers() {
  const res =  await pgPool.query('SELECT * FROM btns;');
  console.log(res.rows);
}
export default pgPool;