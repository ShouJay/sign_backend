const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 簡單的 in-memory 狀態（重啟就清空；之後可換 DB）
const state = {
  events: new Map(), // eventId -> { id, title, bg: {type:'color'|'image', value, fit:'cover'|'contain'} }
};

// 產生 event，回傳大螢幕用的連結 與 簽名端的 base 連結
app.post('/api/create-event', (req, res) => {
  const id = crypto.randomBytes(6).toString('hex');
  const title = (req.body && req.body.title) || '簽約儀式';
  state.events.set(id, {
    id,
    title,
    bg: { type: 'color', value: '#ffffff', fit: 'cover' }
  });

  res.json({
    eventId: id,
    adminUrl: `/admin.html?eventId=${id}`,
    signerBaseUrl: `/signer.html?eventId=${id}`
  });
});

// 提供目前 event 設定（背景等）
app.get('/api/event/:eventId', (req, res) => {
  const ev = state.events.get(req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(ev);
});

// Socket.IO
io.on('connection', (socket) => {
  // 加入房間
  socket.on('join:event', ({ eventId, role }) => {
    socket.join(`event:${eventId}`);
    socket.data.role = role;
    socket.data.eventId = eventId;
  });

  // 簽名端傳筆畫（points: [[x,y],...], size, color）
  socket.on('stroke', ({ eventId, points, size, color }) => {
    socket.to(`event:${eventId}`).emit('stroke', { points, size, color });
  });

  // 清除畫面
  socket.on('clear', ({ eventId }) => {
    io.to(`event:${eventId}`).emit('clear');
  });

  // 後台變更背景
  socket.on('bg:update', ({ eventId, bg }) => {
    const ev = state.events.get(eventId);
    if (ev) ev.bg = bg;
    io.to(`event:${eventId}`).emit('bg:apply', bg);
  });

  // Ping 畫面快照（如簽名端送最終圖片，可擴充）
  socket.on('snapshot', ({ eventId, dataUrl }) => {
    socket.to(`event:${eventId}`).emit('snapshot', { dataUrl });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running: http://0.0.0.0:${PORT}`);
});