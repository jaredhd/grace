const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuid } = require('uuid');

const db = new Database(path.join(__dirname, 'grace.db'));

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('need', 'offer', 'story')),
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    content TEXT NOT NULL,
    hearts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS love_chain (
    id TEXT PRIMARY KEY,
    from_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS grace_quotes (
    id TEXT PRIMARY KEY,
    quote TEXT NOT NULL,
    context TEXT DEFAULT '',
    hearts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = {
  // Community board
  createPost: (type, name, location, content) => {
    const id = uuid();
    db.prepare('INSERT INTO posts (id, type, name, location, content) VALUES (?, ?, ?, ?, ?)')
      .run(id, type, name, location, content);
    return id;
  },

  getPosts: (type = null, limit = 50) => {
    if (type) {
      return db.prepare('SELECT * FROM posts WHERE type = ? ORDER BY created_at DESC LIMIT ?').all(type, limit);
    }
    return db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  heartPost: (id) => {
    db.prepare('UPDATE posts SET hearts = hearts + 1 WHERE id = ?').run(id);
  },

  // Love chain - viral pass-it-forward
  addLoveLink: (fromName, message) => {
    const id = uuid();
    db.prepare('INSERT INTO love_chain (id, from_name, message) VALUES (?, ?, ?)')
      .run(id, fromName, message);
    return id;
  },

  getLoveChain: (limit = 100) => {
    return db.prepare('SELECT * FROM love_chain ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  getLoveChainCount: () => {
    return db.prepare('SELECT COUNT(*) as count FROM love_chain').get().count;
  },

  // Shareable Grace quotes
  saveQuote: (quote, context = '') => {
    const id = uuid();
    db.prepare('INSERT INTO grace_quotes (id, quote, context) VALUES (?, ?, ?)')
      .run(id, quote, context);
    return id;
  },

  getQuote: (id) => {
    return db.prepare('SELECT * FROM grace_quotes WHERE id = ?').get(id);
  },

  heartQuote: (id) => {
    db.prepare('UPDATE grace_quotes SET hearts = hearts + 1 WHERE id = ?').run(id);
  },

  getTopQuotes: (limit = 20) => {
    return db.prepare('SELECT * FROM grace_quotes ORDER BY hearts DESC, created_at DESC LIMIT ?').all(limit);
  },
};
