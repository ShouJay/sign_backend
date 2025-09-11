// server.js (full version, 4-digit event code)
// ================== 基本設定 ==================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');          // 使用 bcryptjs，Windows 免編譯
const jwt = require('jsonwebtoken');
const multer = require('multer');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const DB_FILE = path.join(__dirname, 'data.db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(__dirname));

// ================== 資料庫初始化 ==================
const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  // users
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // images
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT,
      mime TEXT,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  // events（含 A/B 簽名區與畫布尺寸）
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT,
      stage_width INTEGER DEFAULT 1000,
      stage_height INTEGER DEFAULT 1000,
      a_x INTEGER DEFAULT 150,
      a_y INTEGER DEFAULT 800,
      a_w INTEGER DEFAULT 300,
      a_h INTEGER DEFAULT 150,
      b_x INTEGER DEFAULT 550,
      b_y INTEGER DEFAULT 800,
      b_w INTEGER DEFAULT 300,
      b_h INTEGER DEFAULT 150
    )
  `);
  // 輕量 migration（若欄位已存在會忽略）
  db.run(`ALTER TABLE users ADD COLUMN reset_code TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN reset_expires INTEGER`, () => {});
  db.run(`ALTER TABLE events ADD COLUMN owner_user_id INTEGER`, () => {});
});

const upload = multer({ storage: multer.memoryStorage() });

// ================== 共用：驗證 Token ==================
function authRequired(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.uid, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ================== 共用：產生 4 碼唯一房間號 ==================
function generateEventId(cb) {
  const tryOne = () => {
    const id = Math.floor(1000 + Math.random() * 9000).toString(); // 1000~9999
    db.get(`SELECT id FROM events WHERE id = ?`, [id], (err, row) => {
      if (row) return tryOne(); // 撞到就重試
      cb(id);
    });
  };
  tryOne();
}

// ================== Auth APIs ==================
// 註冊
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const hash = await bcrypt.hash(password, 12);
    db.run(
      `INSERT INTO users(email, password_hash) VALUES(?,?)`,
      [email.toLowerCase(), hash],
      function (err) {
        if (err) {
          if (String(err).includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
          return res.status(500).json({ error: 'DB error' });
        }
        return res.json({ success: true, userId: this.lastID });
      }
    );
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// 登入
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  db.get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()], async (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uid: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token });
  });
});

// 忘記密碼：產生 6 碼重設碼（這裡直接回傳，不寄信）
app.post('/api/forgot', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  db.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.json({ success: true }); // 不暴露是否存在
    const code = (Math.floor(100000 + Math.random() * 900000)).toString(); // 6 碼
    const expires = Date.now() + 15 * 60 * 1000; // 15 分鐘
    db.run(`UPDATE users SET reset_code=?, reset_expires=? WHERE id=?`, [code, expires, row.id], (e2) => {
      if (e2) return res.status(500).json({ error: 'DB error' });
      return res.json({ success: true, code }); // demo 直接回傳
    });
  });
});

// 重設密碼
app.post('/api/reset', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'email, code, newPassword required' });
  db.get(`SELECT id, reset_code, reset_expires FROM users WHERE email = ?`, [email.toLowerCase()], async (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || row.reset_code !== code || !row.reset_expires || Date.now() > row.reset_expires) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    db.run(
      `UPDATE users SET password_hash=?, reset_code=NULL, reset_expires=NULL WHERE id=?`,
      [hash, row.id],
      (e2) => {
        if (e2) return res.status(500).json({ error: 'DB error' });
        return res.json({ success: true });
      }
    );
  });
});

// ================== Image APIs ==================
const uploadMw = upload.single('image');

// 上傳（multipart 欄位 image，或 JSON {dataUrl}）
app.post('/api/images', authRequired, uploadMw, (req, res) => {
  const byForm = !!req.file;
  const { filename } = req.body || {};
  let blob, mime, name;

  if (byForm) {
    blob = req.file.buffer;
    mime = req.file.mimetype || 'application/octet-stream';
    name = req.file.originalname || 'upload.bin';
  } else {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:'))
      return res.status(400).json({ error: 'image required (multipart field "image" or JSON dataUrl)' });
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'invalid dataUrl' });
    mime = m[1];
    blob = Buffer.from(m[2], 'base64');
    name = filename || `image_${Date.now()}`;
  }

  db.run(
    `INSERT INTO images(user_id, filename, mime, data) VALUES(?,?,?,?)`,
    [req.user.id, name, mime, blob],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      return res.json({ success: true, id: this.lastID, filename: name, mime });
    }
  );
});

// 列出我的圖片（僅中繼資訊 + 下載 URL）
app.get('/api/images', authRequired, (req, res) => {
  db.all(
    `SELECT id, filename, mime, created_at FROM images WHERE user_id = ? ORDER BY id DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      const items = rows.map(r => ({ ...r, url: `/api/images/${r.id}` }));
      return res.json({ success: true, items });
    }
  );
});

