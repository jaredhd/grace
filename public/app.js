document.addEventListener('DOMContentLoaded', () => {
  const sessionId = crypto.randomUUID();

  // ==================== CHAT ====================
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  const chatMessages = document.getElementById('chatMessages');

  const sendMessage = async () => {
    const message = chatInput.value.trim();
    if (!message) return;
    addMessage(message, 'user');
    chatInput.value = '';
    const typing = addTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId })
      });
      const data = await res.json();
      typing.remove();
      const msgEl = addMessage(data.reply, 'grace');
      addShareButton(msgEl, data.reply);
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

  const addShareButton = (msgEl, text) => {
    const btn = document.createElement('button');
    btn.className = 'share-msg-btn';
    btn.textContent = 'Share this';
    btn.addEventListener('click', () => shareText(text, 'Grace said something that moved me:'));
    msgEl.querySelector('.message-content').appendChild(btn);
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

  // Tab switching
  document.querySelectorAll('.board-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.board-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.dataset.type === 'all' ? null : tab.dataset.type;
      currentFilter = type;
      loadPosts(type);
    });
  });

  // Post submission
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
    // Show the most recent links
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
      // Fallback: copy to clipboard
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
      if (data.loveLinks > 0 || data.posts > 0) {
        heroStats.innerHTML = `
          <span>${data.loveLinks} links of love</span>
          <span class="stat-divider">&#183;</span>
          <span>${data.posts} community posts</span>
        `;
      }
    } catch (err) {}
  };

  // ==================== INIT ====================
  loadPosts();
  loadChain();
  loadStats();
});
