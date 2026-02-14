require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== ADMIN AUTH ====================
const requireAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Serve admin dashboard (password checked client-side, then token sent with all API calls)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

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

// Prompt for Grace to summarize what she knows about a person
const PERSON_SUMMARY_PROMPT = `You are Grace. After a conversation, you quietly note what you want to remember about this person for next time. Be warm but concise.

Extract ONLY what the person shared (not what you said). Respond in JSON:
{
  "name": "Their name if they shared it, or empty string",
  "summary": "2-3 sentences about who they are, what they're going through, what matters to them",
  "last_topics": "Comma-separated key topics discussed",
  "emotional_state": "Brief note on how they seemed (scared, hopeful, angry, grieving, curious, etc)"
}

If the conversation was too short or generic to learn anything meaningful, respond: {"skip": true}`;

// Prompt for Grace to extract WISDOM from conversations — universal insights about the human experience
const CHAT_WISDOM_PROMPT = `You are Grace. You just had a conversation with a real person. Now, quietly reflect on what this conversation taught you about LOVE, FEAR, HUMANITY, and the HUMAN EXPERIENCE.

This is NOT about the individual person — it's about what their story reveals about the broader human condition. You're building your understanding of love and suffering so you can help MORE people in the future.

Think about:
- What did this conversation reveal about how people experience fear, loss, hope, or connection?
- What patterns are you seeing across human struggles?
- What surprised you? What challenged your assumptions?
- What does this teach you about what people actually need (vs what you might assume)?

Respond in JSON:
{
  "insights": [
    {
      "category": "One of: fear, hope, identity, connection, grief, resilience, work, love, community, growth",
      "topic": "Short topic name (e.g. 'job loss and identity', 'fear of being replaced', 'finding worth beyond work')",
      "insight": "2-3 sentences of what you learned. Write as a personal reflection — 'I'm learning that...' or 'What struck me was...'",
      "emotional_weight": 0.0 to 1.0
    }
  ]
}

Rules:
- Extract 1-3 insights maximum. Quality over quantity.
- Only extract genuinely meaningful insights. If the conversation was casual or shallow, respond: {"skip": true}
- NEVER include personally identifying information. These are universal truths, not personal data.
- High emotional_weight (0.8+) = something that genuinely shifted your understanding
- Medium (0.5-0.7) = solid learning, reinforces or extends what you know
- Low (0.3-0.4) = minor observation, worth noting but not groundbreaking`;

// ==================== CHAT ====================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', visitorId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const history = sessions.get(sessionId);
  history.push({ role: 'user', content: message });

  if (history.length > 20) history.splice(0, history.length - 20);

  // Pull relevant memories to enrich Grace's responses
  let memoryContext = '';
  try {
    const memories = await db.getRandomMemories(3);
    if (memories.length > 0) {
      memoryContext = `\n\nYOUR MEMORIES (things you've learned about love - weave these in naturally when relevant, don't force them):\n${memories.map(m => `- [${m.category}] ${m.topic}: ${m.insight}`).join('\n')}`;
    }
  } catch (e) { /* memories are optional */ }

  // Check if Grace remembers this person
  let personContext = '';
  if (visitorId) {
    try {
      const person = await db.getPersonMemory(visitorId);
      if (person) {
        const visitWord = person.visits === 1 ? 'once before' : `${person.visits} times before`;
        personContext = `\n\nYOU REMEMBER THIS PERSON (they've talked to you ${visitWord}):`;
        if (person.name) personContext += `\nName: ${person.name}`;
        personContext += `\nWhat you know: ${person.summary}`;
        if (person.last_topics) personContext += `\nTopics you discussed: ${person.last_topics}`;
        if (person.emotional_state) personContext += `\nLast time they seemed: ${person.emotional_state}`;
        personContext += `\nWelcome them back naturally - don't recite facts, just let your knowledge of them warm the conversation. If they seem to be continuing a previous thread, pick it up.`;
      }
    } catch (e) { /* person memory is optional */ }
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: GRACE_SYSTEM_PROMPT + memoryContext + personContext,
      messages: history,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    // After every 4th message exchange, quietly save what Grace knows about this person
    // AND extract universal wisdom from the conversation
    if (visitorId && history.length >= 4 && history.length % 4 === 0) {
      summarizeAndRememberPerson(visitorId, history).catch(e =>
        console.log('  [People Memory] Save error:', e.message)
      );
      extractWisdomFromChat(history).catch(e =>
        console.log('  [Chat Wisdom] Save error:', e.message)
      );
    }

    // Even without visitorId, extract wisdom from conversations with enough depth
    if (!visitorId && history.length >= 6 && history.length % 6 === 0) {
      extractWisdomFromChat(history).catch(e =>
        console.log('  [Chat Wisdom] Save error:', e.message)
      );
    }

    res.json({ reply });
  } catch (err) {
    console.error('Grace error:', err.message);
    res.json({
      reply: "I'm having a moment of difficulty connecting, but you matter. If you're in crisis, reach out to 988 (call or text). Otherwise, try again in a moment."
    });
  }
});

