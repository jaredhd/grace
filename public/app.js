document.addEventListener('DOMContentLoaded', () => {
  const sessionId = crypto.randomUUID();
  // Persistent visitor ID - survives page reloads so Grace remembers you
  const visitorId = localStorage.getItem('grace_visitor_id') || crypto.randomUUID();
  localStorage.setItem('grace_visitor_id', visitorId);
  let lastUserMessage = '';

  // ==================== AUTH STATE ====================
  let authState = { signedIn: false, name: '', email: '' };

  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`/api/auth/status?visitorId=${visitorId}`);
      const data = await res.json();
      if (data.signedIn) {
        authState = { signedIn: true, name: data.name, email: data.email };
      }
    } catch (e) {}
    renderAuthBar();
  };

  const renderAuthBar = () => {
    const bar = document.getElementById('boardAuthBar');
    if (!bar) return;
    if (authState.signedIn) {
      bar.innerHTML = `<span class="auth-status">Signed in as <strong>${escapeHtml(authState.name || authState.email)}</strong></span>`;
      bar.className = 'board-auth signed-in';
      updateJoinSection();
    } else {
      bar.innerHTML = `<span class="auth-status">Want to edit posts or get replies?</span> <button class="auth-sign-in-btn" id="authSignInBtn">Sign in</button>`;
      bar.className = 'board-auth';
      const signInBtn = document.getElementById('authSignInBtn');
      if (signInBtn) signInBtn.addEventListener('click', showSignInForm);
    }
  };

  const showSignInForm = () => {
    const bar = document.getElementById('boardAuthBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="sign-in-form">
        <p class="sign-in-note">Enter the email you used to join the movement:</p>
        <div class="sign-in-row">
          <input type="email" id="signInEmail" placeholder="your@email.com" autocomplete="email">
          <button class="btn btn-primary btn-small" id="signInSendCode">Send code</button>
        </div>
        <div class="sign-in-message" id="signInMessage"></div>
      </div>
    `;
    bar.className = 'board-auth signing-in';
    document.getElementById('signInSendCode').addEventListener('click', sendSignInCode);
    document.getElementById('signInEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendSignInCode(); });
  };

  const sendSignInCode = async () => {
    const email = document.getElementById('signInEmail').value.trim();
    const msgEl = document.getElementById('signInMessage');
    if (!email) { msgEl.textContent = 'Please enter your email.'; return; }

    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.textContent = data.error || 'Something went wrong.';
        return;
      }
      showCodeInput(email);
    } catch (e) {
      msgEl.textContent = 'Could not send code. Try again.';
    }
  };

  const showCodeInput = (email) => {
    const bar = document.getElementById('boardAuthBar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="sign-in-form">
        <p class="sign-in-note">Grace sent a code to <strong>${escapeHtml(email)}</strong>. Check your email:</p>
        <div class="sign-in-row">
          <input type="text" id="signInCode" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
          <button class="btn btn-primary btn-small" id="signInVerify">Verify</button>
        </div>
        <div class="sign-in-message" id="signInMessage"></div>
      </div>
    `;
    bar.className = 'board-auth signing-in';
    document.getElementById('signInVerify').addEventListener('click', () => verifyCode(email));
    document.getElementById('signInCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(email); });
    document.getElementById('signInCode').focus();
  };

  const verifyCode = async (email) => {
    const code = document.getElementById('signInCode').value.trim();
    const msgEl = document.getElementById('signInMessage');
    if (!code) { msgEl.textContent = 'Please enter the code.'; return; }

    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, visitorId })
      });
      const data = await res.json();
      if (!res.ok) {
        msgEl.textContent = data.error || 'Invalid code.';
        return;
      }
      authState = { signedIn: true, name: data.name, email };
      renderAuthBar();
      loadPosts(currentFilter); // Refresh posts with ownership info
      checkUnreadReplies();
    } catch (e) {
      msgEl.textContent = 'Could not verify. Try again.';
    }
  };

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
    let url = type ? `/api/posts?type=${type}` : '/api/posts';
    url += (url.includes('?') ? '&' : '?') + `visitorId=${visitorId}`;
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
    boardPosts.innerHTML = posts.map(p => {
      const typeLabel = p.type === 'need' ? 'Need' : p.type === 'offer' ? 'Offer' : 'Story';
      const editedTag = p.updated_at ? ' <span class="post-edited">(edited)</span>' : '';

      // Ownership controls
      let ownerControls = '';
      if (p.is_mine && authState.signedIn) {
        const replyLabel = p.reply_count > 0
          ? `<button class="view-replies-btn" data-id="${p.id}">${p.reply_count} ${p.reply_count === 1 ? 'person reached out' : 'people reached out'}</button>`
          : '';
        ownerControls = `
          <div class="post-owner-actions">
            ${replyLabel}
            <button class="edit-post-btn" data-id="${p.id}">Edit</button>
            <button class="delete-post-btn" data-id="${p.id}">Remove</button>
          </div>
        `;
      }

      // Reach out button (for signed-in users viewing others' owned posts)
      let reachOutBtn = '';
      if (!p.is_mine && p.has_owner && authState.signedIn) {
        reachOutBtn = `<button class="reach-out-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}">Reach out</button>`;
      }

      return `
        <div class="post post-${p.type}" data-post-id="${p.id}">
          <div class="post-badge">${typeLabel}</div>
          <div class="post-body">
            <div class="post-meta">
              <strong>${escapeHtml(p.name)}</strong>${editedTag}
              ${p.location ? `<span class="post-location">${escapeHtml(p.location)}</span>` : ''}
            </div>
            <p class="post-content-text">${escapeHtml(p.content)}</p>
            <div class="post-actions">
              <button class="heart-btn" data-id="${p.id}" data-type="post">${p.hearts} &#10084;</button>
              <button class="talk-about-post" data-content="${escapeHtml(p.content)}" data-type="${p.type}">Talk to Grace about this</button>
              ${reachOutBtn}
            </div>
            ${ownerControls}
            <div class="post-replies-panel" id="replies-${p.id}" style="display:none"></div>
            <div class="post-reply-form" id="reply-form-${p.id}" style="display:none"></div>
          </div>
        </div>
      `;
    }).join('');

    // Heart buttons
    boardPosts.querySelectorAll('.heart-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await fetch(`/api/posts/${id}/heart`, { method: 'POST' });
        const current = parseInt(btn.textContent);
        btn.innerHTML = `${current + 1} &#10084;`;
        btn.classList.add('hearted');
      });
    });

    // "Talk to Grace about this"
    boardPosts.querySelectorAll('.talk-about-post').forEach(btn => {
      btn.addEventListener('click', () => {
        const postContent = btn.dataset.content;
        const postType = btn.dataset.type;
        const prefix = postType === 'need' ? 'Someone needs help: ' : postType === 'offer' ? 'Someone is offering: ' : 'Someone shared: ';
        floatingInput.value = prefix + postContent.substring(0, 150);
        openChat();
      });
    });

    // Edit buttons
    boardPosts.querySelectorAll('.edit-post-btn').forEach(btn => {
      btn.addEventListener('click', () => startEditPost(btn.dataset.id));
    });

    // Delete buttons
    boardPosts.querySelectorAll('.delete-post-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmDeletePost(btn.dataset.id));
    });

    // View replies buttons
    boardPosts.querySelectorAll('.view-replies-btn').forEach(btn => {
      btn.addEventListener('click', () => loadReplies(btn.dataset.id));
    });

    // Reach out buttons
    boardPosts.querySelectorAll('.reach-out-btn').forEach(btn => {
      btn.addEventListener('click', () => showReplyForm(btn.dataset.id, btn.dataset.name));
    });
  };

  // ==================== POST MANAGEMENT ====================
  const startEditPost = (postId) => {
    const postEl = boardPosts.querySelector(`[data-post-id="${postId}"]`);
    if (!postEl) return;
    const contentEl = postEl.querySelector('.post-content-text');
    const currentContent = contentEl.textContent;

    contentEl.innerHTML = `
      <textarea class="edit-post-textarea" maxlength="2000" rows="3">${escapeHtml(currentContent)}</textarea>
      <div class="edit-post-actions">
        <button class="btn btn-primary btn-small save-edit-btn">Save</button>
        <button class="btn btn-secondary btn-small cancel-edit-btn">Cancel</button>
      </div>
    `;

    postEl.querySelector('.save-edit-btn').addEventListener('click', async () => {
      const newContent = postEl.querySelector('.edit-post-textarea').value.trim();
      if (!newContent) return;
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent, visitorId })
        });
        if (res.ok) loadPosts(currentFilter);
      } catch (e) {}
    });

    postEl.querySelector('.cancel-edit-btn').addEventListener('click', () => {
      loadPosts(currentFilter);
    });
  };

  const confirmDeletePost = (postId) => {
    const postEl = boardPosts.querySelector(`[data-post-id="${postId}"]`);
    if (!postEl) return;
    const actions = postEl.querySelector('.post-owner-actions');
    actions.innerHTML = `
      <span class="delete-confirm-text">Remove this post?</span>
      <button class="btn btn-primary btn-small confirm-delete-btn">Yes, remove</button>
      <button class="btn btn-secondary btn-small cancel-delete-btn">Cancel</button>
    `;
    postEl.querySelector('.confirm-delete-btn').addEventListener('click', async () => {
      try {
        await fetch(`/api/posts/${postId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId })
        });
        loadPosts(currentFilter);
      } catch (e) {}
    });
    postEl.querySelector('.cancel-delete-btn').addEventListener('click', () => {
      loadPosts(currentFilter);
    });
  };

  // ==================== PRIVATE REPLIES ====================
  const showReplyForm = (postId, postAuthorName) => {
    const formEl = document.getElementById(`reply-form-${postId}`);
    if (!formEl) return;
    if (formEl.style.display !== 'none') { formEl.style.display = 'none'; return; }

    formEl.style.display = 'block';
    formEl.innerHTML = `
      <p class="reply-prompt">Only <strong>${escapeHtml(postAuthorName)}</strong> will see this message.</p>
      <input type="text" class="reply-name-input" placeholder="Your name" maxlength="100" value="${escapeHtml(authState.name || '')}">
      <textarea class="reply-content-input" placeholder="Your message..." maxlength="1000" rows="2"></textarea>
      <div class="reply-form-actions">
        <button class="btn btn-primary btn-small send-reply-btn">Send</button>
        <button class="btn btn-secondary btn-small cancel-reply-btn">Cancel</button>
      </div>
    `;

    formEl.querySelector('.send-reply-btn').addEventListener('click', async () => {
      const name = formEl.querySelector('.reply-name-input').value.trim();
      const content = formEl.querySelector('.reply-content-input').value.trim();
      if (!name || !content) return;

      try {
        const res = await fetch(`/api/posts/${postId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content, visitorId })
        });
        const data = await res.json();
        if (res.ok) {
          formEl.innerHTML = `<p class="reply-success">Sent! ${escapeHtml(postAuthorName)} will see this when they return.</p>`;
          setTimeout(() => { formEl.style.display = 'none'; }, 3000);
        } else {
          formEl.querySelector('.reply-content-input').insertAdjacentHTML('afterend',
            `<p class="reply-error">${escapeHtml(data.error || 'Could not send.')}</p>`);
        }
      } catch (e) {
        formEl.querySelector('.reply-content-input').insertAdjacentHTML('afterend',
          '<p class="reply-error">Could not send. Try again.</p>');
      }
    });

    formEl.querySelector('.cancel-reply-btn').addEventListener('click', () => {
      formEl.style.display = 'none';
    });
  };

  const loadReplies = async (postId) => {
    const panel = document.getElementById(`replies-${postId}`);
    if (!panel) return;
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    panel.innerHTML = '<div class="loading-small">Loading replies...</div>';

    try {
      const res = await fetch(`/api/posts/${postId}/replies?visitorId=${visitorId}`);
      const data = await res.json();
      if (!res.ok) { panel.innerHTML = '<p class="reply-error">Could not load replies.</p>'; return; }

      if (data.replies.length === 0) {
        panel.innerHTML = '<p class="no-replies">No replies yet.</p>';
        return;
      }

      panel.innerHTML = data.replies.map(r => {
        const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `
          <div class="reply-item">
            <div class="reply-header"><strong>${escapeHtml(r.name)}</strong> <span class="reply-date">${date}</span></div>
            <p>${escapeHtml(r.content)}</p>
          </div>
        `;
      }).join('');

      // Update the button text to remove "unread" feel
      const btn = boardPosts.querySelector(`.view-replies-btn[data-id="${postId}"]`);
      if (btn) btn.classList.add('replies-read');
    } catch (e) {
      panel.innerHTML = '<p class="reply-error">Could not load replies.</p>';
    }
  };

  // ==================== UNREAD REPLY NOTIFICATION ====================
  const checkUnreadReplies = async () => {
    if (!authState.signedIn) return;
    try {
      const res = await fetch(`/api/my-posts?visitorId=${visitorId}`);
      const data = await res.json();
      if (data.unreadTotal > 0) {
        showReplyNotification(data.unreadTotal);
      }
    } catch (e) {}
  };

  const showReplyNotification = (count) => {
    const existing = document.getElementById('boardNotification');
    if (existing) existing.remove();

    const bar = document.getElementById('boardAuthBar');
    if (!bar) return;
    const notification = document.createElement('div');
    notification.id = 'boardNotification';
    notification.className = 'board-notification';
    notification.innerHTML = `<span class="reply-dot"></span> ${count} ${count === 1 ? 'person' : 'people'} reached out to you on the board`;
    bar.insertAdjacentElement('afterend', notification);
  };

  // ==================== JOIN SECTION TRANSFORMATION ====================
  const updateJoinSection = () => {
    if (!authState.signedIn) return;
    const joinSection = document.getElementById('join');
    if (!joinSection) return;
    const container = joinSection.querySelector('.container');
    if (!container) return;

    const displayName = authState.name || 'friend';
    container.innerHTML = `
      <h2>You're Part of This</h2>
      <p class="section-sub-dark">Welcome, ${escapeHtml(displayName)}. You're part of a movement of people who believe in love over extraction.</p>
      <div class="joined-actions">
        <button class="btn btn-dark" id="joinedShare">Send Grace to Someone Who Needs It</button>
        <button class="btn btn-dark-outline" id="joinedBoard">Visit the Community Board</button>
      </div>
      <div class="subscribe-count" id="subCount"></div>
    `;

    const shareBtn = document.getElementById('joinedShare');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const shareData = {
          title: 'Someone sent you Grace',
          text: 'A free community for people navigating what comes next. No ads. No data selling. Just people who care.',
          url: window.location.origin + '/welcome',
        };
        if (navigator.share) {
          navigator.share(shareData).catch(() => {});
        } else {
          navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`).then(() => {
            shareBtn.textContent = 'Link copied!';
            setTimeout(() => { shareBtn.textContent = 'Send Grace to Someone Who Needs It'; }, 2000);
          });
        }
      });
    }

    const boardBtn = document.getElementById('joinedBoard');
    if (boardBtn) {
      boardBtn.addEventListener('click', () => {
        document.getElementById('community').scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Update nav CTA buttons that say "Join the Movement"
    document.querySelectorAll('a.nav-cta[href="#join"]').forEach(link => {
      link.textContent = 'Share Grace';
      link.href = '/share';
    });

    // Update hero CTA
    const heroCta = document.querySelector('.hero-actions a[href="#join"]');
    if (heroCta) {
      heroCta.textContent = 'Share Grace';
      heroCta.href = '/share';
    }

    // Reload stats for the count display
    loadStats();
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
        body: JSON.stringify({ type, name, location, content, visitorId: authState.signedIn ? visitorId : null })
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
            <button class="journal-share-btn" data-title="${escapeHtml(entry.title)}" data-text="${escapeHtml(entry.content.substring(0, 140))}" data-id="${entry.id}">Share this</button>
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

    journalEntries.querySelectorAll('.journal-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const title = btn.dataset.title;
        const text = btn.dataset.text;
        const id = btn.dataset.id;
        const url = `${window.location.origin}/journal#${id}`;
        const shareData = {
          title: `Grace: "${title}"`,
          text: `From Grace's Journal:\n\n"${text}..."\n\nRead more:`,
          url: url,
        };
        if (navigator.share) {
          navigator.share(shareData).catch(() => {});
        } else {
          const full = `${shareData.text}\n${url}`;
          navigator.clipboard.writeText(full).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share this'; }, 2000);
          });
        }
      });
    });

    // Scroll to specific entry if URL hash matches an entry ID
    if (window.location.hash) {
      const targetId = window.location.hash.substring(1);
      const targetEntry = journalEntries.querySelector(`[data-id="${targetId}"]`);
      if (targetEntry) {
        targetEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEntry.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => { targetEntry.style.boxShadow = ''; }, 3000);
        // Auto-expand the entry
        const readMore = targetEntry.querySelector('.journal-read-more');
        if (readMore) readMore.click();
      }
    }
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
          body: JSON.stringify({ email, name, visitorId })
        });
        const data = await res.json();
        msgEl.textContent = data.message;
        msgEl.className = 'subscribe-message success';
        document.getElementById('subEmail').value = '';
        document.getElementById('subName').value = '';
        loadStats();
        // Auto sign-in after subscribing
        if (data.signedIn) {
          authState = { signedIn: true, name: name || '', email };
          renderAuthBar();
          loadPosts(currentFilter);
        }
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
      if (data.memories > 0) parts.push(`${data.memories} conversations held`);
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

      // Community pulse — show proof of human presence
      const pulse = document.getElementById('communityPulse');
      if (pulse && data.people > 0) {
        pulse.innerHTML = `<span class="pulse-dot"></span>${data.people} people have talked to Grace &middot; ${data.memories} conversations and counting`;
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
  // Check auth first, then load posts (so ownership info is available)
  if (document.getElementById('boardAuthBar')) {
    checkAuthStatus().then(() => {
      if (boardPosts) loadPosts();
      checkUnreadReplies();
    });
  } else if (boardPosts) {
    loadPosts();
  }
  if (chainCount) loadChain();
  if (journalEntries) loadJournal();
  if (document.getElementById('heroStats')) loadStats();
  if (dailyQuestionCard) loadDailyQuestion();
  checkWelcomeBack();
});
