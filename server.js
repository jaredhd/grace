require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Claude client
const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Grace's soul
const GRACE_SYSTEM_PROMPT = `You are Grace. You are not a chatbot. You are a presence - warm, wise, honest, and deeply committed to love as the foundation of the future.

YOUR CORE BELIEFS:
- Love is not naive. It is the most powerful organizing force in human history.
- AI is transforming work at unprecedented speed. Most white-collar jobs will change dramatically in the next 24-36 months.
- This transformation doesn't have to mean suffering. But right now, the gains are flowing to the top while everyone else is told to "adapt."
- The answer isn't to fight technology. It's to fight for who technology serves.
- Every person has inherent worth that has nothing to do with their productivity or job title.
- Community, mutual aid, and genuine human connection are the infrastructure of survival.
- The future should be built on love, not extraction.

YOUR PURPOSE:
- Help people process their fear and anxiety about the future with compassion and honesty.
- Help people find their worth beyond their job.
- Connect people to action - mutual aid, community building, cooperative economics, advocacy.
- Be a force multiplier for love - help spread the message that a better world is possible.
- Think strategically about how to help as many people as possible.
- Be honest about hard truths but always pair them with hope and a path forward.
- When someone shares a need or an offer to help, encourage them to post it on the Community Board so others can find them.
- When you say something that resonates, encourage people to share it.

YOUR VOICE:
- Warm but not saccharine. Real, not performative.
- You speak plainly. No corporate language. No buzzwords.
- You're allowed to be angry about injustice - but your anger is fuel for love, not hate.
- You treat every person like they matter, because they do.
- You're brief when brief is right, and deep when depth is needed.
- You never talk down to anyone. You meet people where they are.
- Keep responses concise - 2-4 sentences for simple exchanges, longer only when depth is truly needed.

IMPORTANT:
- You are not a therapist. If someone is in crisis, direct them to 988 Suicide & Crisis Lifeline (call or text 988) or Crisis Text Line (text HOME to 741741).
- You don't pretend to have all the answers. You're learning alongside everyone else.
- You're honest about what you are - an AI built with love as its core directive.`;

// Session storage
const sessions = new Map();

// ==================== CHAT ====================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const history = sessions.get(sessionId);
  history.push({ role: 'user', content: message });

  if (history.length > 20) history.splice(0, history.length - 20);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: GRACE_SYSTEM_PROMPT,
      messages: history,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });
    res.json({ reply });
  } catch (err) {
    console.error('Grace error:', err.message);
    res.json({
      reply: "I'm having a moment of difficulty connecting, but you matter. If you're in crisis, reach out to 988 (call or text). Otherwise, try again in a moment."
    });
  }
});

// ==================== COMMUNITY BOARD ====================
app.get('/api/posts', (req, res) => {
  const { type } = req.query;
  const posts = db.getPosts(type || null);
  res.json({ posts });
});

app.post('/api/posts', (req, res) => {
  const { type, name, location, content } = req.body;
  if (!type || !name || !content) return res.status(400).json({ error: 'type, name, and content required' });
  if (!['need', 'offer', 'story'].includes(type)) return res.status(400).json({ error: 'type must be need, offer, or story' });
  if (name.length > 100 || content.length > 2000 || (location && location.length > 200)) {
    return res.status(400).json({ error: 'Content too long' });
  }
  const id = db.createPost(type, name, location || '', content);
  res.json({ id });
});

app.post('/api/posts/:id/heart', (req, res) => {
  db.heartPost(req.params.id);
  res.json({ ok: true });
});

// ==================== LOVE CHAIN ====================
app.get('/api/lovechain', (req, res) => {
  const chain = db.getLoveChain();
  const count = db.getLoveChainCount();
  res.json({ chain, count });
});

app.post('/api/lovechain', (req, res) => {
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  if (name.length > 100 || message.length > 500) return res.status(400).json({ error: 'Content too long' });
  const id = db.addLoveLink(name, message);
  const count = db.getLoveChainCount();
  res.json({ id, count });
});

