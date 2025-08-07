const { Pool } = require("pg");
const logger = require("../utils/logger");

require("dotenv").config();

// Configure the PostgreSQL connection pool

// CRITICAL: Set this before creating the pool
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let connectionString = process.env.DATABASE_URL;
if (connectionString && connectionString.includes("?")) {
  connectionString = connectionString.split("?")[0];
}

const poolConfig = {
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false,
    require: false,
    checkServerIdentity: () => undefined,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Create the pool
const pool = new Pool(poolConfig);

// Test the connection on startup
pool.on("connect", () => {
  logger.info("Database connection established");
});

pool.on("error", (err) => {
  logger.error("Unexpected database error", { error: err.message });
});

module.exports = {
  query: (text, params) => {
    const start = Date.now();
    return pool
      .query(text, params)
      .then((res) => {
        const duration = Date.now() - start;
        logger.debug("Executed query", { text, duration, rows: res.rowCount });
        return res;
      })
      .catch((err) => {
        logger.error("Database query error", { text, error: err.message });
        throw err;
      });
  },
  pool,
};
