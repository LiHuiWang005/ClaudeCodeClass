const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RESET_TOKENS_FILE = path.join(DATA_DIR, 'reset-tokens.json');
const VOTES_HISTORY_FILE = path.join(DATA_DIR, 'votes_history.json');

const MAX_VOTES = 3;

// ----- email config (QQ SMTP) -----
const nodemailer = require('nodemailer');

function loadSmtpConfig() {
  var configFile = path.join(__dirname, 'config.json');
  if (fs.existsSync(configFile)) {
    try {
      var cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      if (cfg.smtp && cfg.smtp.user && cfg.smtp.pass) return cfg.smtp;
    } catch (e) { /* ignore */ }
  }
  return null;
}

var smtpConf = loadSmtpConfig();
var SMTP_CONFIG = {
  host: (smtpConf && smtpConf.host) || process.env.SMTP_HOST || 'smtp.qq.com',
  port: parseInt((smtpConf && smtpConf.port) || process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: (smtpConf && smtpConf.user) || process.env.SMTP_USER || '',
    pass: (smtpConf && smtpConf.pass) || process.env.SMTP_PASS || ''
  }
};
var mailTransport = null;
if (SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass) {
  mailTransport = nodemailer.createTransport(SMTP_CONFIG);
  mailTransport.verify(function (err) {
    if (err) console.error('邮件服务连接失败:', err.message);
    else console.log('邮件服务已就绪: ' + SMTP_CONFIG.auth.user);
  });
} else {
  console.log('邮件服务未配置（SMTP_USER / SMTP_PASS 为空），重置令牌将显示在页面上');
}

function sendResetEmail(to, username, token) {
  if (!mailTransport) {
    console.log('邮件未发送（未配置 SMTP），Token: ' + token);
    return Promise.resolve(false);
  }
  var resetLink = 'http://localhost:' + PORT + '/reset?token=' + token;
  return mailTransport.sendMail({
    from: SMTP_CONFIG.auth.user,
    to: to,
    subject: '图书投票 - 密码重置',
    text: username + ' 你好，\n\n请使用以下令牌重置密码：\n' + token +
          '\n\n或访问此链接：\n' + resetLink +
          '\n\n令牌 30 分钟内有效。\n\n图书投票系统'
  }).then(function () {
    console.log('重置邮件已发送至: ' + to);
    return true;
  }).catch(function (err) {
    console.error('邮件发送失败:', err.message);
    return false;
  });
}

const DEFAULT_BOOKS = [
  {
    id: 1,
    title: '活着',
    author: '余华',
    cover: '',
    votes: 0,
    description: '地主少爷福贵嗜赌成性，败光家业。贫困中为母亲求医，半路被国民党抓了壮丁。历经苦难回到家乡，母亲已去世，妻子家珍含辛茹苦带大一双儿女。此后命运一次次将亲人夺走，最后只剩一头老牛相伴。人是为了活着本身而活着，而不是为了活着之外的任何事物而活着。'
  },
  {
    id: 2,
    title: '三体',
    author: '刘慈欣',
    cover: '',
    votes: 0,
    description: '天文学家叶文洁在文革中历经劫难，被带到军方绝密计划"红岸工程"。她向宇宙发出了地球文明的第一声啼鸣。四光年外的三体文明在百余次毁灭与重生后，正被迫逃离母星，而地球坐标的暴露，使这场宇宙级的对峙就此拉开序幕。'
  },
  {
    id: 3,
    title: '百年孤独',
    author: '加西亚·马尔克斯',
    cover: '',
    votes: 0,
    description: '布恩迪亚家族七代人的传奇故事，加勒比海沿岸小镇马孔多的百年兴衰。融入神话传说、民间故事、宗教典故，折射出拉丁美洲一个世纪以来风云变幻的历史。这部魔幻现实主义巨著被誉为"再现拉丁美洲历史社会图景的鸿篇巨著"。'
  },
  {
    id: 4,
    title: '围城',
    author: '钱钟书',
    cover: '',
    votes: 0,
    description: '围在城里的人想逃出来，城外的人想冲进去。对婚姻也罢，职业也罢，人生的愿望大都如此。方鸿渐留学归国后的爱情、事业与生活困境，用幽默犀利的笔触勾勒出知识分子的众生相，是中国现代文学史上讽刺小说的巅峰之作。'
  },
  {
    id: 5,
    title: '小王子',
    author: '安托万·德·圣埃克苏佩里',
    cover: '',
    votes: 0,
    description: '来自B-612号小行星的小王子，走访了六个星球后来到地球。他遇见了狐狸、玫瑰和迫降在撒哈拉沙漠的飞行员。这个写给大人的童话用纯净的文字讲述关于爱、责任与生命的意义，全球销量仅次于《圣经》。'
  }
];

