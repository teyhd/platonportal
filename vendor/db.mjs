import mysql from 'mysql2'
let sets = {
    host: process.env.MDBHOST,
    user: process.env.DBUSER,
    password : process.env.DBPASS,
    database: process.env.DBNAMES,
    charset : 'utf8mb4_general_ci',
    waitForConnections: true,
    connectionLimit: 100,
    maxIdle: 100, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 200, // idle connections timeout, in milliseconds, the default value 60000
    queueLimit: 0,
    enableKeepAlive: false,
    keepAliveInitialDelay: 0
}
const pool = mysql.createPool(sets).promise()

export async function auth_user(pin){
    const qer = `SELECT id,name FROM users WHERE pin = ${pin}`
    const [rows, fields] = await pool.query(qer)
    return rows[0];
}

export async function get_roles(uid){
  const qer = `SELECT max(ROLE) as role FROM roles WHERE user_id = ${uid}`
  const [rows, fields] = await pool.query(qer)
  return rows;
}
