import { Pool, type PoolConfig } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

const config: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
};

if (process.env.PGSSLMODE !== 'disable') {
  config.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(config);

export { pool };