// ----- helpers -----

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function readJSON(file) {
  if (!fs.existsSync(file)) initData();
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ----- data init -----

function initData() {
  if (!fs.existsSync(BOOKS_FILE)) {
    writeJSON(BOOKS_FILE, DEFAULT_BOOKS);
    console.log('books.json initialized');
  }
  if (!fs.existsSync(VOTES_FILE)) {
    writeJSON(VOTES_FILE, []);
    console.log('votes.json initialized');
  }
  if (!fs.existsSync(USERS_FILE)) {
    var salt = generateSalt();
    var adminUser = {
      id: 1,
      username: 'admin',
      email: 'admin@vote-book.local',
      password: hashPassword('123456', salt),
      salt: salt,
      token: '',
      role: 'admin'
    };
    writeJSON(USERS_FILE, [adminUser]);
    console.log('users.json initialized with admin account (admin / 123456)');
  }
  if (!fs.existsSync(RESET_TOKENS_FILE)) {
    writeJSON(RESET_TOKENS_FILE, []);
    console.log('reset-tokens.json initialized');
  }
}

// ----- concurrent write lock -----

var writeLock = Promise.resolve();

function withLock(fn) {
  var prev = writeLock;
  var release;
  writeLock = new Promise(function (resolve) { release = resolve; });
  return prev.then(function () { return fn().finally(release); });
}

// ----- book info fetcher (douban) -----

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function searchDoubanBook(title, author) {
  var query = encodeURIComponent((title + ' ' + author).trim());
  var searchUrl = 'https://www.douban.com/search?cat=1001&q=' + query;

  var resp = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
  });

  if (!resp.ok) {
    throw new Error('豆瓣搜索失败: HTTP ' + resp.status);
  }

  var html = await resp.text();

  var coverMatch = html.match(/https?:\/\/img\d+\.doubanio\.com\/view\/subject\/[lms]\/public\/[a-zA-Z0-9]+\.(?:jpg|png|webp)/);
  var coverUrl = coverMatch ? coverMatch[0] : null;

  var detailMatch = html.match(/https?:\/\/book\.douban\.com\/subject\/(\d+)\//);
  var detailUrl = null;
  if (detailMatch) {
    detailUrl = detailMatch[0];
  } else {
    var encodedMatch = html.match(/%2Fsubject%2F(\d+)%2F/);
    if (encodedMatch) {
      detailUrl = 'https://book.douban.com/subject/' + encodedMatch[1] + '/';
    }
  }

  var description = '';
  if (detailUrl) {
    try {
      await new Promise(function (r) { return setTimeout(r, 600); });
      var detailResp = await fetch(detailUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
      });
      if (detailResp.ok) {
        var detailHtml = await detailResp.text();

        var descPatterns = [
          /<div[^>]*class="intro"[^>]*>([\s\S]*?)<\/div>/,
          /<meta\s+name="description"\s+content="([^"]+)"/,
          /<span[^>]*class="[^"]*all[^"]*"[^>]*>([\s\S]*?)<\/span>/
        ];

        for (var i = 0; i < descPatterns.length; i++) {
          var m = detailHtml.match(descPatterns[i]);
          if (m) {
            description = m[1]
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, ' ')
              .trim();
            if (description) break;
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch detail page:', e.message);
    }
  }

  return { coverUrl: coverUrl, description: description, doubanUrl: detailUrl };
}

