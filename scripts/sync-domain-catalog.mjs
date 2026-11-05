import 'dotenv/config';
import mysql from 'mysql2/promise';
import { migrateDomainCatalog } from '../vendor/domainCatalog.mjs';

const pool = mysql.createPool({
  host: process.env.MDBHOST, user: process.env.DBUSER, password: process.env.DBPASS,
  database: process.env.DBNAMES, charset: 'utf8mb4',
});
try {
  console.log(JSON.stringify(await migrateDomainCatalog(pool)));
} catch (error) {
  console.error('Domain catalog migration failed:', error.code || error.name);
  process.exitCode = 1;
} finally { await pool.end(); }
