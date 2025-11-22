import { Pool } from 'pg';

// Ensure DATABASE_URL is set in environment variables
// Next.js automatically loads .env.local in development
// and provides process.env variables in production
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // For Supabase, often you need to set rejectUnauthorized to false in development
    // Be cautious with this in production; ensure you understand the implications
    rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false,
  },
});

export { pool };
