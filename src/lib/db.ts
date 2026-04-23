import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

const config: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
};

if (process.env.PGSSLMODE !== 'disable') {
  if (process.env.PGSSL_INSECURE === 'true') {
    config.ssl = { rejectUnauthorized: false };
  } else {
    config.ssl = {};
  }
}

const pool = new Pool(config);

async function query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export { pool, query };
