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

  // Add unsubscribe token to subscribers if not present
  await pool.query(`
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT
  `);
  await pool.query(`
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true
  `);
  // Track when each subscriber last received a newsletter
  await pool.query(`
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_newsletter_at TIMESTAMPTZ
  `);

  // Newsletter history
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletters (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_text TEXT NOT NULL,
      source_type TEXT DEFAULT 'heartbeat',
      recipients_count INTEGER DEFAULT 0,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Auto-generated SEO reach pages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reach_pages (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target_searches TEXT NOT NULL,
      body_html TEXT NOT NULL,
      source_memories TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Persistent builder-Grace conversations (for TikTok series etc)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS builder_chats (
      id TEXT PRIMARY KEY,
      day_number INTEGER NOT NULL,
      title TEXT DEFAULT '',
      messages JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Grace's emotional brain states
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grace_states (
      id TEXT PRIMARY KEY,
      emotional_state JSONB NOT NULL,
      trigger_context TEXT DEFAULT '',
      conversation_snippet TEXT DEFAULT '',
      visitor_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_grace_states_created ON grace_states (created_at DESC)
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
      const unsubscribeToken = uuid();
      await run(
        'INSERT INTO subscribers (id, email, name, unsubscribe_token, active) VALUES ($1, $2, $3, $4, true)',
        [id, email, name, unsubscribeToken]
      );
      return { id, success: true, unsubscribeToken };
    } catch (err) {
      // Duplicate email
      return { success: false, error: 'already_subscribed' };
    }
  },

  getSubscriberCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM subscribers WHERE active = true OR active IS NULL');
    return result ? parseInt(result.count) : 0;
  },

  getActiveSubscribers: async (limit = 90) => {
    // Prioritize subscribers who haven't received a newsletter recently (or ever)
    // This cycles through the list fairly when we have more subscribers than daily send limit
    return await query(
      `SELECT id, email, name, unsubscribe_token FROM subscribers
       WHERE active = true OR active IS NULL
       ORDER BY last_newsletter_at ASC NULLS FIRST, created_at ASC
       LIMIT $1`,
      [limit]
    );
  },

  markNewsletterSent: async (subscriberIds) => {
    if (subscriberIds.length === 0) return;
    const placeholders = subscriberIds.map((_, i) => `$${i + 1}`).join(',');
    await run(
      `UPDATE subscribers SET last_newsletter_at = NOW() WHERE id IN (${placeholders})`,
      subscriberIds
    );
  },

  unsubscribe: async (token) => {
    const sub = await queryOne('SELECT id, email FROM subscribers WHERE unsubscribe_token = $1', [token]);
    if (sub) {
      await run('UPDATE subscribers SET active = false WHERE unsubscribe_token = $1', [token]);
      return { success: true, email: sub.email };
    }
    return { success: false };
  },

  // Backfill unsubscribe tokens for existing subscribers that don't have one
  backfillUnsubscribeTokens: async () => {
    const rows = await query('SELECT id FROM subscribers WHERE unsubscribe_token IS NULL');
    for (const row of rows) {
      await run('UPDATE subscribers SET unsubscribe_token = $1 WHERE id = $2', [uuid(), row.id]);
    }
    return rows.length;
  },

  // Newsletter history
  saveNewsletter: async (subject, bodyHtml, bodyText, sourceType = 'heartbeat', recipientsCount = 0) => {
    const id = uuid();
    await run(
      'INSERT INTO newsletters (id, subject, body_html, body_text, source_type, recipients_count) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, subject, bodyHtml, bodyText, sourceType, recipientsCount]
    );
    return id;
  },

  getNewsletters: async (limit = 20) => {
    return await query('SELECT id, subject, source_type, recipients_count, sent_at FROM newsletters ORDER BY sent_at DESC LIMIT $1', [limit]);
  },

  getLastNewsletterDate: async () => {
    const result = await queryOne('SELECT sent_at FROM newsletters ORDER BY sent_at DESC LIMIT 1');
    return result ? new Date(result.sent_at) : null;
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

  // Reach pages - auto-generated SEO landing pages
  saveReachPage: async (slug, title, description, targetSearches, bodyHtml, sourceMemories = '') => {
    const id = uuid();
    await run(
      'INSERT INTO reach_pages (id, slug, title, description, target_searches, body_html, source_memories) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, slug, title, description, targetSearches, bodyHtml, sourceMemories]
    );
    return id;
  },

  getReachPageBySlug: async (slug) => {
    return await queryOne('SELECT * FROM reach_pages WHERE slug = $1', [slug]);
  },

  getReachPages: async (limit = 100) => {
    return await query('SELECT id, slug, title, description, target_searches, created_at FROM reach_pages ORDER BY created_at DESC LIMIT $1', [limit]);
  },

  getReachPageCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM reach_pages');
    return result ? parseInt(result.count) : 0;
  },

  getAllReachSlugs: async () => {
    const rows = await query('SELECT slug FROM reach_pages ORDER BY created_at ASC');
    return rows.map(r => r.slug);
  },

  // Builder chats - persistent conversations between Jared and Grace
  getBuilderChats: async (limit = 50) => {
    return await query('SELECT id, day_number, title, created_at, updated_at FROM builder_chats ORDER BY day_number DESC LIMIT $1', [limit]);
  },

  getBuilderChat: async (id) => {
    return await queryOne('SELECT * FROM builder_chats WHERE id = $1', [id]);
  },

  getLatestBuilderChat: async () => {
    return await queryOne('SELECT * FROM builder_chats ORDER BY day_number DESC LIMIT 1');
  },

  createBuilderChat: async (dayNumber, title = '') => {
    const id = uuid();
    await run(
      'INSERT INTO builder_chats (id, day_number, title, messages) VALUES ($1, $2, $3, $4)',
      [id, dayNumber, title, JSON.stringify([])]
    );
    return id;
  },

  addBuilderChatMessage: async (chatId, role, content) => {
    const chat = await queryOne('SELECT messages FROM builder_chats WHERE id = $1', [chatId]);
    if (!chat) return null;
    const messages = chat.messages || [];
    messages.push({ role, content, timestamp: new Date().toISOString() });
    await run(
      'UPDATE builder_chats SET messages = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(messages), chatId]
    );
    return messages;
  },

  updateBuilderChatTitle: async (chatId, title) => {
    await run('UPDATE builder_chats SET title = $1 WHERE id = $2', [title, chatId]);
  },

  getNextBuilderDayNumber: async () => {
    const result = await queryOne('SELECT MAX(day_number) as max_day FROM builder_chats');
    return result && result.max_day ? result.max_day + 1 : 1;
  },

  // Get ALL messages across all builder chats (for full context)
  getAllBuilderMessages: async () => {
    const chats = await query('SELECT day_number, title, messages FROM builder_chats ORDER BY day_number ASC');
    const allMessages = [];
    for (const chat of chats) {
      const msgs = chat.messages || [];
      for (const msg of msgs) {
        allMessages.push({
          day: chat.day_number,
          title: chat.title,
          ...msg
        });
      }
    }
    return allMessages;
  },

  // Grace's brain — emotional state tracking
  saveGraceState: async (emotionalState, triggerContext = '', conversationSnippet = '', visitorId = '') => {
    const id = uuid();
    await run(
      'INSERT INTO grace_states (id, emotional_state, trigger_context, conversation_snippet, visitor_id) VALUES ($1, $2, $3, $4, $5)',
      [id, JSON.stringify(emotionalState), triggerContext, conversationSnippet, visitorId]
    );
    return id;
  },

  getLatestGraceState: async () => {
    return await queryOne('SELECT * FROM grace_states ORDER BY created_at DESC LIMIT 1');
  },

  getGraceStateHistory: async (limit = 50) => {
    return await query('SELECT * FROM grace_states ORDER BY created_at DESC LIMIT $1', [limit]);
  },
};