// 下載單張圖片
app.get('/api/images/:id', authRequired, (req, res) => {
  db.get(
    `SELECT mime, data FROM images WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', row.mime || 'application/octet-stream');
      return res.end(row.data);
    }
  );
});

// ================== Event (Room) APIs ==================
// 建立房間（綁定到目前帳號；eventId = 4 碼數字）
app.post('/api/events', authRequired, (req, res) => {
  const title = (req.body && req.body.title) || '簽約儀式';
  const stageW = (req.body && +req.body.stageWidth) || 1000;
  const stageH = (req.body && +req.body.stageHeight) || 1000;

  generateEventId((id) => {
    db.run(
      `INSERT INTO events(id,title,stage_width,stage_height,owner_user_id) VALUES(?,?,?,?,?)`,
      [id, title, stageW, stageH, req.user.id],
      function (err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        return res.json({
          eventId: id,
          adminUrl: `/admin.html?eventId=${id}`,
          signerBaseUrl: `/signer.html?eventId=${id}`
        });
      }
    );
  });
});

// 列出我的房間
app.get('/api/events', authRequired, (req, res) => {
  db.all(
    `SELECT id, title, stage_width, stage_height, a_x,a_y,a_w,a_h, b_x,b_y,b_w,b_h
     FROM events WHERE owner_user_id = ? ORDER BY rowid DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      const items = rows.map(r => ({
        id: r.id,
        title: r.title,
        stage: { width: r.stage_width, height: r.stage_height },
        slots: {
          A: { x: r.a_x, y: r.a_y, w: r.a_w, h: r.a_h },
          B: { x: r.b_x, y: r.b_y, w: r.b_w, h: r.b_h }
        },
        adminUrl: `/admin.html?eventId=${r.id}`,
        signerBaseUrl: `/signer.html?eventId=${r.id}`
      }));
      return res.json({ success: true, items });
    }
  );
});

// 相容舊版建立（不綁 owner）
app.post('/api/create-event', (req, res) => {
  const title = (req.body && req.body.title) || '簽約儀式';
  const stageW = (req.body && +req.body.stageWidth) || 1000;
  const stageH = (req.body && +req.body.stageHeight) || 1000;

  generateEventId((id) => {
    db.run(
      `INSERT INTO events(id,title,stage_width,stage_height) VALUES(?,?,?,?)`,
      [id, title, stageW, stageH],
      function (err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        return res.json({
          eventId: id,
          adminUrl: `/admin.html?eventId=${id}`,
          signerBaseUrl: `/signer.html?eventId=${id}`
        });
      }
    );
  });
});

// 取得單一房間（給 admin/signer 讀取）
app.get('/api/event/:eventId', (req, res) => {
  db.get(`SELECT * FROM events WHERE id = ?`, [req.params.eventId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const ev = {
      id: row.id,
      title: row.title,
      stage: { width: row.stage_width, height: row.stage_height },
      slots: {
        A: { x: row.a_x, y: row.a_y, w: row.a_w, h: row.a_h },
        B: { x: row.b_x, y: row.b_y, w: row.b_w, h: row.b_h }
      }
    };
    return res.json(ev);
  });
});

// 更新 A/B slot 座標/大小
app.post('/api/event/:eventId/slots', (req, res) => {
  const { A, B } = req.body || {};
  if (!A || !B) return res.status(400).json({ error: 'A and B slots required' });
  db.run(
    `UPDATE events SET 
      a_x=?,a_y=?,a_w=?,a_h=?,
      b_x=?,b_y=?,b_w=?,b_h=? 
     WHERE id=?`,
    [A.x, A.y, A.w, A.h, B.x, B.y, B.w, B.h, req.params.eventId],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ error: 'Event not found' });
      io.to(`event:${req.params.eventId}`).emit('slots:update', { A, B });
      return res.json({ success: true });
    }
  );
});

// ================== Socket.IO ==================
io.on('connection', (socket) => {
  socket.on('join:event', ({ eventId, role, slot }) => {
    socket.join(`event:${eventId}`);
    socket.data.role = role;
    socket.data.eventId = eventId;
    socket.data.slot = (slot === 'B' ? 'B' : 'A');
    socket.emit('joined', { ok: true });
  });

  socket.on('stroke', ({ eventId, points, size, color, sourceWidth, sourceHeight }) => {
    io.to(`event:${eventId}`).emit('stroke', {
      points, size, color,
      sourceWidth, sourceHeight,
      senderSlot: socket.data.slot || 'A'
    });
  });

  socket.on('clear', ({ eventId }) => {
    io.to(`event:${eventId}`).emit('clear', { senderSlot: socket.data.slot || 'A' });
  });

  socket.on('bg:update', ({ eventId, bg }) => {
    io.to(`event:${eventId}`).emit('bg:apply', bg);
  });

  socket.on('snapshot', ({ eventId, dataUrl }) => {
    io.to(`event:${eventId}`).emit('snapshot', { dataUrl });
  });
});

// ================== 啟動 ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running: http://0.0.0.0:${PORT}`);
});
