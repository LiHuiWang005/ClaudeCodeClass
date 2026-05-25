(function () {
  'use strict';

  var token = '';
  var user = null;
  var books = [];
  var votesRemaining = 0;
  var authMode = 'login'; // 'login' | 'register' | 'forgot' | 'reset'
  var resetTokenSaved = '';
  var resetUsername = '';

  var headerRight = document.getElementById('header-right');
  var bookListEl = document.getElementById('book-list');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');

  // ==================== API ====================
  function apiGet(url) {
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, { headers: headers }).then(function (r) { return r.json(); });
  }

  function apiPost(url, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function apiPut(url, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function apiDelete(url) {
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, { method: 'DELETE', headers: headers })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  // ==================== Header ====================
  function renderHeader() {
    if (token && user) {
      var roleLabel = user.role === 'admin' ? ' [管理员]' : '';
      var badgeClass = votesRemaining > 0 ? '' : ' zero';
      headerRight.innerHTML =
        '<span class="uname">' + esc(user.username) + roleLabel + '</span>' +
        '<span class="vbadge' + badgeClass + '">' +
          (votesRemaining > 0 ? '剩余 ' + votesRemaining + '/3 票' : '票已用完') +
        '</span>' +
        '<button class="lbtn" id="do-logout">退出</button>';
      document.getElementById('do-logout').onclick = doLogout;
    } else {
      var isLogin = authMode === 'login';
      var isRegister = authMode === 'register';
      var isForgot = authMode === 'forgot';
      var isReset = authMode === 'reset';

      if (isLogin) {
        headerRight.innerHTML =
          '<input id="h-username" placeholder="用户名" maxlength="20">' +
          '<input id="h-password" type="password" placeholder="6位数字密码" maxlength="6">' +
          '<button id="h-submit" class="obtn">登录</button>' +
          '<a href="#" id="h-forgot" class="slnk">忘记密码</a>' +
          '<a href="#" id="h-switch" class="slnk">去注册</a>' +
          '<div id="h-error" class="herr" hidden></div>';
      } else if (isRegister) {
        headerRight.innerHTML =
          '<input id="h-username" placeholder="用户名" maxlength="20">' +
          '<input id="h-password" type="password" placeholder="6位数字密码" maxlength="6">' +
          '<input id="h-email" placeholder="邮箱" maxlength="50">' +
          '<button id="h-submit" class="obtn">注册</button>' +
          '<a href="#" id="h-switch" class="slnk">去登录</a>' +
          '<div id="h-error" class="herr" hidden></div>';
      } else if (isForgot) {
        headerRight.innerHTML =
          '<input id="h-email" placeholder="注册邮箱" maxlength="50">' +
          '<button id="h-submit" class="obtn">发送重置令牌</button>' +
          '<a href="#" id="h-switch" class="slnk">返回登录</a>' +
          '<div id="h-error" class="herr" hidden></div>' +
          '<div id="h-reset-msg" class="reset-msg" hidden></div>';
      } else {
        headerRight.innerHTML =
          '<div class="reset-info">为用户 <b>' + esc(resetUsername) + '</b> 设置新密码</div>' +
          '<input id="h-reset-token" placeholder="粘贴重置令牌" maxlength="64">' +
          '<input id="h-password" type="password" placeholder="6位数字新密码" maxlength="6">' +
          '<button id="h-submit" class="obtn">重置密码</button>' +
          '<a href="#" id="h-switch" class="slnk">返回登录</a>' +
          '<div id="h-error" class="herr" hidden></div>' +
          '<div id="h-reset-msg" class="reset-msg" hidden></div>';
      }

      document.getElementById('h-submit').onclick = handleAuth;
      document.getElementById('h-switch').onclick = function (e) {
        e.preventDefault();
        authMode = 'login';
        renderHeader();
      };

      if (isLogin) {
        document.getElementById('h-forgot').onclick = function (e) {
          e.preventDefault();
          authMode = 'forgot';
          renderHeader();
        };
      }
    }
  }

  // ==================== Auth ====================
  function handleAuth(e) {
    e.preventDefault();

    if (authMode === 'forgot') {
      handleForgotPassword();
      return;
    }

    if (authMode === 'reset') {
      handleResetPassword();
      return;
    }

    var u = document.getElementById('h-username');
    var p = document.getElementById('h-password');
    var err = document.getElementById('h-error');

    var username = u.value.trim();
    var password = p.value;

    if (!username) { err.textContent = '请输入用户名'; err.hidden = false; return; }
    if (!/^\d{6}$/.test(password)) { err.textContent = '密码必须为6位数字'; err.hidden = false; return; }
    err.hidden = true;

    var body = { username: username, password: password };

    if (authMode === 'register') {
      var emailInput = document.getElementById('h-email');
      var email = emailInput.value.trim();
      if (!email) { err.textContent = '请输入邮箱'; err.hidden = false; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = '邮箱格式不正确'; err.hidden = false; return; }
      body.email = email;
    }

    var endpoint = authMode === 'login' ? '/api/login' : '/api/register';
    apiPost(endpoint, body)
      .then(function (r) {
        if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return; }
        token = r.data.token;
        user = r.data;
        localStorage.setItem('votebook_token', token);
        localStorage.setItem('votebook_user', JSON.stringify({ username: r.data.username, role: r.data.role }));
        return apiGet('/api/user/stats');
      })
      .then(function (stats) {
        if (stats) {
          votesRemaining = stats.votesRemaining;
          renderHeader();
          updateVoteButtons();
          updateAddBookSection();
          err.hidden = true;
        }
      });
  }

  function handleForgotPassword() {
    var emailInput = document.getElementById('h-email');
    var err = document.getElementById('h-error');
    var msg = document.getElementById('h-reset-msg');
    var email = emailInput.value.trim();

    if (!email) { err.textContent = '请输入邮箱'; err.hidden = false; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = '邮箱格式不正确'; err.hidden = false; return; }
    err.hidden = true;

    apiPost('/api/forgot-password', { email: email })
      .then(function (r) {
        if (!r.ok) {
          err.textContent = r.data.error;
          err.hidden = false;
          return;
        }
        if (r.data.resetToken) {
          // Fallback: no email configured, show token on page
          resetTokenSaved = r.data.resetToken;
          resetUsername = r.data.username;
          authMode = 'reset';
          renderHeader();
        } else {
          // Email sent: switch to reset mode to enter token from email
          resetTokenSaved = '';
          resetUsername = '';
          authMode = 'reset';
          renderHeader();
          document.getElementById('h-reset-msg').textContent = r.data.message;
          document.getElementById('h-reset-msg').hidden = false;
        }
      });
  }

  function handleResetPassword() {
    var tokenInput = document.getElementById('h-reset-token');
    var p = document.getElementById('h-password');
    var err = document.getElementById('h-error');
    var msg = document.getElementById('h-reset-msg');

    var tokenVal = tokenInput.value.trim();
    var password = p.value;

    if (!tokenVal) { err.textContent = '请粘贴重置令牌'; err.hidden = false; return; }
    if (!/^\d{6}$/.test(password)) { err.textContent = '密码必须为6位数字'; err.hidden = false; return; }
    err.hidden = true;

    apiPost('/api/reset-password', { token: tokenVal, newPassword: password })
      .then(function (r) {
        if (!r.ok) {
          err.textContent = r.data.error;
          err.hidden = false;
          return;
        }
        token = r.data.token;
        user = r.data;
        localStorage.setItem('votebook_token', token);
        localStorage.setItem('votebook_user', JSON.stringify({ username: r.data.username, role: r.data.role }));
        return apiGet('/api/user/stats');
      })
      .then(function (stats) {
        if (stats) {
          votesRemaining = stats.votesRemaining;
          renderHeader();
          updateVoteButtons();
          updateAddBookSection();
          msg.textContent = '密码重置成功，已自动登录';
          msg.hidden = false;
        }
      });
  }

  function doLogout() {
    token = '';
    user = null;
    votesRemaining = 0;
    authMode = 'login';
    localStorage.removeItem('votebook_token');
    localStorage.removeItem('votebook_user');
    renderHeader();
    updateVoteButtons();
    updateAddBookSection();
  }

  // ==================== Books ====================
  function createCover(book, i) {
    var wrap = document.createElement('div');
    wrap.className = 'bcover-wrap';
    if (book.cover) {
      wrap.style.backgroundImage = 'url("/api/covers/' + book.id + '")';
      wrap.style.backgroundSize = 'contain';
      wrap.style.backgroundPosition = 'center';
      wrap.style.backgroundRepeat = 'no-repeat';
    }

    if (!book.cover) {
      var ph = document.createElement('div');
      ph.className = 'bcover-ph';
      ph.textContent = book.title ? book.title[0] : '?';
      wrap.appendChild(ph);
    }

    return wrap;
  }

  function renderBooks() {
    loadingEl.hidden = true;
    bookListEl.innerHTML = '';

    if (!books.length) {
      bookListEl.innerHTML = '<div class="status-text">暂无图书</div>';
      return;
    }

    books.forEach(function (b, i) {
      var card = document.createElement('div');
      card.className = 'bcard';

      card.appendChild(createCover(b, i));

      var body = document.createElement('div');
      body.className = 'bbody';

      body.innerHTML =
        '<div class="btitle">' + esc(b.title) + '</div>' +
        '<div class="bauthor">' + esc(b.author) + '</div>' +
        '<div class="bdesc">' + esc(b.description) + '</div>' +
        '<div class="bfoot">' +
          '<span class="bvotes">共 <b>' + b.votes + '</b> 票</span>' +
          '<button class="vbtn" data-bid="' + b.id + '">投票</button>' +
        '</div>' +
        '<div class="bcard-actions">' +
          '<button class="act-edit" data-bid="' + b.id + '">编辑</button>' +
          '<button class="act-del" data-bid="' + b.id + '">删除</button>' +
        '</div>';

      card.appendChild(body);
      bookListEl.appendChild(card);
    });

    bindVoteButtons();
    bindAdminActions();
  }

  function bindVoteButtons() {
    var btns = bookListEl.querySelectorAll('.vbtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var bid = parseInt(this.getAttribute('data-bid'));
        doVote(bid, this);
      };
    }
    updateVoteButtons();
  }

  function bindAdminActions() {
    var editBtns = bookListEl.querySelectorAll('.act-edit');
    var delBtns = bookListEl.querySelectorAll('.act-del');

    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].onclick = function () {
        var bid = parseInt(this.getAttribute('data-bid'));
        var book = books.find(function (x) { return x.id === bid; });
        if (book) openEditModal(book);
      };
    }

    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].onclick = function () {
        var bid = parseInt(this.getAttribute('data-bid'));
        var book = books.find(function (x) { return x.id === bid; });
        if (book && confirm('确定要删除《' + book.title + '》吗？该书的所有投票记录也将被清除。')) {
          apiDelete('/api/books/' + bid).then(function (r) {
            if (r.ok) {
              books = books.filter(function (x) { return x.id !== bid; });
              renderBooks();
            } else {
              alert(r.data.error || '删除失败');
            }
          });
        }
      };
    }
  }

  // ----- Edit Modal -----
  var currentEditId = null;

  function openEditModal(book) {
    currentEditId = book.id;
    document.getElementById('edit-title').value = book.title;
    document.getElementById('edit-author').value = book.author;
    document.getElementById('edit-cover').value = book.cover || '';
    document.getElementById('edit-desc').value = book.description || '';
    document.getElementById('edit-status').hidden = true;
    document.getElementById('edit-modal').hidden = false;
  }

  function closeEditModal() {
    document.getElementById('edit-modal').hidden = true;
    currentEditId = null;
  }

  function initEditModal() {
    document.getElementById('edit-save').onclick = function () {
      var statusEl = document.getElementById('edit-status');
      var body = {
        title: document.getElementById('edit-title').value.trim(),
        author: document.getElementById('edit-author').value.trim(),
        cover: document.getElementById('edit-cover').value.trim(),
        description: document.getElementById('edit-desc').value.trim()
      };

      statusEl.textContent = '保存中...';
      statusEl.style.color = '#999';
      statusEl.hidden = false;

      apiPut('/api/books/' + currentEditId, body).then(function (r) {
        if (!r.ok) {
          statusEl.textContent = r.data.error || '保存失败';
          statusEl.style.color = '#d14a30';
          return;
        }
        statusEl.textContent = '已保存';
        statusEl.style.color = '#52c41a';
        // Update local state
        var idx = books.findIndex(function (x) { return x.id === currentEditId; });
        if (idx !== -1) books[idx] = r.data;
        setTimeout(function () {
          closeEditModal();
          renderBooks();
        }, 600);
      });
    };

    document.getElementById('edit-cancel').onclick = closeEditModal;

    // Click overlay to close
    document.getElementById('edit-modal').onclick = function (e) {
      if (e.target === this) closeEditModal();
    };
  }

  // ----- Reset Votes -----
  function initAdminPanel() {
    document.getElementById('reset-votes-btn').onclick = function () {
      if (!confirm('确定要重置所有投票吗？所有图书的票数将归零，投票记录将被清空（可选择存档）。')) return;
      var archive = confirm('是否将当前投票记录存档到 votes_history.json？（确定=存档，取消=直接清空）');
      apiPost('/api/reset-votes', { archive: archive }).then(function (r) {
        if (r.ok) {
          alert(r.data.message + '，共重置 ' + r.data.booksReset + ' 本书');
          books.forEach(function (b) { b.votes = 0; });
          renderBooks();
        } else {
          alert(r.data.error || '操作失败');
        }
      });
    };
  }

  function updateVoteButtons() {
    var btns = bookListEl.querySelectorAll('.vbtn');
    var loggedIn = !!(token && user);
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = loggedIn && votesRemaining <= 0;
      btns[i].textContent = (loggedIn && votesRemaining <= 0) ? '已投完' : '投票';
    }
  }

  function doVote(bookId, btn) {
    if (!token || !user) {
      authMode = 'login';
      renderHeader();
      return;
    }
    if (votesRemaining <= 0) return;

    btn.disabled = true;
    apiPost('/api/vote/' + bookId, {})
      .then(function (r) {
        if (!r.ok) { errorEl.textContent = r.data.error; errorEl.hidden = false; btn.disabled = false; return; }
        votesRemaining = r.data.votesRemaining;
        var b = books.find(function (x) { return x.id === bookId; });
        if (b) b.votes = r.data.book.votes;
        renderBooks();
        renderHeader();
      });
  }

  // ==================== Add Book (Admin) ====================
  function updateAddBookSection() {
    var section = document.getElementById('add-book-section');
    var panel = document.getElementById('admin-panel');
    var actions = bookListEl.querySelectorAll('.bcard-actions');
    var isAdmin = user && user.role === 'admin';

    if (isAdmin) {
      section.hidden = false;
      panel.hidden = false;
      for (var i = 0; i < actions.length; i++) {
        actions[i].style.display = '';
      }
    } else {
      section.hidden = true;
      panel.hidden = true;
      for (var j = 0; j < actions.length; j++) {
        actions[j].style.display = 'none';
      }
    }
  }

  function initAddBook() {
    var submitBtn = document.getElementById('add-submit');
    var titleInput = document.getElementById('add-title');
    var authorInput = document.getElementById('add-author');
    var statusEl = document.getElementById('add-status');

    submitBtn.onclick = function () {
      var title = titleInput.value.trim();
      var author = authorInput.value.trim();

      if (!title) {
        statusEl.textContent = '请输入书名';
        statusEl.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = '正在从豆瓣搜索...';
      statusEl.style.color = '#999';
      statusEl.hidden = false;

      fetch('/api/books', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ title: title, author: author })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d } }); })
        .then(function (r) {
          submitBtn.disabled = false;
          if (!r.ok) {
            statusEl.textContent = r.data.error || '添加失败';
            statusEl.style.color = '#d14a30';
            return;
          }
          statusEl.textContent = '《' + r.data.title + '》已添加！';
          statusEl.style.color = '#52c41a';
          titleInput.value = '';
          authorInput.value = '';
          // Reload books
          fetch('/api/books')
            .then(function (resp) { return resp.json(); })
            .then(function (list) {
              books = list;
              renderBooks();
            });
        })
        .catch(function () {
          submitBtn.disabled = false;
          statusEl.textContent = '网络异常，请确认服务已启动';
          statusEl.style.color = '#d14a30';
        });
    };

    updateAddBookSection();
  }

  // ==================== Init ====================
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function load() {
    var saved = localStorage.getItem('votebook_token');
    if (saved) token = saved;

    var savedUser = localStorage.getItem('votebook_user');
    if (savedUser) {
      try { user = JSON.parse(savedUser); } catch (e) { user = null; }
    }

    var fetchers = [fetch('/api/books').then(function (r) { return r.json(); })];

    if (token) {
      fetchers.push(
        apiGet('/api/user/stats').then(function (s) {
          votesRemaining = s.votesRemaining;
        }).catch(function () {
          token = '';
          user = null;
          localStorage.removeItem('votebook_token');
          localStorage.removeItem('votebook_user');
        })
      );
    }

    Promise.all(fetchers)
      .then(function (results) {
        books = results[0];
        renderBooks();
        renderHeader();
        updateAddBookSection();
      })
      .catch(function () {
        loadingEl.hidden = true;
        errorEl.textContent = '加载失败，请确认服务已启动';
        errorEl.hidden = false;
      });
  }

  load();
  initAddBook();
  initEditModal();
  initAdminPanel();
})();