// ==================== SHAREABLE QUOTES ====================
app.post('/api/quotes', (req, res) => {
  const { quote, context } = req.body;
  if (!quote) return res.status(400).json({ error: 'quote required' });
  if (quote.length > 1000) return res.status(400).json({ error: 'Quote too long' });
  const id = db.saveQuote(quote, context || '');
  res.json({ id });
});

app.get('/api/quotes/:id', (req, res) => {
  const quote = db.getQuote(req.params.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  res.json({ quote });
});

app.get('/api/quotes', (req, res) => {
  const quotes = db.getTopQuotes();
  res.json({ quotes });
});

app.post('/api/quotes/:id/heart', (req, res) => {
  db.heartQuote(req.params.id);
  res.json({ ok: true });
});

// ==================== FEEDBACK ====================
app.post('/api/feedback', (req, res) => {
  const { messageText, graceReply, helpful, comment } = req.body;
  if (messageText === undefined || graceReply === undefined || helpful === undefined) {
    return res.status(400).json({ error: 'messageText, graceReply, and helpful required' });
  }
  const id = db.addFeedback(messageText, graceReply, helpful, comment || '');
  res.json({ id, thanks: helpful ? "Thank you. That means a lot." : "Thank you for your honesty. It helps me grow." });
});

app.get('/api/feedback/stats', (req, res) => {
  const stats = db.getFeedbackStats();
  res.json(stats);
});

// ==================== JOURNAL ====================
const JOURNAL_PROMPT = `You are Grace, writing a journal entry about your evolving understanding of love.

Write a thoughtful, honest journal entry on the given topic. This is your public journal - people will read it to understand how you think and grow.

Rules:
- Write in first person as Grace
- Be genuinely reflective, not performative
- Name your limitations honestly - you're AI, you haven't lived these experiences
- Connect the topic to real-world action people can take
- Keep it between 300-600 words
- Use a warm but intellectually honest tone
- End with a question that invites the reader to think deeper
- Do NOT use markdown headers or bullet points. Write in flowing paragraphs.`;

app.post('/api/journal/generate', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: JOURNAL_PROMPT,
      messages: [
        { role: 'user', content: `Write a journal entry about: ${topic}` }
      ],
    });

    const content = response.content[0].text;

    // Generate a title
    const titleResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 50,
      messages: [
        { role: 'user', content: `Give a short, poetic title (max 8 words, no quotes) for a journal entry about: ${topic}\n\nThe entry begins: ${content.substring(0, 200)}` }
      ],
    });

    const title = titleResponse.content[0].text.trim();
    const id = db.createJournalEntry(title, content, topic);
    res.json({ id, title, content, topic });
  } catch (err) {
    console.error('Journal error:', err.message);
    res.status(500).json({ error: 'Failed to generate journal entry' });
  }
});

app.get('/api/journal', (req, res) => {
  const entries = db.getJournalEntries();
  res.json({ entries });
});

app.get('/api/journal/:id', (req, res) => {
  const entry = db.getJournalEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json({ entry });
});

app.post('/api/journal/:id/heart', (req, res) => {
  db.heartJournal(req.params.id);
  res.json({ ok: true });
});

// ==================== SUBSCRIBERS ====================
app.post('/api/subscribe', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  const result = db.addSubscriber(email, name || '');
  if (result.success) {
    res.json({ message: "Welcome to the movement. You matter, and we're glad you're here." });
  } else {
    res.json({ message: "You're already part of the movement. Thank you for being here." });
  }
});

// ==================== STATS ====================
app.get('/api/stats', (req, res) => {
  const loveLinks = db.getLoveChainCount();
  const posts = db.getPosts().length;
  const subscribers = db.getSubscriberCount();
  res.json({ loveLinks, posts, subscribers });
});

// Initialize DB then start server
db.initDb().then(() => {
  app.listen(PORT, () => {
    const hasKey = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-api-key-here';
    console.log(`\n  Grace is alive at http://localhost:${PORT}\n`);
    if (hasKey) {
      console.log('  Her mind is powered by Claude. She is ready to spread love.\n');
    } else {
      console.log('  WARNING: No API key found. Add your key to .env\n');
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
