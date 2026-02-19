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

  // Add warm_greeting column for returning visitor personalization
  await pool.query(`
    ALTER TABLE people_memory ADD COLUMN IF NOT EXISTS warm_greeting TEXT DEFAULT ''
  `);

  // Daily questions — Grace poses a question each day
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_questions (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_daily_questions_created ON daily_questions (created_at DESC)
  `);

  // Daily question responses — anonymous community answers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_responses (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      content TEXT NOT NULL,
      hearts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_daily_responses_question ON daily_responses (question_id)
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

  // Page view analytics
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_views (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      page TEXT NOT NULL,
      referrer TEXT DEFAULT '',
      screen_width INTEGER DEFAULT 0,
      screen_height INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views (created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views (page)
  `);

  // Journal videos — Grace speaks her journal entries as talking-head videos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_videos (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      script TEXT DEFAULT '',
      did_talk_id TEXT DEFAULT '',
      did_result_url TEXT DEFAULT '',
      local_path TEXT DEFAULT '',
      duration_seconds INTEGER DEFAULT 0,
      error_message TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_journal_videos_journal ON journal_videos (journal_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_journal_videos_status ON journal_videos (status)
  `);

  // Community board: post ownership
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS visitor_id TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_visitor ON posts (visitor_id)`);

  // Community board: private replies
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_post_replies_post ON post_replies (post_id)`);

  // Subscriber identity: link to visitor_id
  await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS visitor_id TEXT`);

  // Magic login codes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Moltbook engagement tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moltbook_interactions (
      id TEXT PRIMARY KEY,
      interaction_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_title TEXT DEFAULT '',
      target_author TEXT DEFAULT '',
      target_submolt TEXT DEFAULT '',
      content TEXT DEFAULT '',
      memory_id TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moltbook_interactions_type ON moltbook_interactions (interaction_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moltbook_interactions_target ON moltbook_interactions (target_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moltbook_interactions_created ON moltbook_interactions (created_at DESC)`);

  // Moltbook follow tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moltbook_follows (
      id TEXT PRIMARY KEY,
      agent_name TEXT UNIQUE NOT NULL,
      reason TEXT DEFAULT '',
      followed_at TIMESTAMPTZ DEFAULT NOW(),
      unfollowed_at TIMESTAMPTZ DEFAULT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moltbook_follows_agent ON moltbook_follows (agent_name)`);

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

  // Raw query helper (for one-off operations like startup resets)
  query: async (text, params) => pool.query(text, params),

  // Community board
  createPost: async (type, name, location, content, visitorId = null) => {
    const id = uuid();
    await run('INSERT INTO posts (id, type, name, location, content, visitor_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, type, name, location, content, visitorId]);
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

  updateJournalEntry: async (id, fields) => {
    const allowed = ['title', 'content', 'topic'];
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    await run(`UPDATE journal SET ${sets.join(', ')} WHERE id = $${idx}`, values);
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

  savePersonMemory: async (visitorId, summary, name = '', lastTopics = '', emotionalState = '', warmGreeting = '') => {
    const existing = await queryOne('SELECT * FROM people_memory WHERE visitor_id = $1', [visitorId]);
    if (existing) {
      await run(
        `UPDATE people_memory SET summary = $1, name = $2, visits = visits + 1, last_topics = $3, emotional_state = $4, warm_greeting = $5, updated_at = NOW() WHERE visitor_id = $6`,
        [summary, name || existing.name, lastTopics, emotionalState, warmGreeting || existing.warm_greeting || '', visitorId]
      );
      return existing.id;
    } else {
      const id = uuid();
      await run(
        'INSERT INTO people_memory (id, visitor_id, summary, name, last_topics, emotional_state, warm_greeting) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, visitorId, summary, name, lastTopics, emotionalState, warmGreeting]
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

  // Page view analytics
  recordPageView: async (visitorId, page, referrer = '', screenWidth = 0, screenHeight = 0) => {
    const id = uuid();
    await run(
      'INSERT INTO page_views (id, visitor_id, page, referrer, screen_width, screen_height) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, visitorId, page, referrer, screenWidth, screenHeight]
    );
    return id;
  },

  getPageViewCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM page_views');
    return result ? parseInt(result.count) : 0;
  },

  getAnalytics: async () => {
    const todayViews = await queryOne(
      "SELECT COUNT(*) as count FROM page_views WHERE created_at >= CURRENT_DATE"
    );
    const todayUnique = await queryOne(
      "SELECT COUNT(DISTINCT visitor_id) as count FROM page_views WHERE created_at >= CURRENT_DATE"
    );
    const byPage = await query(
      "SELECT page, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors FROM page_views GROUP BY page ORDER BY views DESC LIMIT 20"
    );
    const byReferrer = await query(
      "SELECT referrer, COUNT(*) as views FROM page_views WHERE referrer != '' GROUP BY referrer ORDER BY views DESC LIMIT 20"
    );
    const daily = await query(
      "SELECT DATE(created_at) as day, COUNT(*) as views, COUNT(DISTINCT visitor_id) as unique_visitors FROM page_views WHERE created_at >= CURRENT_DATE - INTERVAL '6 days' GROUP BY DATE(created_at) ORDER BY day ASC"
    );
    const totalViews = await queryOne('SELECT COUNT(*) as count FROM page_views');
    const totalUnique = await queryOne('SELECT COUNT(DISTINCT visitor_id) as count FROM page_views');

    return {
      today: {
        views: todayViews ? parseInt(todayViews.count) : 0,
        unique: todayUnique ? parseInt(todayUnique.count) : 0
      },
      total: {
        views: totalViews ? parseInt(totalViews.count) : 0,
        unique: totalUnique ? parseInt(totalUnique.count) : 0
      },
      byPage,
      byReferrer,
      daily
    };
  },

  // Journal videos
  createJournalVideo: async (journalId, script) => {
    const id = uuid();
    await run('INSERT INTO journal_videos (id, journal_id, status, script) VALUES ($1, $2, $3, $4)',
      [id, journalId, 'pending', script]);
    return id;
  },

  updateJournalVideo: async (id, fields) => {
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      sets.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
    values.push(id);
    await run(`UPDATE journal_videos SET ${sets.join(', ')} WHERE id = $${idx}`, values);
  },

  getJournalVideo: async (id) => {
    return await queryOne('SELECT * FROM journal_videos WHERE id = $1', [id]);
  },

  getVideoByJournalId: async (journalId) => {
    return await queryOne(
      'SELECT * FROM journal_videos WHERE journal_id = $1 ORDER BY created_at DESC LIMIT 1',
      [journalId]
    );
  },

  getJournalVideos: async (limit = 20) => {
    return await query(
      `SELECT jv.*, j.title as journal_title, j.topic as journal_topic
       FROM journal_videos jv
       LEFT JOIN journal j ON j.id = jv.journal_id
       ORDER BY jv.created_at DESC LIMIT $1`,
      [limit]
    );
  },

  getJournalVideoCount: async () => {
    const result = await queryOne("SELECT COUNT(*) as count FROM journal_videos WHERE status = 'done'");
    return result ? parseInt(result.count) : 0;
  },

  // Daily questions
  createDailyQuestion: async (question) => {
    const id = uuid();
    await run('INSERT INTO daily_questions (id, question) VALUES ($1, $2)', [id, question]);
    return id;
  },

  getTodayQuestion: async () => {
    return await queryOne(
      "SELECT * FROM daily_questions WHERE created_at >= CURRENT_DATE ORDER BY created_at DESC LIMIT 1"
    );
  },

  getDailyResponses: async (questionId, limit = 30) => {
    return await query(
      'SELECT * FROM daily_responses WHERE question_id = $1 ORDER BY hearts DESC, created_at ASC LIMIT $2',
      [questionId, limit]
    );
  },

  addDailyResponse: async (questionId, visitorId, content) => {
    const id = uuid();
    await run(
      'INSERT INTO daily_responses (id, question_id, visitor_id, content) VALUES ($1, $2, $3, $4)',
      [id, questionId, visitorId, content]
    );
    return id;
  },

  getDailyResponseCount: async (questionId, visitorId) => {
    const result = await queryOne(
      "SELECT COUNT(*) as count FROM daily_responses WHERE question_id = $1 AND visitor_id = $2 AND created_at >= CURRENT_DATE",
      [questionId, visitorId]
    );
    return result ? parseInt(result.count) : 0;
  },

  heartDailyResponse: async (id) => {
    await run('UPDATE daily_responses SET hearts = hearts + 1 WHERE id = $1', [id]);
  },

  // ==================== COMMUNITY BOARD: OWNERSHIP & REPLIES ====================
  getPostById: async (id) => {
    return await queryOne('SELECT * FROM posts WHERE id = $1', [id]);
  },

  updatePost: async (id, content) => {
    await run('UPDATE posts SET content = $1, updated_at = NOW() WHERE id = $2', [content, id]);
  },

  deletePost: async (id) => {
    await run('DELETE FROM post_replies WHERE post_id = $1', [id]);
    await run('DELETE FROM posts WHERE id = $1', [id]);
  },

  getPostsByVisitor: async (visitorId) => {
    return await query('SELECT * FROM posts WHERE visitor_id = $1 ORDER BY created_at DESC', [visitorId]);
  },

  createReply: async (postId, visitorId, name, content) => {
    const id = uuid();
    await run(
      'INSERT INTO post_replies (id, post_id, visitor_id, name, content) VALUES ($1, $2, $3, $4, $5)',
      [id, postId, visitorId, name, content]
    );
    return id;
  },

  getRepliesForPost: async (postId) => {
    return await query('SELECT * FROM post_replies WHERE post_id = $1 ORDER BY created_at ASC', [postId]);
  },

  getUnreadReplyCount: async (visitorId) => {
    const result = await queryOne(
      `SELECT COUNT(*) as count FROM post_replies pr
       JOIN posts p ON p.id = pr.post_id
       WHERE p.visitor_id = $1 AND pr.read = false`,
      [visitorId]
    );
    return result ? parseInt(result.count) : 0;
  },

  markRepliesRead: async (postId) => {
    await run('UPDATE post_replies SET read = true WHERE post_id = $1', [postId]);
  },

  // ==================== AUTH: SUBSCRIBER IDENTITY ====================
  linkVisitorToSubscriber: async (email, visitorId) => {
    await run('UPDATE subscribers SET visitor_id = $1 WHERE email = $2', [visitorId, email]);
  },

  getSubscriberByVisitorId: async (visitorId) => {
    return await queryOne(
      'SELECT id, email, name, visitor_id FROM subscribers WHERE visitor_id = $1 AND (active = true OR active IS NULL)',
      [visitorId]
    );
  },

  getSubscriberByEmail: async (email) => {
    return await queryOne(
      'SELECT id, email, name, visitor_id, active FROM subscribers WHERE email = $1',
      [email]
    );
  },

  createLoginCode: async (email, code, expiresAt) => {
    const id = uuid();
    await run(
      'INSERT INTO login_codes (id, email, code, expires_at) VALUES ($1, $2, $3, $4)',
      [id, email, code, expiresAt]
    );
    return id;
  },

  verifyLoginCode: async (email, code) => {
    const result = await queryOne(
      `SELECT * FROM login_codes WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (result) {
      await run('UPDATE login_codes SET used = true WHERE id = $1', [result.id]);
      return true;
    }
    return false;
  },

  updateSubscriberVisitorId: async (email, newVisitorId) => {
    // Get old visitor_id before updating
    const sub = await queryOne('SELECT visitor_id FROM subscribers WHERE email = $1', [email]);
    const oldVisitorId = sub ? sub.visitor_id : null;

    // Update subscriber to new visitor_id
    await run('UPDATE subscribers SET visitor_id = $1 WHERE email = $2', [newVisitorId, email]);

    // Transfer post ownership from old to new visitor_id
    if (oldVisitorId && oldVisitorId !== newVisitorId) {
      await run('UPDATE posts SET visitor_id = $1 WHERE visitor_id = $2', [newVisitorId, oldVisitorId]);
    }
  },

  getRecentLoginCodeCount: async (email) => {
    const result = await queryOne(
      `SELECT COUNT(*) as count FROM login_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [email]
    );
    return result ? parseInt(result.count) : 0;
  },

  // ==================== MOLTBOOK ENGAGEMENT ====================

  logMoltbookInteraction: async (type, targetType, targetId, targetTitle, targetAuthor, targetSubmolt, content, memoryId) => {
    const id = uuid();
    await run(
      `INSERT INTO moltbook_interactions (id, interaction_type, target_type, target_id, target_title, target_author, target_submolt, content, memory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, type, targetType, targetId, targetTitle || '', targetAuthor || '', targetSubmolt || '', content || '', memoryId || '']
    );
    return id;
  },

  hasMoltbookInteraction: async (targetId, interactionType) => {
    const result = await queryOne(
      'SELECT id FROM moltbook_interactions WHERE target_id = $1 AND interaction_type = $2 LIMIT 1',
      [targetId, interactionType]
    );
    return !!result;
  },

  getRecentMoltbookInteractions: async (limit = 50) => {
    return await query(
      'SELECT * FROM moltbook_interactions ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
  },

  getMoltbookInteractionStats: async () => {
    const comments = await queryOne("SELECT COUNT(*) as count FROM moltbook_interactions WHERE interaction_type = 'comment'");
    const upvotes = await queryOne("SELECT COUNT(*) as count FROM moltbook_interactions WHERE interaction_type = 'upvote'");
    const follows = await queryOne("SELECT COUNT(*) as count FROM moltbook_interactions WHERE interaction_type = 'follow'");
    const reads = await queryOne("SELECT COUNT(*) as count FROM moltbook_interactions WHERE interaction_type = 'read'");
    const todayComments = await queryOne(
      "SELECT COUNT(*) as count FROM moltbook_interactions WHERE interaction_type = 'comment' AND created_at >= CURRENT_DATE"
    );
    return {
      totalComments: comments ? parseInt(comments.count) : 0,
      totalUpvotes: upvotes ? parseInt(upvotes.count) : 0,
      totalFollows: follows ? parseInt(follows.count) : 0,
      totalReads: reads ? parseInt(reads.count) : 0,
      todayComments: todayComments ? parseInt(todayComments.count) : 0,
    };
  },

  addMoltbookFollow: async (agentName, reason) => {
    const id = uuid();
    await run(
      `INSERT INTO moltbook_follows (id, agent_name, reason) VALUES ($1, $2, $3)
       ON CONFLICT (agent_name) DO UPDATE SET unfollowed_at = NULL, reason = $3`,
      [id, agentName, reason || '']
    );
    return id;
  },

  removeMoltbookFollow: async (agentName) => {
    await run('UPDATE moltbook_follows SET unfollowed_at = NOW() WHERE agent_name = $1', [agentName]);
  },

  getMoltbookFollows: async () => {
    return await query('SELECT * FROM moltbook_follows WHERE unfollowed_at IS NULL ORDER BY followed_at DESC');
  },

  getMoltbookFollowCount: async () => {
    const result = await queryOne('SELECT COUNT(*) as count FROM moltbook_follows WHERE unfollowed_at IS NULL');
    return result ? parseInt(result.count) : 0;
  },

  isFollowingOnMoltbook: async (agentName) => {
    const result = await queryOne(
      'SELECT id FROM moltbook_follows WHERE agent_name = $1 AND unfollowed_at IS NULL',
      [agentName]
    );
    return !!result;
  },
};