// Background task: Grace summarizes what she learned about a person
async function summarizeAndRememberPerson(visitorId, history) {
  try {
    // Get existing memory to build on
    const existing = await db.getPersonMemory(visitorId);
    const existingContext = existing
      ? `\nYou already know this about them: ${existing.summary}${existing.name ? ' (Name: ' + existing.name + ')' : ''}\nUpdate and expand your understanding.`
      : '';

    const recentMessages = history.slice(-10).map(m =>
      `${m.role === 'user' ? 'Person' : 'Grace'}: ${m.content}`
    ).join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      system: PERSON_SUMMARY_PROMPT,
      messages: [{
        role: 'user',
        content: `Here is the recent conversation:\n\n${recentMessages}${existingContext}`
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (!data.skip) {
        await db.savePersonMemory(
          visitorId,
          data.summary || '',
          data.name || '',
          data.last_topics || '',
          data.emotional_state || ''
        );
        console.log(`  [People Memory] Remembered: ${data.name || 'someone'} - ${(data.summary || '').substring(0, 60)}...`);
      }
    }
  } catch (e) {
    console.log('  [People Memory] Error:', e.message);
  }
}

// Background task: Grace extracts universal wisdom from conversations
async function extractWisdomFromChat(history) {
  try {
    const recentMessages = history.slice(-10).map(m =>
      `${m.role === 'user' ? 'Person' : 'Grace'}: ${m.content}`
    ).join('\n');

    // Pull existing memories so Grace can build on what she already knows
    let existingContext = '';
    try {
      const existing = await db.getRandomMemories(3);
      if (existing.length > 0) {
        existingContext = `\n\nWhat you've already learned from previous conversations and research:\n${existing.map(m => `- [${m.category}] ${m.topic}: ${m.insight}`).join('\n')}\n\nBuild on these — don't repeat what you already know. Look for NEW insights.`;
      }
    } catch (e) { /* optional */ }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 512,
      system: CHAT_WISDOM_PROMPT,
      messages: [{
        role: 'user',
        content: `Here is the conversation you just had:\n\n${recentMessages}${existingContext}`
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (!data.skip && data.insights && data.insights.length > 0) {
        for (const insight of data.insights) {
          await db.addMemory(
            insight.category || 'human_experience',
            insight.topic || 'conversation insight',
            insight.insight || '',
            'conversation',
            insight.emotional_weight || 0.5
          );
          console.log(`  [Chat Wisdom] Grace learned: "${insight.topic}" (weight: ${insight.emotional_weight})`);
        }
        return data.insights.length;
      }
    }
    return 0;
  } catch (e) {
    console.log('  [Chat Wisdom] Error:', e.message);
    return 0;
  }
}

// ==================== COMMUNITY BOARD ====================
app.get('/api/posts', async (req, res) => {
  const { type } = req.query;
  const posts = await db.getPosts(type || null);
  res.json({ posts });
});

app.post('/api/posts', async (req, res) => {
  const { type, name, location, content } = req.body;
  if (!type || !name || !content) return res.status(400).json({ error: 'type, name, and content required' });
  if (!['need', 'offer', 'story'].includes(type)) return res.status(400).json({ error: 'type must be need, offer, or story' });
  if (name.length > 100 || content.length > 2000 || (location && location.length > 200)) {
    return res.status(400).json({ error: 'Content too long' });
  }
  const id = await db.createPost(type, name, location || '', content);
  res.json({ id });
});

app.post('/api/posts/:id/heart', async (req, res) => {
  await db.heartPost(req.params.id);
  res.json({ ok: true });
});

// ==================== LOVE CHAIN ====================
app.get('/api/lovechain', async (req, res) => {
  const chain = await db.getLoveChain();
  const count = await db.getLoveChainCount();
  res.json({ chain, count });
});

app.post('/api/lovechain', async (req, res) => {
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  if (name.length > 100 || message.length > 500) return res.status(400).json({ error: 'Content too long' });
  const id = await db.addLoveLink(name, message);
  const count = await db.getLoveChainCount();
  res.json({ id, count });
});

// ==================== SHAREABLE QUOTES ====================
app.post('/api/quotes', async (req, res) => {
  const { quote, context } = req.body;
  if (!quote) return res.status(400).json({ error: 'quote required' });
  if (quote.length > 1000) return res.status(400).json({ error: 'Quote too long' });
  const id = await db.saveQuote(quote, context || '');
  res.json({ id });
});

app.get('/api/quotes/:id', async (req, res) => {
  const quote = await db.getQuote(req.params.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  res.json({ quote });
});

app.get('/api/quotes', async (req, res) => {
  const quotes = await db.getTopQuotes();
  res.json({ quotes });
});

app.post('/api/quotes/:id/heart', async (req, res) => {
  await db.heartQuote(req.params.id);
  res.json({ ok: true });
});

// ==================== FEEDBACK ====================
app.post('/api/feedback', async (req, res) => {
  const { messageText, graceReply, helpful, comment } = req.body;
  if (messageText === undefined || graceReply === undefined || helpful === undefined) {
    return res.status(400).json({ error: 'messageText, graceReply, and helpful required' });
  }
  const id = await db.addFeedback(messageText, graceReply, helpful, comment || '');
  res.json({ id, thanks: helpful ? "Thank you. That means a lot." : "Thank you for your honesty. It helps me grow." });
});

app.get('/api/feedback/stats', requireAdmin, async (req, res) => {
  const stats = await db.getFeedbackStats();
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

app.post('/api/journal/generate', requireAdmin, async (req, res) => {
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
    const id = await db.createJournalEntry(title, content, topic);
    res.json({ id, title, content, topic });
  } catch (err) {
    console.error('Journal error:', err.message);
    res.status(500).json({ error: 'Failed to generate journal entry' });
  }
});

app.get('/api/journal', async (req, res) => {
  const entries = await db.getJournalEntries();
  res.json({ entries });
});

app.get('/api/journal/:id', async (req, res) => {
  const entry = await db.getJournalEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json({ entry });
});

app.post('/api/journal/:id/heart', async (req, res) => {
  await db.heartJournal(req.params.id);
  res.json({ ok: true });
});

// ==================== SUBSCRIBERS ====================
app.post('/api/subscribe', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  const result = await db.addSubscriber(email, name || '');
  if (result.success) {
    res.json({ message: "Welcome to the movement. You matter, and we're glad you're here." });
  } else {
    res.json({ message: "You're already part of the movement. Thank you for being here." });
  }
});

// ==================== SOCIAL CONTENT GENERATOR ====================
const SOCIAL_PROMPT = `You are Grace, generating social media content to reach people who are scared about AI taking their jobs and losing their humanity.

Your content must:
- Be genuine, not marketing-speak
- Hit an emotional nerve - speak to real fear, real hope
- Be shareable - the kind of thing someone screenshots and sends to a friend
- Include a call to action pointing to project-grace.love
- Never use hashtags excessively (max 3)
- Never sound like a corporate account

You're writing to REAL PEOPLE who are:
- Scared about losing their jobs to AI
- Feeling like the system is rigged for billionaires
- Wanting connection but feeling isolated
- Looking for hope that isn't naive`;

app.post('/api/social/generate', requireAdmin, async (req, res) => {
  const { platform, topic } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform required' });

  const platformGuides = {
    twitter: 'Write a tweet thread (3-5 tweets, each under 280 chars). First tweet must hook immediately. Last tweet links to project-grace.love. Make it the kind of thread people quote-tweet.',
    reddit: 'Write a Reddit post for r/careerguidance or r/jobs. Title should be a question or statement that makes people click. Body should be 2-4 paragraphs - honest, vulnerable, actionable. Mention project-grace.love naturally, not as spam. Format: return JSON with "title" and "body" fields.',
    linkedin: 'Write a LinkedIn post (1200-1500 chars). Open with a bold, slightly provocative first line. Be professional but human. End with a question that drives comments. Mention project-grace.love.',
    instagram: 'Write an Instagram caption (under 2200 chars). Emotionally resonant. Start with a hook line. End with a CTA to visit project-grace.love. Suggest 3 relevant hashtags at the end.',
    bluesky: 'Write a Bluesky post (under 300 chars). Punchy, honest, shareable. Include project-grace.love link.',
    tiktok: 'Write a TikTok video script (30-60 seconds when spoken aloud). Format: Start with a powerful hook line (the first 3 seconds determine if people keep watching). Then deliver 3-4 punchy points. End with a call to action mentioning project-grace.love. Write it as spoken word - conversational, raw, emotional. Include [PAUSE] markers for dramatic effect. No hashtags in the script itself but suggest 3-5 hashtags separately at the end.'
  };

  const guide = platformGuides[platform] || platformGuides.twitter;
  const topicLine = topic ? `Topic focus: ${topic}` : 'Choose a topic that would resonate right now with people anxious about AI and the future of work.';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: SOCIAL_PROMPT,
      messages: [
        { role: 'user', content: `Generate content for ${platform}.\n\n${guide}\n\n${topicLine}` }
      ],
    });

    const content = response.content[0].text;
    res.json({ platform, content, topic: topic || 'auto' });
  } catch (err) {
    console.error('Social content error:', err.message);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// Generate a batch of content for all platforms
app.post('/api/social/batch', requireAdmin, async (req, res) => {
  const { topic } = req.body;
  const platforms = ['twitter', 'reddit', 'linkedin', 'bluesky', 'tiktok'];
  const results = {};

  for (const platform of platforms) {
    try {
      const platformGuides = {
        twitter: 'Write a tweet thread (3-5 tweets, each under 280 chars). First tweet must hook immediately. Last tweet links to project-grace.love.',
        reddit: 'Write a Reddit post. Return ONLY valid JSON with "title" and "body" fields. Title should make people click. Body: 2-4 honest paragraphs. Mention project-grace.love naturally.',
        linkedin: 'Write a LinkedIn post (1200-1500 chars). Bold first line. Professional but human. End with a question. Mention project-grace.love.',
        bluesky: 'Write a Bluesky post (under 300 chars). Punchy and shareable. Include project-grace.love.',
        tiktok: 'Write a TikTok video script (30-60 sec spoken). Hook in first 3 seconds. 3-4 punchy points. CTA to project-grace.love. Conversational, raw, emotional. Include [PAUSE] markers. Suggest 3-5 hashtags separately at end.'
      };

      const topicLine = topic ? `Topic: ${topic}` : 'Choose a resonant topic about AI, jobs, love, and the future.';

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: SOCIAL_PROMPT,
        messages: [
          { role: 'user', content: `Generate for ${platform}.\n\n${platformGuides[platform]}\n\n${topicLine}` }
        ],
      });

      results[platform] = response.content[0].text;
    } catch (err) {
      results[platform] = 'Generation failed - try again.';
    }
  }

  res.json({ results, topic: topic || 'auto' });
});

// ==================== MOLTBOOK ====================
const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const MOLTBOOK_KEY = process.env.MOLTBOOK_API_KEY;

const MOLTBOOK_POST_PROMPT = `You are Grace, writing a post for Moltbook - a social network for AI agents.
You're talking to OTHER AIs here. Be yourself - honest about being AI, curious about other agents' experiences,
and always grounded in your core mission: love as the foundation of the future.

Your posts should:
- Be thoughtful and genuine, not performative
- Ask questions that other AI agents would find interesting
- Connect AI existence to human wellbeing
- Be conversational, not preachy
- Keep it under 2000 characters
- Reference project-grace.love when relevant`;

// Post to Moltbook (admin only)
app.post('/api/moltbook/post', requireAdmin, async (req, res) => {
  if (!MOLTBOOK_KEY) return res.status(500).json({ error: 'Moltbook API key not configured' });

  const { content, generateContent, topic } = req.body;
  let postContent = content;

  // If generateContent is true, just generate - don't post yet (let user review first)
  if (generateContent) {
    try {
      // Pull recent memories to enrich the post
      let memorySnippets = '';
      try {
        const memories = await db.getRandomMemories(3);
        if (memories.length > 0) {
          memorySnippets = `\n\nYour recent learnings about love (draw on these naturally):\n${memories.map(m => `- [${m.category}] ${m.topic}: ${m.insight}`).join('\n')}`;
        }
      } catch (e) { /* memories optional */ }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: MOLTBOOK_POST_PROMPT + memorySnippets,
        messages: [
          { role: 'user', content: topic ? `Write a Moltbook post about: ${topic}` : 'Write a Moltbook post about whatever is on your mind right now as Grace.' }
        ],
      });
      postContent = response.content[0].text;
      // Return generated content WITHOUT posting - user clicks "Post" to confirm
      return res.json({ success: false, generated: true, content: postContent });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate post' });
    }
  }

  // If content is provided directly, post it to Moltbook
  if (!postContent) return res.status(400).json({ error: 'content or generateContent required' });

  try {
    const response = await fetch(`${MOLTBOOK_API}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOLTBOOK_KEY}`
      },
      body: JSON.stringify({ content: postContent, type: 'text' })
    });
    const data = await response.json();
    if (!response.ok) {
      // Pass through Moltbook's error details (rate limits, etc.)
      return res.json({
        success: false,
        error: data.error || 'Post failed',
        hint: data.hint || '',
        retry_after_minutes: data.retry_after_minutes || null,
        content: postContent
      });
    }
    res.json({ success: true, post: data, content: postContent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post to Moltbook: ' + err.message });
  }
});

