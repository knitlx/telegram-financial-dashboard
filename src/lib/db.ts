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
    // WARNING: Disabling rejectUnauthorized makes the connection less secure.
    // This is often done for convenience in development or for prototypes
    // when dealing with self-signed certs or environments where CA certs are hard to manage.
    // For production, consider providing a trusted CA certificate.
    rejectUnauthorized: false, 
  },
});

export { pool };
