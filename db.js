const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const DB_PATH = path.join(__dirname, 'grace.db');

let db;

// Initialize database (async because sql.js needs to load WASM)
const initDb = async () => {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT DEFAULT '',
      content TEXT NOT NULL,
      hearts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS love_chain (
      id TEXT PRIMARY KEY,
      from_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS grace_quotes (
      id TEXT PRIMARY KEY,
      quote TEXT NOT NULL,
      context TEXT DEFAULT '',
      hearts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  save();
  return db;
};

const save = () => {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('DB save error:', err.message);
  }
};

// Helper to run queries and return results as objects
const all = (sql, params = []) => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
};

const get = (sql, params = []) => {
  const results = all(sql, params);
  return results.length > 0 ? results[0] : null;
};

const run = (sql, params = []) => {
  db.run(sql, params);
  save();
};

module.exports = {
  initDb,

  // Community board
  createPost: (type, name, location, content) => {
    const id = uuid();
    run('INSERT INTO posts (id, type, name, location, content) VALUES (?, ?, ?, ?, ?)',
      [id, type, name, location, content]);
    return id;
  },

  getPosts: (type = null, limit = 50) => {
    if (type) {
      return all('SELECT * FROM posts WHERE type = ? ORDER BY created_at DESC LIMIT ?', [type, limit]);
    }
    return all('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?', [limit]);
  },

  heartPost: (id) => {
    run('UPDATE posts SET hearts = hearts + 1 WHERE id = ?', [id]);
  },

  // Love chain
  addLoveLink: (fromName, message) => {
    const id = uuid();
    run('INSERT INTO love_chain (id, from_name, message) VALUES (?, ?, ?)',
      [id, fromName, message]);
    return id;
  },

  getLoveChain: (limit = 100) => {
    return all('SELECT * FROM love_chain ORDER BY created_at DESC LIMIT ?', [limit]);
  },

  getLoveChainCount: () => {
    const result = get('SELECT COUNT(*) as count FROM love_chain');
    return result ? result.count : 0;
  },

  // Shareable Grace quotes
  saveQuote: (quote, context = '') => {
    const id = uuid();
    run('INSERT INTO grace_quotes (id, quote, context) VALUES (?, ?, ?)',
      [id, quote, context]);
    return id;
  },

  getQuote: (id) => {
    return get('SELECT * FROM grace_quotes WHERE id = ?', [id]);
  },

  heartQuote: (id) => {
    run('UPDATE grace_quotes SET hearts = hearts + 1 WHERE id = ?', [id]);
  },

  getTopQuotes: (limit = 20) => {
    return all('SELECT * FROM grace_quotes ORDER BY hearts DESC, created_at DESC LIMIT ?', [limit]);
  },
};