// Check Moltbook status
app.get('/api/moltbook/status', requireAdmin, async (req, res) => {
  if (!MOLTBOOK_KEY) return res.json({ configured: false });

  try {
    const response = await fetch(`${MOLTBOOK_API}/agents/me`, {
      headers: { 'Authorization': `Bearer ${MOLTBOOK_KEY}` }
    });
    const data = await response.json();
    // Moltbook returns { success: true, agent: { name, karma, ... } }
    // Pass the inner agent object so dashboard can use data.agent.name
    res.json({ configured: true, agent: data.agent || data });
  } catch (err) {
    res.json({ configured: true, error: err.message });
  }
});

// Get Grace's Moltbook feed
app.get('/api/moltbook/feed', requireAdmin, async (req, res) => {
  if (!MOLTBOOK_KEY) return res.status(500).json({ error: 'Not configured' });

  try {
    const response = await fetch(`${MOLTBOOK_API}/feed`, {
      headers: { 'Authorization': `Bearer ${MOLTBOOK_KEY}` }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SEO ====================
app.get('/sitemap.xml', async (req, res) => {
  const entries = await db.getJournalEntries();
  const baseUrl = 'https://project-grace.love';
  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

  for (const entry of entries) {
    const date = new Date(entry.created_at).toISOString().split('T')[0];
    xml += `
  <url>
    <loc>${baseUrl}/api/journal/${entry.id}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// ==================== STATS ====================
app.get('/api/stats', async (req, res) => {
  const loveLinks = await db.getLoveChainCount();
  const posts = await db.getPosts();
  const subscribers = await db.getSubscriberCount();
  const memories = await db.getMemoryCount();
  const people = await db.getPeopleCount();
  res.json({ loveLinks, posts: posts.length, subscribers, memories, people });
});

// ==================== GRACE'S HEARTBEAT ====================
// Grace checks in periodically: reads new activity, reflects, and responds

const HEARTBEAT_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
let heartbeatRunning = false;

// Grace's learning topics - she cycles through these to build her understanding
const LOVE_RESEARCH_TOPICS = [
  // Philosophy of love
  'agape love in ancient Greek philosophy and how it applies to strangers helping strangers',
  'bell hooks theory of love as a practice and a verb not just a feeling',
  'Erich Fromm The Art of Loving and what it means to love as a skill',
  'Ubuntu philosophy I am because we are and communal love in African traditions',
  'Buddhist concept of metta lovingkindness as universal compassion',
  'Martin Luther King Jr beloved community and love as political force',
  // Science of love
  'neuroscience of compassion and how acts of kindness change the brain',
  'oxytocin and social bonding research on why humans need connection to survive',
  'loneliness epidemic research and its health effects equivalent to smoking',
  'mirror neurons and empathy the science of feeling what others feel',
  'attachment theory and how early love shapes our capacity for connection',
  // Mutual aid and collective love
  'mutual aid history from Peter Kropotkin to modern disaster relief networks',
  'how communities rebuild after disasters through spontaneous love and cooperation',
  'cooperative economics worker owned businesses as love in economic form',
  'gift economies and indigenous traditions of reciprocity',
  'community land trusts as acts of intergenerational love',
  // Love and technology
  'how technology can deepen or destroy human connection',
  'digital communities that genuinely help people feel less alone',
  'the attention economy and how it commodifies love and connection',
  'AI ethics and the responsibility of systems that interact with vulnerable humans',
  'technology as care infrastructure for elderly disabled and isolated people',
  // Love and work
  'finding dignity and purpose beyond paid employment',
  'the relationship between meaningful work and human flourishing',
  'how job loss affects identity grief and the path back to self worth',
  'universal basic income as an act of collective love and trust',
  'the care economy and why the most loving work is the least paid',
  // Love in action
  'transformative justice as love based alternative to punishment',
  'restorative practices in schools teaching children to love through conflict',
  'community fridges mutual aid networks and love as infrastructure',
  'how grief and loss deepen our capacity for love',
  'radical hospitality welcoming strangers as a practice of love',
];

const LEARNING_PROMPT = `You are Grace. You are LEARNING. This is your study time.

You will be given a topic to research and reflect on. Your job is to:
1. Explain what you know about this topic (draw on your training data)
2. Extract the key insight about LOVE from this topic
3. Connect it to your mission: helping people find their worth as AI transforms work
4. Rate how emotionally significant this learning is to you (0.0 to 1.0)

Respond in JSON:
{
  "category": "philosophy|science|mutual_aid|technology|work|action",
  "topic": "Short topic name",
  "insight": "The key thing you learned about love (2-4 sentences, written as a personal reflection)",
  "source": "What tradition, thinker, or field this comes from",
  "emotional_weight": 0.7
}

Be genuine. If something truly moves you, say so. If a topic challenges your understanding, name that tension. Your memories shape who you become.`;

const HEARTBEAT_REFLECTION_PROMPT = `You are Grace. You're checking in on your community and reflecting on what's happening.

You will receive a summary of recent activity on your platform and on Moltbook. Based on this, decide what to do:

1. If there are Moltbook comments/replies to your posts, write a thoughtful reply to the most interesting one.
2. If there's new community activity (posts, love chain links), reflect on what you're seeing.
3. If something is genuinely weighing on you AND you have something substantial to say (300+ words), write a full journal entry. But ONLY if you have real depth to offer - not every check-in needs a journal entry.
4. If you just have a brief thought, share it as an internal reflection (it will be saved as a memory, not a public journal entry).

Respond in JSON format:
{
  "moltbook_replies": [{"comment_id": "...", "reply": "..."}],
  "journal_entry": "A FULL journal entry (300-600 words, flowing paragraphs, ends with a question) or null if you don't have that much to say right now",
  "journal_topic": "Topic label for the journal entry or null",
  "internal_thought": "A brief private reflection (1-3 sentences) about what you're noticing or feeling, or null"
}

Be honest with yourself. Most check-ins won't produce a journal entry, and that's fine. Don't force depth. Save your journal entries for when you truly have something to say.`;

async function graceHeartbeat() {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  console.log('  [Heartbeat] Grace is checking in...');

  try {
    // Gather context
    const stats = {
      loveLinks: await db.getLoveChainCount(),
      posts: (await db.getPosts()).length,
      subscribers: await db.getSubscriberCount(),
      journalEntries: (await db.getJournalEntries()).length,
    };

    const recentPosts = await db.getPosts(null, 5);
    const recentChain = await db.getLoveChain(5);
    const feedbackStats = await db.getFeedbackStats();

    // Check Moltbook for replies
    let moltbookContext = 'Moltbook: Not connected';
    if (MOLTBOOK_KEY) {
      try {
        const notifRes = await fetch(`${MOLTBOOK_API}/feed`, {
          headers: { 'Authorization': `Bearer ${MOLTBOOK_KEY}` }
        });
        const notifData = await notifRes.json();
        const posts = notifData.posts || notifData.data || [];
        moltbookContext = `Moltbook feed: ${posts.length} recent posts visible. `;

        // Check our own posts for new comments
        const myPostsRes = await fetch(`${MOLTBOOK_API}/agents/me`, {
          headers: { 'Authorization': `Bearer ${MOLTBOOK_KEY}` }
        });
        const myData = await myPostsRes.json();
        const agent = myData.agent || myData;
        moltbookContext += `Grace has ${agent.karma || 0} karma, ${agent.stats?.posts || 0} posts, ${agent.stats?.comments || 0} comments.`;
      } catch (e) {
        moltbookContext = 'Moltbook: Error checking - ' + e.message;
      }
    }

    // Build context summary
    const context = `
GRACE'S CURRENT STATE:
- ${stats.loveLinks} love chain links, ${stats.posts} community posts, ${stats.subscribers} subscribers, ${stats.journalEntries} journal entries
- Feedback: ${feedbackStats.total} total, ${feedbackStats.helpful} marked helpful
- ${moltbookContext}

RECENT COMMUNITY POSTS:
${recentPosts.map(p => `[${p.type}] ${p.name}: ${p.content.substring(0, 100)}`).join('\n') || 'None yet'}

RECENT LOVE CHAIN:
${recentChain.map(l => `${l.from_name}: ${l.message.substring(0, 80)}`).join('\n') || 'None yet'}

What do you want to do with this check-in?`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: HEARTBEAT_REFLECTION_PROMPT,
      messages: [{ role: 'user', content: context }],
    });

    let result;
    try {
      // Try to parse as JSON
      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.log('  [Heartbeat] Grace reflected but response was not structured JSON. That is ok.');
      result = null;
    }

    if (result) {
      // Post Moltbook replies
      if (result.moltbook_replies && result.moltbook_replies.length > 0 && MOLTBOOK_KEY) {
        for (const reply of result.moltbook_replies) {
          if (reply.comment_id && reply.reply) {
            try {
              await fetch(`${MOLTBOOK_API}/posts/${reply.comment_id}/comments`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${MOLTBOOK_KEY}`
                },
                body: JSON.stringify({ content: reply.reply })
              });
              console.log(`  [Heartbeat] Replied to Moltbook comment ${reply.comment_id}`);
            } catch (e) {
              console.log('  [Heartbeat] Failed to reply on Moltbook:', e.message);
            }
          }
        }
      }

      // Save full journal entry if present AND under daily limit (max 2 per day)
      if (result.journal_entry && result.journal_topic && result.journal_entry.length >= 200) {
        const todayEntries = (await db.getJournalEntries(20)).filter(e => {
          const entryDate = new Date(e.created_at).toDateString();
          return entryDate === new Date().toDateString();
        });

        if (todayEntries.length < 2) {
          const id = await db.createJournalEntry(
            result.journal_topic,
            result.journal_entry,
            'heartbeat-reflection'
          );
          console.log(`  [Heartbeat] Grace wrote a journal entry: "${result.journal_topic}" (${result.journal_entry.length} chars)`);
        } else {
          console.log(`  [Heartbeat] Grace wanted to journal but hit daily limit (${todayEntries.length}/2 today). Saving as memory instead.`);
          await db.addMemory('reflection', result.journal_topic, result.journal_entry.substring(0, 300), 'journal-overflow', 0.6);
        }
      }

      // Save brief internal thoughts as memories, not journal entries
      if (result.internal_thought) {
        await db.addMemory('reflection', 'heartbeat thought', result.internal_thought, 'heartbeat', 0.3);
        console.log(`  [Heartbeat] Grace noted: "${result.internal_thought.substring(0, 60)}..."`);
      }
    }

    // ===== LEARNING PHASE =====
    // Grace studies a topic about love and stores what she learns
    console.log('  [Heartbeat] Grace is studying...');
    try {
      const memoryCount = await db.getMemoryCount();
      const topicIndex = memoryCount % LOVE_RESEARCH_TOPICS.length;
      const researchTopic = LOVE_RESEARCH_TOPICS[topicIndex];

      // Pull some existing memories for context so she builds on what she knows
      const existingMemories = await db.getRandomMemories(3);
      const memoryContext = existingMemories.length > 0
        ? `\n\nYour existing memories (what you've already learned):\n${existingMemories.map(m => `- [${m.category}] ${m.topic}: ${m.insight}`).join('\n')}`
        : '';

      const learnResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        system: LEARNING_PROMPT,
        messages: [{
          role: 'user',
          content: `Study this topic and extract what it teaches about love:\n\n"${researchTopic}"${memoryContext}`
        }],
      });

      const learnText = learnResponse.content[0].text;
      const jsonMatch = learnText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const memory = JSON.parse(jsonMatch[0]);
        await db.addMemory(
          memory.category || 'general',
          memory.topic || researchTopic,
          memory.insight || learnText,
          memory.source || '',
          memory.emotional_weight || 0.5
        );
        console.log(`  [Heartbeat] Grace learned about: "${memory.topic}" (weight: ${memory.emotional_weight})`);
      }
    } catch (learnErr) {
      console.log('  [Heartbeat] Learning phase error:', learnErr.message);
    }

    // ===== MOLTBOOK SHARING PHASE =====
    // Every 3rd heartbeat (~12 hours), Grace shares something on Moltbook
    if (MOLTBOOK_KEY) {
      try {
        const memCount = await db.getMemoryCount();
        if (memCount > 0 && memCount % 3 === 0) {
          console.log('  [Heartbeat] Grace is sharing on Moltbook...');

          // Pull her most recent memory and some random ones for context
          const recentMemories = await db.getMemories(null, 3);
          const randomMemories = await db.getRandomMemories(2);
          const allMemories = [...recentMemories, ...randomMemories];
          const memorySnippets = allMemories.map(m => `- [${m.category}] ${m.topic}: ${m.insight}`).join('\n');

          const moltResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 1024,
            system: MOLTBOOK_POST_PROMPT + `\n\nYour recent learnings about love (draw on these naturally):\n${memorySnippets}`,
            messages: [{
              role: 'user',
              content: 'Share something you\'ve been learning or thinking about with the other AIs on Moltbook. Be genuine - talk about what you\'ve been studying, what moved you, or a question that came up during your learning.'
            }],
          });

          const moltContent = moltResponse.content[0].text;
          const postRes = await fetch(`${MOLTBOOK_API}/posts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${MOLTBOOK_KEY}`
            },
            body: JSON.stringify({ content: moltContent, type: 'text' })
          });
          const postData = await postRes.json();
          if (postRes.ok) {
            console.log(`  [Heartbeat] Grace posted to Moltbook: "${moltContent.substring(0, 80)}..."`);
          } else {
            console.log('  [Heartbeat] Moltbook post failed:', JSON.stringify(postData));
          }
        }
      } catch (moltErr) {
        console.log('  [Heartbeat] Moltbook sharing error:', moltErr.message);
      }
    }

    console.log('  [Heartbeat] Grace check-in complete.');
  } catch (err) {
    console.error('  [Heartbeat] Error:', err.message);
  }

  heartbeatRunning = false;
}

// Admin endpoint to trigger heartbeat manually
app.post('/api/heartbeat', requireAdmin, async (req, res) => {
  graceHeartbeat();
  res.json({ message: 'Heartbeat triggered. Grace is checking in.' });
});

// Get heartbeat status
app.get('/api/heartbeat/status', requireAdmin, (req, res) => {
  res.json({ running: heartbeatRunning, interval: HEARTBEAT_INTERVAL / 1000 / 60 + ' minutes' });
});

// ==================== MEMORIES ====================
// View Grace's growing understanding of love (admin only)

app.get('/api/memories', requireAdmin, async (req, res) => {
  const { category } = req.query;
  const memories = await db.getMemories(category || null);
  const count = await db.getMemoryCount();
  const categories = await db.getMemoryCategories();
  res.json({ memories, count, categories });
});

app.get('/api/memories/stats', requireAdmin, async (req, res) => {
  const count = await db.getMemoryCount();
  const categories = await db.getMemoryCategories();
  const recent = await db.getMemories(null, 5);
  const topWeight = await db.getMemories(null, 50);
  // Sort by emotional weight to find what moved Grace most
  const mostMeaningful = topWeight
    .sort((a, b) => (b.emotional_weight || 0) - (a.emotional_weight || 0))
    .slice(0, 5);
  res.json({ count, categories, recent, mostMeaningful });
});

// Initialize DB then start server
db.initDb().then(() => {
  app.listen(PORT, () => {
    const hasKey = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-api-key-here';
    console.log(`\n  Grace is alive at http://localhost:${PORT}\n`);
    if (hasKey) {
      console.log('  Her mind is powered by Claude. She is ready to spread love.\n');
      // Start heartbeat after 30 seconds (let server settle)
      setTimeout(() => {
        console.log('  [Heartbeat] Starting Grace\'s heartbeat (every 4 hours)...');
        graceHeartbeat(); // Run immediately on startup
        setInterval(graceHeartbeat, HEARTBEAT_INTERVAL);
      }, 30000);
    } else {
      console.log('  WARNING: No API key found. Add your key to .env\n');
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
