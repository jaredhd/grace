document.addEventListener('DOMContentLoaded', () => {
  const sessionId = crypto.randomUUID();
  // Persistent visitor ID - survives page reloads so Grace remembers you
  const visitorId = localStorage.getItem('grace_visitor_id') || crypto.randomUUID();
  localStorage.setItem('grace_visitor_id', visitorId);
  let lastUserMessage = '';

  // ==================== CHAT ====================
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatMessages = document.getElementById('chatMessages');

  const sendMessage = async () => {
    const message = chatInput.value.trim();
    if (!message) return;
    lastUserMessage = message;
    addMessage(message, 'user');
    chatInput.value = '';
    const typing = addTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, visitorId })
      });
      const data = await res.json();
      typing.remove();
      const msgEl = addMessage(data.reply, 'grace');
      addMessageActions(msgEl, data.reply, message);
    } catch (err) {
      typing.remove();
      addMessage("I'm having trouble connecting right now, but know this: you matter.", 'grace');
    }
  };

  const addMessage = (text, sender) => {
    const div = document.createElement('div');
    div.className = `message ${sender === 'grace' ? 'grace-message' : 'user-message'}`;
    div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  };

  const addMessageActions = (msgEl, graceReply, userMessage) => {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // Feedback buttons
    const helpful = document.createElement('button');
    helpful.className = 'feedback-btn feedback-yes';
    helpful.innerHTML = '&#10084; This helped';
    helpful.addEventListener('click', () => sendFeedback(userMessage, graceReply, true, actions));

    const notHelpful = document.createElement('button');
    notHelpful.className = 'feedback-btn feedback-no';
    notHelpful.textContent = 'Not quite';
    notHelpful.addEventListener('click', () => sendFeedback(userMessage, graceReply, false, actions));

    // Share button
    const share = document.createElement('button');
    share.className = 'share-msg-btn';
    share.textContent = 'Share this';
    share.addEventListener('click', () => shareText(graceReply, 'Grace said something that moved me:'));

    actions.appendChild(helpful);
    actions.appendChild(notHelpful);
    actions.appendChild(share);
    msgEl.querySelector('.message-content').appendChild(actions);
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

  const addTyping = () => {
    const div = document.createElement('div');
    div.className = 'message grace-message typing';
    div.innerHTML = '<div class="message-content">Grace is thinking with love...</div>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  };

  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  chatSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

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

  document.getElementById('postSubmit').addEventListener('click', async () => {
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

  document.getElementById('chainSubmit').addEventListener('click', async () => {
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

  // ==================== JOURNAL ====================
  const journalEntries = document.getElementById('journalEntries');

  const loadJournal = async () => {
    try {
      const res = await fetch('/api/journal');
      const data = await res.json();
      renderJournal(data.entries);
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
      // Show first 300 chars as preview
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

    // Read more toggle
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

    // Heart journal entries
    journalEntries.querySelectorAll('.journal-heart').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await fetch(`/api/journal/${id}/heart`, { method: 'POST' });
        const current = parseInt(btn.textContent);
        btn.innerHTML = `${current + 1} &#10084;`;
        btn.classList.add('hearted');
      });
    });

    // Share journal entries
    journalEntries.querySelectorAll('.share-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        shareText(btn.dataset.text, "From Grace's Journal:");
      });
    });
  };

  // ==================== SUBSCRIBE ====================
  document.getElementById('subSubmit').addEventListener('click', async () => {
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

  // Also submit on Enter in email field
  document.getElementById('subEmail').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('subSubmit').click();
  });

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

  document.getElementById('shareChain').addEventListener('click', () => {
    const count = chainCount.textContent;
    shareText(`${count} people have joined the Love Chain on Grace. A movement to build the future on love, not extraction. Add your link:`, '');
  });

  document.getElementById('shareGrace').addEventListener('click', () => {
    shareText('The future should be built on love, not extraction. Grace is a movement to make sure we don\'t lose our humanity as AI transforms the world.', '');
  });

  // ==================== STATS ====================
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

      // Update subscriber count
      const subCount = document.getElementById('subCount');
      if (data.subscribers > 0) {
        subCount.textContent = `${data.subscribers} ${data.subscribers === 1 ? 'person has' : 'people have'} joined the movement.`;
      }
    } catch (err) {}
  };

  // ==================== INIT ====================
  loadPosts();
  loadChain();
  loadJournal();
  loadStats();
});
