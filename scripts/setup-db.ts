import { sql } from '@vercel/postgres';

async function setup() {
  try {
    // Waitlist table
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        email_sent BOOLEAN DEFAULT FALSE,
        email_error TEXT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email)
    `;

    // Demo requests table
    await sql`
      CREATE TABLE IF NOT EXISTS demo_requests (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        is_in_sf BOOLEAN DEFAULT FALSE,
        neighborhood VARCHAR(255),
        preferred_time VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        email_sent BOOLEAN DEFAULT FALSE,
        email_error TEXT
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email)
    `;

    console.log('Database setup complete!');
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setup();
