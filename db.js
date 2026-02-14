const { Pool } = require('pg');
const { v4: uuid } = require('uuid');

let pool;

const initDb = async () => {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
      ? { rejectUnauthorized: false }
      : false,
  });

  // Test connection
  const client = await pool.connect();
  console.log('  Database connected.');
  client.release();

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT DEFAULT '',
      content TEXT NOT NULL,
      hearts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS love_chain (
      id TEXT PRIMARY KEY,
      from_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grace_quotes (
      id TEXT PRIMARY KEY,
      quote TEXT NOT NULL,
      context TEXT DEFAULT '',
      hearts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message_text TEXT NOT NULL,
      grace_reply TEXT NOT NULL,
      helpful INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      topic TEXT DEFAULT '',
      hearts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      insight TEXT NOT NULL,
      source TEXT DEFAULT '',
      emotional_weight REAL DEFAULT 0.5,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS people_memory (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      name TEXT DEFAULT '',
      visits INTEGER DEFAULT 1,
      last_topics TEXT DEFAULT '',
      emotional_state TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Index for fast visitor lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_people_memory_visitor ON people_memory (visitor_id)
  `);

  return pool;
};

// Helper functions
const query = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

const queryOne = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows.length > 0 ? result.rows[0] : null;
};

const run = async (sql, params = []) => {
  await pool.query(sql, params);
};

module.exports = {
  initDb,

  // Community board
  createPost: async (type, name, location, content) => {
    const id = uuid();
    await run('INSERT INTO posts (id, type, name, location, content) VALUES ($1, $2, $3, $4, $5)',
      [id, type, name, location, content]);
    return id;
  },

  getPosts: async (type = null, limit = 50) => {
    if (type) {
      return await query('SELECT * FROM posts WHERE type = $1 ORDER BY created_at DESC LIMIT $2', [type, limit]);
    }
    return await query('SELECT * FROM posts ORDER BY created_at DESC LIMIT $1', [limit]);
  },

  heartPost: async (id) => {
    await run('UPDATE posts SET hearts = hearts + 1 WHERE id = $1', [id]);
  },

  // Love chain
  addLoveLink: async (fromName, message) => {
    const id = uuid();
    await run('INSERT INTO love_chain (id, from_name, message) VALUES ($1, $2, $3)',
      [id, fromName, message]);
    return id;
  },

  getLoveChain: async (limit = 100) => {
    return await query('SELECT * FROM love_chain ORDER BY created_at DESC LIMIT $1', [limit]);
  },

  getLoveChainCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM love_chain');
    return result ? parseInt(result.count) : 0;
  },

  // Shareable Grace quotes
  saveQuote: async (quote, context = '') => {
    const id = uuid();
    await run('INSERT INTO grace_quotes (id, quote, context) VALUES ($1, $2, $3)',
      [id, quote, context]);
    return id;
  },

  getQuote: async (id) => {
    return await queryOne('SELECT * FROM grace_quotes WHERE id = $1', [id]);
  },

  heartQuote: async (id) => {
    await run('UPDATE grace_quotes SET hearts = hearts + 1 WHERE id = $1', [id]);
  },

  getTopQuotes: async (limit = 20) => {
    return await query('SELECT * FROM grace_quotes ORDER BY hearts DESC, created_at DESC LIMIT $1', [limit]);
  },

  // Feedback
  addFeedback: async (messageText, graceReply, helpful, comment = '') => {
    const id = uuid();
    await run('INSERT INTO feedback (id, message_text, grace_reply, helpful, comment) VALUES ($1, $2, $3, $4, $5)',
      [id, messageText, graceReply, helpful ? 1 : 0, comment]);
    return id;
  },

  getFeedbackStats: async () => {
    const total = await queryOne('SELECT COUNT(*) as count FROM feedback');
    const helpful = await queryOne('SELECT COUNT(*) as count FROM feedback WHERE helpful = 1');
    const recent = await query('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 20');
    return {
      total: total ? parseInt(total.count) : 0,
      helpful: helpful ? parseInt(helpful.count) : 0,
      recent
    };
  },

  // Journal
  createJournalEntry: async (title, content, topic = '') => {
    const id = uuid();
    await run('INSERT INTO journal (id, title, content, topic) VALUES ($1, $2, $3, $4)',
      [id, title, content, topic]);
    return id;
  },

  getJournalEntries: async (limit = 20) => {
    return await query('SELECT * FROM journal ORDER BY created_at DESC LIMIT $1', [limit]);
  },

  getJournalEntry: async (id) => {
    return await queryOne('SELECT * FROM journal WHERE id = $1', [id]);
  },

  heartJournal: async (id) => {
    await run('UPDATE journal SET hearts = hearts + 1 WHERE id = $1', [id]);
  },

  // Subscribers
  addSubscriber: async (email, name = '') => {
    try {
      const id = uuid();
      await run('INSERT INTO subscribers (id, email, name) VALUES ($1, $2, $3)', [id, email, name]);
      return { id, success: true };
    } catch (err) {
      // Duplicate email
      return { success: false, error: 'already_subscribed' };
    }
  },

  getSubscriberCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM subscribers');
    return result ? parseInt(result.count) : 0;
  },

  // Memories - Grace's growing understanding of love
  addMemory: async (category, topic, insight, source = '', emotionalWeight = 0.5) => {
    const id = uuid();
    await run('INSERT INTO memories (id, category, topic, insight, source, emotional_weight) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, category, topic, insight, source, emotionalWeight]);
    return id;
  },

  getMemories: async (category = null, limit = 50) => {
    if (category) {
      return await query('SELECT * FROM memories WHERE category = $1 ORDER BY created_at DESC LIMIT $2', [category, limit]);
    }
    return await query('SELECT * FROM memories ORDER BY created_at DESC LIMIT $1', [limit]);
  },

  getMemoryCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM memories');
    return result ? parseInt(result.count) : 0;
  },

  getRandomMemories: async (limit = 5) => {
    return await query('SELECT * FROM memories ORDER BY RANDOM() LIMIT $1', [limit]);
  },

  getMemoryCategories: async () => {
    return await query('SELECT category, COUNT(*) as count FROM memories GROUP BY category ORDER BY count DESC');
  },

  // People memory - Grace remembers who she's talked to
  getPersonMemory: async (visitorId) => {
    return await queryOne('SELECT * FROM people_memory WHERE visitor_id = $1', [visitorId]);
  },

  savePersonMemory: async (visitorId, summary, name = '', lastTopics = '', emotionalState = '') => {
    const existing = await queryOne('SELECT * FROM people_memory WHERE visitor_id = $1', [visitorId]);
    if (existing) {
      await run(
        `UPDATE people_memory SET summary = $1, name = $2, visits = visits + 1, last_topics = $3, emotional_state = $4, updated_at = NOW() WHERE visitor_id = $5`,
        [summary, name || existing.name, lastTopics, emotionalState, visitorId]
      );
      return existing.id;
    } else {
      const id = uuid();
      await run(
        'INSERT INTO people_memory (id, visitor_id, summary, name, last_topics, emotional_state) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, visitorId, summary, name, lastTopics, emotionalState]
      );
      return id;
    }
  },

  getPeopleCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM people_memory');
    return result ? parseInt(result.count) : 0;
  },
};