function largeCoverUrl(url) {
  return url ? url.replace(/\/([sm])\/public\//, '/l/public/') : null;
}

async function fetchAndSaveBookInfo(bookId) {
  var books = readJSON(BOOKS_FILE);
  var book = books.find(function (b) { return b.id === bookId; });
  if (!book) throw new Error('图书不存在');

  console.log('Fetching info for: ' + book.title + ' / ' + book.author);
  var info = await searchDoubanBook(book.title, book.author);

  if (info.coverUrl) {
    book.cover = largeCoverUrl(info.coverUrl);
  }

  if (info.description) {
    book.description = info.description;
  }

  return new Promise(function (resolve) {
    withLock(function () {
      return new Promise(function (doResolve) {
        writeJSON(BOOKS_FILE, books);
        console.log('Updated book ' + bookId + ': cover=' + book.cover);
        resolve(book);
        doResolve();
      });
    });
  });
}

async function autoFetchMissingInfo() {
  var fetchedFlag = path.join(DATA_DIR, '.covers-fetched');
  if (fs.existsSync(fetchedFlag)) {
    console.log('Covers already fetched, skipping auto-fetch');
    return;
  }

  var books = readJSON(BOOKS_FILE);
  for (var i = 0; i < books.length; i++) {
    var book = books[i];
    try {
      console.log('Auto-fetching cover for book ' + book.id + ': ' + book.title);
      await fetchAndSaveBookInfo(book.id);
      await new Promise(function (r) { return setTimeout(r, 1500); });
    } catch (e) {
      console.error('Auto-fetch failed for book ' + book.id + ':', e.message);
    }
  }

  fs.writeFileSync(fetchedFlag, new Date().toISOString());
  console.log('Auto-fetch complete');
}

// ----- auth middleware -----

function authenticate(req, res, next) {
  var authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  var token = authHeader.split(' ')[1];
  var users = readJSON(USERS_FILE);
  var user = users.find(function (u) { return u.token === token; });
  if (!user) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.currentUser = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }
  next();
}

// ----- middleware -----

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----- routes -----

// GET /api/books — all books with vote counts
app.get('/api/books', function (req, res) {
  try {
    var books = readJSON(BOOKS_FILE);
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: '获取图书数据失败' });
  }
});

// GET /api/covers/:bookId — proxy cover image from Douban CDN
app.get('/api/covers/:bookId', function (req, res) {
  var bookId = parseInt(req.params.bookId, 10);
  var books = readJSON(BOOKS_FILE);
  var book = books.find(function (b) { return b.id === bookId; });

  if (!book || !book.cover) {
    return res.status(404).end();
  }

  fetch(book.cover, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://book.douban.com/'
    }
  }).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    res.set('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    return resp.arrayBuffer();
  }).then(function (buf) {
    res.send(Buffer.from(buf));
  }).catch(function (err) {
    console.error('Cover proxy error for book ' + bookId + ':', err.message);
    res.status(502).end();
  });
});

