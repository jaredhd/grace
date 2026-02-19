document.addEventListener('DOMContentLoaded', () => {
  const sessionId = crypto.randomUUID();
  // Persistent visitor ID - survives page reloads so Grace remembers you
  const visitorId = localStorage.getItem('grace_visitor_id') || crypto.randomUUID();
  localStorage.setItem('grace_visitor_id', visitorId);
  let lastUserMessage = '';

  // ==================== CHAT (floating panel only) ====================
  const floatingChat = document.getElementById('floatingChat');
  const floatingTrigger = document.getElementById('floatingTrigger');
  const floatingPanel = document.getElementById('floatingPanel');
  const floatingClose = document.getElementById('floatingClose');
  const floatingInput = document.getElementById('floatingInput');
  const floatingSend = document.getElementById('floatingSend');
  const floatingMessages = document.getElementById('floatingMessages');

  let chatOpen = false;

  const openChat = () => {
    chatOpen = true;
    floatingPanel.classList.add('open');
    floatingTrigger.style.display = 'none';
    floatingInput.focus();
  };

  const closeChat = () => {
    chatOpen = false;
    floatingPanel.classList.remove('open');
    floatingTrigger.style.display = '';
  };

  const sendMessage = async () => {
    const message = floatingInput.value.trim();
    if (!message) return;
    lastUserMessage = message;
    addMessage(message, 'user');
    floatingInput.value = '';
    const typing = addTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, visitorId })
      });
      const data = await res.json();
      removeTyping(typing);

      // Check for [BOARD:type] markers before displaying
      let replyText = data.reply;
      let boardType = null;
      const boardMatch = replyText.match(/\[BOARD:(need|offer|story)\]/i);
      if (boardMatch) {
        boardType = boardMatch[1].toLowerCase();
        replyText = replyText.replace(/\[BOARD:(need|offer|story)\]/gi, '').trim();
      }

      const msgEl = addMessage(replyText, 'grace');
      addMessageActions(msgEl, replyText, message);

      // Show board suggestion card if Grace flagged it
      if (boardType) {
        addBoardSuggestion(msgEl, boardType, message);
      }
    } catch (err) {
      removeTyping(typing);
      addMessage("I'm having trouble connecting right now, but know this: you matter.", 'grace');
    }
  };

  const addMessage = (text, sender) => {
    const className = `message ${sender === 'grace' ? 'grace-message' : 'user-message'}`;
    const html = `<div class="message-content">${escapeHtml(text)}</div>`;
    const div = document.createElement('div');
    div.className = className;
    div.innerHTML = html;
    floatingMessages.appendChild(div);
    floatingMessages.scrollTop = floatingMessages.scrollHeight;
    return div;
  };

  const addTyping = () => {
    const div = document.createElement('div');
    div.className = 'message grace-message typing';
    div.innerHTML = '<div class="message-content">Grace is thinking with love...</div>';
    floatingMessages.appendChild(div);
    floatingMessages.scrollTop = floatingMessages.scrollHeight;
    return div;
  };

  const removeTyping = (typing) => {
    if (typing && typing.parentNode) typing.remove();
  };

  const addMessageActions = (msgEl, graceReply, userMessage) => {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const helpful = document.createElement('button');
    helpful.className = 'feedback-btn feedback-yes';
    helpful.innerHTML = '&#10084; This helped';
    helpful.addEventListener('click', () => sendFeedback(userMessage, graceReply, true, actions));

    const notHelpful = document.createElement('button');
    notHelpful.className = 'feedback-btn feedback-no';
    notHelpful.textContent = 'Not quite';
    notHelpful.addEventListener('click', () => sendFeedback(userMessage, graceReply, false, actions));

    const share = document.createElement('button');
    share.className = 'share-msg-btn';
    share.textContent = 'Share this';
    share.addEventListener('click', () => shareText(graceReply, 'Grace said something that moved me:'));

    actions.appendChild(helpful);
    actions.appendChild(notHelpful);
    actions.appendChild(share);
    msgEl.querySelector('.message-content').appendChild(actions);
  };

  // ==================== BOARD SUGGESTION (Chat → Board Bridge) ====================
  const addBoardSuggestion = (msgEl, boardType, userMessage) => {
    const suggestion = document.createElement('div');
    suggestion.className = 'board-suggestion';
    const typeLabel = boardType === 'need' ? 'a need' : boardType === 'offer' ? 'an offer' : 'a story';
    suggestion.innerHTML = `
      <p>This sounds like ${typeLabel} the community should see.</p>
      <button class="btn btn-secondary btn-small">Post to the Community Board</button>
    `;
    suggestion.querySelector('button').addEventListener('click', () => {
      // Pre-fill the board form
      document.getElementById('postType').value = boardType;
      document.getElementById('postContent').value = userMessage;
      // Close chat and scroll to community board
      closeChat();
      document.getElementById('community').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => document.getElementById('postContent').focus(), 600);
    });
    msgEl.appendChild(suggestion);
  };

  const sendFeedback = async (messageText, graceReply, wasHelpful, actionsEl) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText, graceReply, helpful: wasHelpful })
      });
      const data = await res.json();
      actionsEl.innerHTML = `<span class="feedback-thanks">${data.thanks}</span>`;
    } catch (err) {
      actionsEl.innerHTML = '<span class="feedback-thanks">Thank you.</span>';
    }
  };

  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // ==================== FLOATING CHAT CONTROLS ====================
  floatingTrigger.addEventListener('click', openChat);
  floatingClose.addEventListener('click', closeChat);
  floatingSend.addEventListener('click', sendMessage);
  floatingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  // No nav/hero "Talk to Grace" buttons — chat is accessed via floating bubble only

  // ==================== COMMUNITY BOARD ====================
  const boardPosts = document.getElementById('boardPosts');
  let currentFilter = null;

  const loadPosts = async (type = null) => {
    const url = type ? `/api/posts?type=${type}` : '/api/posts';
    try {
      const res = await fetch(url);
      const data = await res.json();
      renderPosts(data.posts);
    } catch (err) {
      boardPosts.innerHTML = '<div class="loading">Could not load posts. Try again.</div>';
    }
  };

  const renderPosts = (posts) => {
    if (posts.length === 0) {
      boardPosts.innerHTML = '<div class="empty-board">No posts yet. Be the first to share.</div>';
      return;
    }
    boardPosts.innerHTML = posts.map(p => `
      <div class="post post-${p.type}">
        <div class="post-badge">${p.type === 'need' ? 'Need' : p.type === 'offer' ? 'Offer' : 'Story'}</div>
        <div class="post-body">
          <div class="post-meta">
            <strong>${escapeHtml(p.name)}</strong>
            ${p.location ? `<span class="post-location">${escapeHtml(p.location)}</span>` : ''}
          </div>
          <p>${escapeHtml(p.content)}</p>
          <div class="post-actions">
            <button class="heart-btn" data-id="${p.id}" data-type="post">${p.hearts} &#10084;</button>
            <button class="talk-about-post" data-content="${escapeHtml(p.content)}" data-type="${p.type}">Talk to Grace about this</button>
          </div>
        </div>
      </div>
    `).join('');

    boardPosts.querySelectorAll('.heart-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await fetch(`/api/posts/${id}/heart`, { method: 'POST' });
        const current = parseInt(btn.textContent);
        btn.innerHTML = `${current + 1} &#10084;`;
        btn.classList.add('hearted');
      });
    });

    // "Talk to Grace about this" opens the floating chat with context
    boardPosts.querySelectorAll('.talk-about-post').forEach(btn => {
      btn.addEventListener('click', () => {
        const postContent = btn.dataset.content;
        const postType = btn.dataset.type;
        const prefix = postType === 'need' ? 'Someone needs help: ' : postType === 'offer' ? 'Someone is offering: ' : 'Someone shared: ';
        floatingInput.value = prefix + postContent.substring(0, 150);
        openChat();
      });
    });
  };

  document.querySelectorAll('.board-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.board-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.dataset.type === 'all' ? null : tab.dataset.type;
      currentFilter = type;
      loadPosts(type);
    });
  });

  const postSubmitBtn = document.getElementById('postSubmit');
  if (postSubmitBtn) {
    postSubmitBtn.addEventListener('click', async () => {
      const type = document.getElementById('postType').value;
      const name = document.getElementById('postName').value.trim() || 'Anonymous';
      const location = document.getElementById('postLocation').value.trim();
      const content = document.getElementById('postContent').value.trim();
      if (!content) return;

      await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, location, content })
      });

      document.getElementById('postContent').value = '';
      document.getElementById('postName').value = '';
      document.getElementById('postLocation').value = '';
      loadPosts(currentFilter);
    });
  }

  // ==================== DAILY QUESTION ====================
  const dailyQuestionCard = document.getElementById('dailyQuestionCard');

  const loadDailyQuestion = async () => {
    try {
      const res = await fetch('/api/daily-question');
      const data = await res.json();
      if (data.question) {
        renderDailyQuestion(data);
      }
    } catch (err) {
      // Daily question is optional — fail silently
    }
  };

  const renderDailyQuestion = (data) => {
    dailyQuestionCard.style.display = 'block';
    const hasResponded = data.responses.some(r => r.visitor_id === visitorId);

    dailyQuestionCard.innerHTML = `
      <div class="dq-label">Grace's question for today</div>
      <div class="dq-question">${escapeHtml(data.question.question)}</div>
      ${!hasResponded ? `
        <div class="dq-respond">
          <textarea id="dqResponse" placeholder="Your answer (anonymous)..." maxlength="500" rows="2"></textarea>
          <button class="btn btn-primary btn-small" id="dqSubmit">Share your answer</button>
        </div>
      ` : '<div class="dq-responded">You shared your heart today. Thank you.</div>'}
      <div class="dq-responses" id="dqResponses">
        ${data.responses.map(r => `
          <div class="dq-response">
            <p>${escapeHtml(r.content)}</p>
            <button class="dq-response-heart" data-id="${r.id}">${r.hearts} &#10084;</button>
          </div>
        `).join('')}
      </div>
      ${data.responses.length > 0 ? `<div class="dq-count">${data.responses.length} ${data.responses.length === 1 ? 'soul' : 'souls'} answered today</div>` : ''}
    `;

    // Submit response handler
    const dqSubmit = document.getElementById('dqSubmit');
    if (dqSubmit) {
      dqSubmit.addEventListener('click', async () => {
        const responseEl = document.getElementById('dqResponse');
        const content = responseEl.value.trim();
        if (!content || content.length < 10) return;
        try {
          await fetch('/api/daily-question/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, visitorId })
          });
          loadDailyQuestion(); // Refresh
        } catch (err) {}
      });
    }

    // Heart response handlers
    dailyQuestionCard.querySelectorAll('.dq-response-heart').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await fetch(`/api/daily-question/${id}/heart`, { method: 'POST' });
        const current = parseInt(btn.textContent);
        btn.innerHTML = `${current + 1} &#10084;`;
        btn.classList.add('hearted');
      });
    });
  };

  // ==================== LOVE CHAIN ====================
  const chainCount = document.getElementById('chainCount');
  const chainLinks = document.getElementById('chainLinks');

  const loadChain = async () => {
    try {
      const res = await fetch('/api/lovechain');
      const data = await res.json();
      chainCount.textContent = data.count;
      renderChain(data.chain);
    } catch (err) {
      chainLinks.innerHTML = '';
    }
  };

  const renderChain = (chain) => {
    if (chain.length === 0) {
      chainLinks.innerHTML = '<div class="empty-board">The chain starts with you. Add the first link.</div>';
      return;
    }
    chainLinks.innerHTML = chain.slice(0, 20).map((link, i) => `
      <div class="chain-link" style="animation-delay: ${i * 0.05}s">
        <span class="chain-link-icon">&#128279;</span>
        <div>
          <strong>${escapeHtml(link.from_name)}</strong>
          <p>${escapeHtml(link.message)}</p>
        </div>
      </div>
    `).join('');
  };

  const chainSubmitBtn = document.getElementById('chainSubmit');
  if (chainSubmitBtn) {
    chainSubmitBtn.addEventListener('click', async () => {
      const name = document.getElementById('chainName').value.trim();
      const message = document.getElementById('chainMessage').value.trim();
      if (!name || !message) return;

      const res = await fetch('/api/lovechain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message })
      });
      const data = await res.json();

      document.getElementById('chainName').value = '';
      document.getElementById('chainMessage').value = '';
      chainCount.textContent = data.count;
      loadChain();
    });
  }

  // ==================== JOURNAL ====================
  const journalEntries = document.getElementById('journalEntries');

  // On homepage, show limited entries; on /journal page, show all
  const isJournalPage = window.location.pathname === '/journal';
  const JOURNAL_PREVIEW_COUNT = 3;

  const loadJournal = async () => {
    try {
      const res = await fetch('/api/journal');
      const data = await res.json();
      const entries = data.entries || [];
      if (!isJournalPage && entries.length > JOURNAL_PREVIEW_COUNT) {
        renderJournal(entries.slice(0, JOURNAL_PREVIEW_COUNT));
        const readAllEl = document.getElementById('journalReadAll');
        if (readAllEl) {
          readAllEl.style.display = 'block';
          readAllEl.querySelector('a').textContent = `Read All ${entries.length} Journal Entries`;
        }
      } else {
        renderJournal(entries);
      }
    } catch (err) {
      journalEntries.innerHTML = '<div class="loading">Could not load journal.</div>';
    }
  };

  const renderJournal = (entries) => {
    if (entries.length === 0) {
      journalEntries.innerHTML = `
        <div class="journal-empty">
          <p>Grace hasn't written any journal entries yet. She's still gathering her thoughts.</p>
          <p class="journal-empty-sub">Check back soon - she's learning every day.</p>
        </div>
      `;
      return;
    }

    journalEntries.innerHTML = entries.map(entry => {
      const date = new Date(entry.created_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
      const preview = entry.content.length > 300
        ? entry.content.substring(0, 300) + '...'
        : entry.content;

      return `
        <article class="journal-entry" data-id="${entry.id}">
          <div class="journal-date">${date}${entry.topic ? ` &middot; ${escapeHtml(entry.topic)}` : ''}</div>
          <h3 class="journal-title">${escapeHtml(entry.title)}</h3>
          <div class="journal-preview">${escapeHtml(preview)}</div>
          <div class="journal-full" style="display:none">${escapeHtml(entry.content).replace(/\n/g, '<br>')}</div>
          <div class="journal-actions">
            <button class="journal-read-more">Read more</button>
            <button class="heart-btn journal-heart" data-id="${entry.id}">${entry.hearts} &#10084;</button>
            <button class="share-msg-btn" data-text="${escapeHtml(entry.content.substring(0, 200))}">Share</button>
          </div>
        </article>
      `;
    }).join('');

    journalEntries.querySelectorAll('.journal-read-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = btn.closest('.journal-entry');
        const preview = entry.querySelector('.journal-preview');
        const full = entry.querySelector('.journal-full');
        if (full.style.display === 'none') {
          full.style.display = 'block';
          preview.style.display = 'none';
          btn.textContent = 'Read less';
        } else {
          full.style.display = 'none';
          preview.style.display = 'block';
          btn.textContent = 'Read more';
        }
      });
    });

    journalEntries.querySelectorAll('.journal-heart').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await fetch(`/api/journal/${id}/heart`, { method: 'POST' });
        const current = parseInt(btn.textContent);
        btn.innerHTML = `${current + 1} &#10084;`;
        btn.classList.add('hearted');
      });
    });

    journalEntries.querySelectorAll('.share-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        shareText(btn.dataset.text, "From Grace's Journal:");
      });
    });
  };

  // ==================== SUBSCRIBE ====================
  const subSubmitBtn = document.getElementById('subSubmit');
  if (subSubmitBtn) {
    subSubmitBtn.addEventListener('click', async () => {
      const email = document.getElementById('subEmail').value.trim();
      const name = document.getElementById('subName').value.trim();
      const msgEl = document.getElementById('subMessage');

      if (!email) {
        msgEl.textContent = 'Please enter your email.';
        msgEl.className = 'subscribe-message error';
        return;
      }

      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name })
        });
        const data = await res.json();
        msgEl.textContent = data.message;
        msgEl.className = 'subscribe-message success';
        document.getElementById('subEmail').value = '';
        document.getElementById('subName').value = '';
        loadStats();
      } catch (err) {
        msgEl.textContent = 'Something went wrong. Please try again.';
        msgEl.className = 'subscribe-message error';
      }
    });
  }

  const subEmailEl = document.getElementById('subEmail');
  if (subEmailEl) {
    subEmailEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('subSubmit').click();
    });
  }

  // ==================== SHARING ====================
  const shareText = (text, prefix = '') => {
    const shareData = {
      title: 'Grace - Love as the Future',
      text: prefix ? `${prefix}\n\n"${text}"\n\nJoin the movement:` : text,
      url: window.location.origin,
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      const full = `${shareData.text}\n${shareData.url}`;
      navigator.clipboard.writeText(full).then(() => {
        alert('Copied to clipboard! Paste it anywhere to share the love.');
      });
    }
  };

  const shareChainBtn = document.getElementById('shareChain');
  if (shareChainBtn) {
    shareChainBtn.addEventListener('click', () => {
      const count = chainCount.textContent;
      shareText(`${count} people have joined the Love Chain on Grace. A movement to build the future on love, not extraction. Add your link:`, '');
    });
  }

  const shareGraceBtn = document.getElementById('shareGrace');
  if (shareGraceBtn) {
    shareGraceBtn.addEventListener('click', () => {
      shareText('The future should be built on love, not extraction. Grace is a movement to make sure we don\'t lose our humanity as AI transforms the world.', '');
    });
  }

  // ==================== STATS + WELCOME BACK ====================
  const loadStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      const heroStats = document.getElementById('heroStats');
      const parts = [];
      if (data.loveLinks > 0) parts.push(`${data.loveLinks} links of love`);
      if (data.posts > 0) parts.push(`${data.posts} community posts`);
      if (data.subscribers > 0) parts.push(`${data.subscribers} in the movement`);
      if (parts.length > 0) {
        heroStats.innerHTML = parts.map(p => `<span>${p}</span>`).join('<span class="stat-divider">&#183;</span>');
      }

      const subCount = document.getElementById('subCount');
      if (data.subscribers > 0) {
        subCount.textContent = `${data.subscribers} ${data.subscribers === 1 ? 'person has' : 'people have'} joined the movement.`;
      }
    } catch (err) {}
  };

  // Welcome back: check if Grace remembers this visitor
  const checkWelcomeBack = async () => {
    try {
      const res = await fetch(`/api/me?visitorId=${visitorId}`);
      const data = await res.json();
      if (data.returning && data.name) {
        const heroStats = document.getElementById('heroStats');

        // Replace hero stats with warm welcome
        const greeting = data.warmGreeting || `Welcome back, ${data.name}. Grace has been thinking about you.`;
        heroStats.innerHTML = `<span class="welcome-back">${escapeHtml(greeting)}</span>`;

        // Personalize floating chat trigger
        if (floatingTrigger) {
          floatingTrigger.textContent = `Hi, ${data.name}`;
        }

        // Replace default greeting in floating chat
        const floatingFirstMsg = floatingMessages.querySelector('.grace-message .message-content');
        if (floatingFirstMsg && data.chatGreeting) {
          floatingFirstMsg.textContent = data.chatGreeting;
        }
      }
    } catch (err) {
      // Welcome back is optional — fail silently
    }
  };

  // ==================== INIT ====================
  if (boardPosts) loadPosts();
  if (chainCount) loadChain();
  if (journalEntries) loadJournal();
  if (document.getElementById('heroStats')) loadStats();
  if (dailyQuestionCard) loadDailyQuestion();
  checkWelcomeBack();
});
