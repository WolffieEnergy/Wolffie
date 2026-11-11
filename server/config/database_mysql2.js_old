// Core database wrapper for auth services
import mysql from 'mysql2/promise';  // ← Change this line!
import dotenv from 'dotenv';

dotenv.config();

// Create connection pool (already promise-based)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'alpha_ess',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection on startup
pool.query('SELECT 1')
  .then(() => {
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

export default {
  pool
};