// POST /api/register
app.post('/api/register', function (req, res) {
  var username = (req.body.username || '').trim();
  var password = (req.body.password || '').trim();
  var email = (req.body.email || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (!email) {
    return res.status(400).json({ error: '请输入邮箱' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需在 2-20 个字符之间' });
  }
  if (!/^\d{6}$/.test(password)) {
    return res.status(400).json({ error: '密码必须为 6 位数字' });
  }

  var users = readJSON(USERS_FILE);
  if (users.some(function (u) { return u.username === username; })) {
    return res.status(400).json({ error: '用户名已被注册' });
  }
  if (users.some(function (u) { return u.email === email; })) {
    return res.status(400).json({ error: '该邮箱已被注册' });
  }

  var isFirstUser = users.length === 0;
  var salt = generateSalt();
  var user = {
    id: Date.now(),
    username: username,
    email: email,
    password: hashPassword(password, salt),
    salt: salt,
    token: generateToken(),
    role: isFirstUser ? 'admin' : 'user'
  };

  users.push(user);
  writeJSON(USERS_FILE, users);

  res.status(201).json({
    id: user.id,
    username: user.username,
    email: user.email,
    token: user.token,
    role: user.role
  });
});

// POST /api/login
app.post('/api/login', function (req, res) {
  var username = (req.body.username || '').trim();
  var password = (req.body.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  var users = readJSON(USERS_FILE);
  var user = users.find(function (u) { return u.username === username; });
  if (!user) {
    return res.status(400).json({ error: '用户名不存在' });
  }

  if (hashPassword(password, user.salt) !== user.password) {
    return res.status(400).json({ error: '密码错误' });
  }

  user.token = generateToken();
  writeJSON(USERS_FILE, users);

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    token: user.token,
    role: user.role
  });
});

// POST /api/forgot-password
app.post('/api/forgot-password', function (req, res) {
  var email = (req.body.email || '').trim();

  if (!email) {
    return res.status(400).json({ error: '请输入邮箱地址' });
  }

  var users = readJSON(USERS_FILE);
  var user = users.find(function (u) { return u.email === email; });
  if (!user) {
    return res.json({ message: '如果该邮箱已注册，重置邮件已发送，请检查邮箱' });
  }

  var resetTokens = readJSON(RESET_TOKENS_FILE);
  resetTokens = resetTokens.filter(function (t) { return t.email !== email; });

  var token = crypto.randomBytes(32).toString('hex');
  var expiresAt = Date.now() + 30 * 60 * 1000;

  resetTokens.push({ email: email, token: token, expiresAt: expiresAt });
  writeJSON(RESET_TOKENS_FILE, resetTokens);

  sendResetEmail(email, user.username, token).then(function (sent) {
    if (sent) {
      res.json({
        message: '重置令牌已发送至邮箱 ' + email + '，请查收邮件'
      });
    } else {
      res.json({
        message: '邮件未配置，请复制下方令牌并设置新密码',
        resetToken: token,
        username: user.username,
        expiresIn: '30 分钟'
      });
    }
  });
});

// POST /api/reset-password
app.post('/api/reset-password', function (req, res) {
  var token = (req.body.token || '').trim();
  var newPassword = (req.body.newPassword || '').trim();

  if (!token || !newPassword) {
    return res.status(400).json({ error: '缺少参数' });
  }
  if (!/^\d{6}$/.test(newPassword)) {
    return res.status(400).json({ error: '密码必须为 6 位数字' });
  }

  var resetTokens = readJSON(RESET_TOKENS_FILE);
  var entry = resetTokens.find(function (t) { return t.token === token; });

  if (!entry) {
    return res.status(400).json({ error: '无效的重置链接' });
  }

  if (Date.now() > entry.expiresAt) {
    resetTokens = resetTokens.filter(function (t) { return t.token !== token; });
    writeJSON(RESET_TOKENS_FILE, resetTokens);
    return res.status(400).json({ error: '重置链接已过期，请重新申请' });
  }

  var users = readJSON(USERS_FILE);
  var user = users.find(function (u) { return u.email === entry.email; });
  if (!user) {
    return res.status(400).json({ error: '用户不存在' });
  }

  user.salt = generateSalt();
  user.password = hashPassword(newPassword, user.salt);
  user.token = generateToken();
  writeJSON(USERS_FILE, users);

  // Remove used token
  resetTokens = resetTokens.filter(function (t) { return t.token !== token; });
  writeJSON(RESET_TOKENS_FILE, resetTokens);

  console.log('密码已重置: ' + user.username + ' (' + user.email + ')');

  res.json({
    message: '密码重置成功，请使用新密码登录',
    username: user.username,
    token: user.token,
    role: user.role
  });
});

// GET /api/user/stats — current user's vote stats
app.get('/api/user/stats', authenticate, function (req, res) {
  var votes = readJSON(VOTES_FILE);
  var userVotes = votes.filter(function (v) { return v.userId === req.currentUser.id; });
  res.json({
    votesUsed: userVotes.length,
    votesRemaining: MAX_VOTES - userVotes.length,
    votedBookIds: userVotes.map(function (v) { return v.bookId; })
  });
});

// POST /api/vote/:id — vote for a book
app.post('/api/vote/:id', authenticate, function (req, res) {
  var bookId = parseInt(req.params.id, 10);
  if (isNaN(bookId)) {
    return res.status(400).json({ error: '无效的图书ID' });
  }

  withLock(function () {
    return new Promise(function (resolve) {
      try {
        var users = readJSON(USERS_FILE);
        var user = users.find(function (u) { return u.id === req.currentUser.id; });

        var votes = readJSON(VOTES_FILE);
        var userVoteCount = votes.filter(function (v) { return v.userId === user.id; }).length;

        if (userVoteCount >= MAX_VOTES) {
          res.status(400).json({ error: '您的 ' + MAX_VOTES + ' 张票已用完，无法继续投票' });
          return resolve();
        }

        var books = readJSON(BOOKS_FILE);
        var book = books.find(function (b) { return b.id === bookId; });
        if (!book) {
          res.status(404).json({ error: '图书不存在' });
          return resolve();
        }

        book.votes += 1;
        votes.push({ userId: user.id, bookId: bookId, timestamp: new Date().toISOString() });

        writeJSON(BOOKS_FILE, books);
        writeJSON(VOTES_FILE, votes);

        var newCount = MAX_VOTES - userVoteCount - 1;
        res.json({
          book: book,
          votesRemaining: newCount
        });
        resolve();
      } catch (err) {
        console.error('Vote error:', err);
        res.status(500).json({ error: '投票失败，请稍后重试' });
        resolve();
      }
    });
  });
});

// POST /api/books/fetch-info — search book by title + author (admin only)
app.post('/api/books/fetch-info', authenticate, requireAdmin, function (req, res) {
  var title = (req.body.title || '').trim();
  var author = (req.body.author || '').trim();

  if (!title) {
    return res.status(400).json({ error: '请输入书名' });
  }

  searchDoubanBook(title, author)
    .then(function (info) {
      res.json({
        title: title,
        author: author,
        coverUrl: info.coverUrl ? largeCoverUrl(info.coverUrl) : null,
        description: info.description,
        doubanUrl: info.doubanUrl
      });
    })
    .catch(function (err) {
      console.error('Fetch book info error:', err.message);
      res.status(500).json({ error: '抓取失败: ' + err.message });
    });
});

// POST /api/books/:id/fetch-info — refresh existing book (admin only)
app.post('/api/books/:id/fetch-info', authenticate, requireAdmin, function (req, res) {
  var bookId = parseInt(req.params.id, 10);
  if (isNaN(bookId)) {
    return res.status(400).json({ error: '无效的图书ID' });
  }

  fetchAndSaveBookInfo(bookId)
    .then(function (book) {
      res.json(book);
    })
    .catch(function (err) {
      console.error('Fetch book info error:', err.message);
      res.status(500).json({ error: '抓取失败: ' + err.message });
    });
});

// POST /api/books — add new book with auto-fetch from Douban (admin only)
app.post('/api/books', authenticate, requireAdmin, function (req, res) {
  var title = (req.body.title || '').trim();
  var author = (req.body.author || '').trim();

  if (!title) {
    return res.status(400).json({ error: '请输入书名' });
  }

  searchDoubanBook(title, author)
    .then(function (info) {
      return withLock(function () {
        return new Promise(function (resolve) {
          var books = readJSON(BOOKS_FILE);
          var maxId = books.reduce(function (m, b) { return Math.max(m, b.id); }, 0);
          var newBook = {
            id: maxId + 1,
            title: title,
            author: author || '未知',
            cover: info.coverUrl ? largeCoverUrl(info.coverUrl) : '',
            votes: 0,
            description: info.description || ''
          };

          books.push(newBook);
          writeJSON(BOOKS_FILE, books);
          console.log('Added book: ' + newBook.title + ' (id=' + newBook.id + ', cover=' + newBook.cover + ')');
          resolve(newBook);
        });
      });
    })
    .then(function (book) {
      res.status(201).json(book);
    })
    .catch(function (err) {
      console.error('Add book error:', err.message);
      res.status(500).json({ error: '添加图书失败: ' + err.message });
    });
});

// PUT /api/books/:id — edit book (admin only)
app.put('/api/books/:id', authenticate, requireAdmin, function (req, res) {
  var bookId = parseInt(req.params.id, 10);
  if (isNaN(bookId)) {
    return res.status(400).json({ error: '无效的图书ID' });
  }

  withLock(function () {
    return new Promise(function (resolve) {
      var books = readJSON(BOOKS_FILE);
      var book = books.find(function (b) { return b.id === bookId; });
      if (!book) {
        res.status(404).json({ error: '图书不存在' });
        return resolve();
      }

      var fields = ['title', 'author', 'cover', 'description'];
      fields.forEach(function (f) {
        if (req.body[f] !== undefined && req.body[f] !== null && req.body[f].trim() !== '') {
          book[f] = req.body[f].trim();
        }
      });

      writeJSON(BOOKS_FILE, books);
      console.log('Updated book ' + bookId + ': ' + book.title);
      res.json(book);
      resolve();
    });
  });
});

// DELETE /api/books/:id — delete book and associated votes (admin only)
app.delete('/api/books/:id', authenticate, requireAdmin, function (req, res) {
  var bookId = parseInt(req.params.id, 10);
  if (isNaN(bookId)) {
    return res.status(400).json({ error: '无效的图书ID' });
  }

  withLock(function () {
    return new Promise(function (resolve) {
      var books = readJSON(BOOKS_FILE);
      var idx = books.findIndex(function (b) { return b.id === bookId; });
      if (idx === -1) {
        res.status(404).json({ error: '图书不存在' });
        return resolve();
      }

      var removed = books.splice(idx, 1)[0];
      writeJSON(BOOKS_FILE, books);

      // Also remove associated votes
      var votes = readJSON(VOTES_FILE);
      votes = votes.filter(function (v) { return v.bookId !== bookId; });
      writeJSON(VOTES_FILE, votes);

      console.log('Deleted book ' + bookId + ': ' + removed.title);
      res.json({ message: '已删除《' + removed.title + '》' });
      resolve();
    });
  });
});

// POST /api/reset-votes — reset all votes (admin only)
app.post('/api/reset-votes', authenticate, requireAdmin, function (req, res) {
  var archive = req.body && req.body.archive === true;

  withLock(function () {
    return new Promise(function (resolve) {
      var books = readJSON(BOOKS_FILE);
      books.forEach(function (b) { b.votes = 0; });
      writeJSON(BOOKS_FILE, books);

      var votes = readJSON(VOTES_FILE);
      var count = votes.length;

      if (archive && count > 0) {
        var history = [];
        if (fs.existsSync(VOTES_HISTORY_FILE)) {
          history = JSON.parse(fs.readFileSync(VOTES_HISTORY_FILE, 'utf-8'));
        }
        history.push({
          archivedAt: new Date().toISOString(),
          records: votes
        });
        writeJSON(VOTES_HISTORY_FILE, history);
        console.log('Archived ' + count + ' vote records');
      }

      writeJSON(VOTES_FILE, []);
      console.log('Votes reset. ' + books.length + ' books reset, ' + count + ' votes cleared.');
      res.json({
        message: '已重置所有投票',
        booksReset: books.length,
        votesCleared: count
      });
      resolve();
    });
  });
});

// ----- start -----

initData();
app.listen(PORT, function () {
  console.log('Server running at http://localhost:' + PORT);
  autoFetchMissingInfo().then(function () {
    console.log('Auto-fetch complete');
  });
});
