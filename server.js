// server.js - 穩定版：歷史清單、欄位調整、單格清除、6位數字帳號、管理者清空全部
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const DB_FILE = path.join(__dirname, 'data.db');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const ADMIN_INITIAL_PIN = process.env.ADMIN_INITIAL_PIN || '000000';
const PIN_RE = /^[0-9]{6}$/;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
// 讓 admin.html / signer.html 直接被讀到（放同資料夾即可）
app.use(express.static(__dirname));

const db = new sqlite3.Database(DB_FILE);

// ---------- DB ----------
function ensureRoleColumn(cb){
  db.all(`PRAGMA table_info(users)`, (e, cols)=>{
    if(e) return cb(e);
    const hasRole = Array.isArray(cols)&&cols.some(c=>c.name==='role');
    if(hasRole) return cb(null);
    db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, err=>{
      if(err && !String(err).includes('duplicate column')) return cb(err);
      cb(null);
    });
  });
}
function seedAdmins(){
  if(!ADMIN_EMAILS.length) return;
  const hash = bcrypt.hashSync(ADMIN_INITIAL_PIN, 12);
  ADMIN_EMAILS.forEach(email=>{
    db.get(`SELECT id FROM users WHERE lower(email)=?`,[email],(e,row)=>{
      if(row){ db.run(`UPDATE users SET role='admin' WHERE id=?`,[row.id]); }
      else { db.run(`INSERT INTO users(email,password_hash,role) VALUES(?,?,?)`,[email,hash,'admin']); }
    });
  });
}
db.serialize(()=>{
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reset_code TEXT,
    reset_expires INTEGER
  )`, ()=>{
    ensureRoleColumn(err=>{
      if(err){ console.error(err); process.exit(1);}
      db.run(`CREATE TABLE IF NOT EXISTS events(
        id TEXT PRIMARY KEY,
        title TEXT,
        stage_width INTEGER DEFAULT 1000,
        stage_height INTEGER DEFAULT 1000,
        owner_user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS event_slots(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        side TEXT NOT NULL,
        idx INTEGER NOT NULL,
        x INTEGER NOT NULL, y INTEGER NOT NULL,
        w INTEGER NOT NULL, h INTEGER NOT NULL
      )`);
      seedAdmins();
    });
  });
});

// ---------- utils ----------
function authRequired(req,res,next){
  const hdr=req.headers.authorization||''; const token=hdr.startsWith('Bearer ')?hdr.slice(7):'';
  try{ const p=jwt.verify(token, JWT_SECRET); req.user={id:p.uid,email:p.email,role:p.role||'user'}; next(); }
  catch{ return res.status(401).json({error:'Unauthorized'}); }
}
function adminRequired(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'Admin only'}); next(); }
function generateEventId(cb){ const go=()=>{ const id=String(Math.floor(1000+Math.random()*9000)); db.get(`SELECT id FROM events WHERE id=?`,[id],(e,row)=>row?go():cb(id)); }; go(); }
function setSlots(eventId, slots, cb){
  db.serialize(()=>{
    db.run(`DELETE FROM event_slots WHERE event_id=?`,[eventId],()=>{
      const s=db.prepare(`INSERT INTO event_slots(event_id,side,idx,x,y,w,h) VALUES(?,?,?,?,?,?,?)`);
      (slots.A||[]).forEach((v,i)=> s.run([eventId,'A',i,v.x,v.y,v.w,v.h]));
      (slots.B||[]).forEach((v,i)=> s.run([eventId,'B',i,v.x,v.y,v.w,v.h]));
      s.finalize(cb);
    });
  });
}
function getEventWithSlots(eventId, cb){
  db.get(`SELECT * FROM events WHERE id=?`,[eventId],(e,ev)=>{
    if(e||!ev) return cb(e||new Error('not found'));
    db.all(`SELECT * FROM event_slots WHERE event_id=? ORDER BY side, idx`,[eventId],(e2,rows)=>{
      if(e2) return cb(e2);
      const A=rows.filter(r=>r.side==='A').map(m=>({x:m.x,y:m.y,w:m.w,h:m.h}));
      const B=rows.filter(r=>r.side==='B').map(m=>({x:m.x,y:m.y,w:m.w,h:m.h}));
      cb(null,{id:ev.id,title:ev.title,stage:{width:ev.stage_width,height:ev.stage_height},slots:{A,B}});
    });
  });
}
function assertOwner(eventId,userId,cb){
  db.get(`SELECT 1 FROM events WHERE id=? AND owner_user_id=?`,[eventId,userId],(e,row)=>{
    if(e) return cb(e); if(!row) return cb(new Error('forbidden')); cb(null,true);
  });
}

// ---------- auth ----------
app.post('/api/register', async (req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password) return res.status(400).json({error:'email and password required'});
  if(!PIN_RE.test(password)) return res.status(400).json({error:'Password must be 6 digits'});
  const hash=await bcrypt.hash(password,12);
  db.run(`INSERT INTO users(email,password_hash,role) VALUES(?,?,?)`,[email.toLowerCase(),hash,'user'],function(e){
    if(e) return res.status(String(e).includes('UNIQUE')?409:500).json({error:'DB error'}); res.json({success:true,userId:this.lastID});
  });
});
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password) return res.status(400).json({error:'email and password required'});
  db.get(`SELECT * FROM users WHERE email=?`,[email.toLowerCase()], async (e,row)=>{
    if(e||!row) return res.status(401).json({error:'Invalid credentials'});
    const ok=await bcrypt.compare(password,row.password_hash); if(!ok) return res.status(401).json({error:'Invalid credentials'});
    const token=jwt.sign({uid:row.id,email:row.email,role:row.role||'user'},JWT_SECRET,{expiresIn:'7d'});
    res.json({success:true,token});
  });
});
app.get('/api/me', authRequired, (req,res)=> res.json({email:req.user.email, role:req.user.role}));

app.post('/api/forgot',(req,res)=>{
  const {email}=req.body||{}; if(!email) return res.status(400).json({error:'email required'});
  db.get(`SELECT id FROM users WHERE email=?`,[email.toLowerCase()],(e,row)=>{
    if(e) return res.status(500).json({error:'DB error'});
    if(!row) return res.json({success:true});
    const code=String(Math.floor(100000+Math.random()*900000));
    const exp=Date.now()+15*60*1000;
    db.run(`UPDATE users SET reset_code=?, reset_expires=? WHERE id=?`,[code,exp,row.id],()=> res.json({success:true, code}));
  });
});
app.post('/api/reset', async (req,res)=>{
  const {email,code,newPassword}=req.body||{};
  if(!email||!code||!newPassword) return res.status(400).json({error:'email, code, newPassword required'});
  if(!PIN_RE.test(newPassword)) return res.status(400).json({error:'Password must be 6 digits'});
  db.get(`SELECT id,reset_code,reset_expires FROM users WHERE email=?`,[email.toLowerCase()], async (e,row)=>{
    if(e||!row||row.reset_code!==code||!row.reset_expires||Date.now()>row.reset_expires) return res.status(400).json({error:'Invalid or expired code'});
    const hash=await bcrypt.hash(newPassword,12);
    db.run(`UPDATE users SET password_hash=?, reset_code=NULL, reset_expires=NULL WHERE id=?`,[hash,row.id],()=> res.json({success:true}));
  });
});

// ---------- events ----------
app.post('/api/create-event', authRequired, (req,res)=>{
  const title=(req.body&&req.body.title)||'簽約儀式';
  const W=+req.body?.stageWidth||1000, H=+req.body?.stageHeight||1000;

  // 統一底部排版（與前端一致）
  const PAD=16, GAP=12, GAP_ROW=12, BOT=16;
  const rowH = Math.max(120, Math.round(H*0.16));
  const yB = H - BOT - rowH;          // 乙方在底部
  const yA = yB - GAP_ROW - rowH;     // 甲方在乙方上面
  const wHalf = Math.round((W - PAD*2 - GAP)/2);

  generateEventId((id)=>{
    db.run(`INSERT INTO events(id,title,stage_width,stage_height,owner_user_id) VALUES(?,?,?,?,?)`,
      [id,title,W,H,req.user.id], (e)=>{
        if(e) return res.status(500).json({error:'DB error'});
        const A=[{x:PAD, y:yA, w:wHalf, h:rowH}];
        const B=[{x:W-PAD-wHalf, y:yB, w:wHalf, h:rowH}];
        setSlots(id,{A,B},()=> res.json({eventId:id}));
      });
  });
});

// 歷史（自己；管理者可 ?all=1 看全部）
app.get('/api/events', authRequired, (req,res)=>{
  const seeAll = req.user.role==='admin' && String(req.query.all||'')==='1';
  const sql = seeAll ? `SELECT id,title,stage_width,stage_height,created_at FROM events ORDER BY datetime(created_at) DESC`
                     : `SELECT id,title,stage_width,stage_height,created_at FROM events WHERE owner_user_id=? ORDER BY datetime(created_at) DESC`;
  const args = seeAll ? [] : [req.user.id];
  db.all(sql,args,(e,rows)=> e?res.status(500).json({error:'DB error'}):res.json({success:true, items: rows.map(r=>({
    id:r.id,title:r.title||'未命名',createdAt:r.created_at,stage:{width:r.stage_width,height:r.stage_height}
  }))}));
});

// 更新 A/B 欄位（擁有者或管理者）
app.post('/api/event/:eventId/slots', authRequired, (req,res)=>{
  const eventId=req.params.eventId; const {A,B}=req.body||{};
  if(!Array.isArray(A)||!Array.isArray(B)) return res.status(400).json({error:'A and B must be arrays'});
  const proceed=()=> setSlots(eventId,{A,B},(e)=>{ if(e) return res.status(500).json({error:'DB error'}); io.to(`event:${eventId}`).emit('slots:update',{A,B}); res.json({success:true}); });
  if(req.user.role==='admin') return proceed();
  assertOwner(eventId,req.user.id,(err)=> err?res.status(403).json({error:'Forbidden'}):proceed());
});

// 刪單筆
app.delete('/api/event/:eventId', authRequired, (req,res)=>{
  const id=req.params.eventId; const bypass=req.user.role==='admin';
  const del=()=> db.serialize(()=>{
    db.run(`DELETE FROM event_slots WHERE event_id=?`,[id]);
    db.run(`DELETE FROM events WHERE id=?`,[id], function(e){
      if(e) return res.status(500).json({error:'DB error'});
      io.to(`event:${id}`).emit('event:deleted',{eventId:id});
      res.json({success:true,deleted:this.changes});
    });
  });
  if(bypass) return del();
  assertOwner(id, req.user.id, (err)=> err?res.status(403).json({error:'Forbidden'}):del());
});

// 刪自己的全部
app.post('/api/events/clear', authRequired, (req,res)=>{
  db.serialize(()=>{
    db.run(`DELETE FROM event_slots WHERE event_id IN (SELECT id FROM events WHERE owner_user_id=?)`,[req.user.id]);
    db.run(`DELETE FROM events WHERE owner_user_id=?`,[req.user.id], e=> e?res.status(500).json({error:'DB error'}):res.json({success:true}));
  });
});

// 管理者：刪所有人的全部
app.post('/api/admin/events/clear-all', authRequired, adminRequired, (_req,res)=>{
  db.serialize(()=>{
    db.run(`DELETE FROM event_slots`);
    db.run(`DELETE FROM events`, e=> e?res.status(500).json({error:'DB error'}):res.json({success:true}));
  });
});

// 讀單一房間（簽名端/管理端）
app.get('/api/event/:eventId', (req,res)=> getEventWithSlots(req.params.eventId,(e,ev)=> e?res.status(404).json({error:'Event not found'}):res.json(ev)));

// ---------- socket.io：只清本格 ----------
io.on('connection', (socket)=>{
  socket.on('join:event', ({eventId, role, slotSide, slotIndex})=>{
    socket.join(`event:${eventId}`);
    socket.data.eventId=eventId;
    socket.data.side=(slotSide||'A')==='B'?'B':'A';
    socket.data.index=Number.isInteger(slotIndex)?slotIndex:0;
    socket.data.role=role||'signer';
    socket.emit('joined',{ok:true});
  });

  socket.on('stroke', ({eventId, points, size, color, sourceWidth, sourceHeight, slotSide, slotIndex})=>{
    const side=(slotSide||socket.data.side||'A')==='B'?'B':'A';
    const index=Number.isInteger(slotIndex)?slotIndex:(socket.data.index||0);
    io.to(`event:${eventId}`).emit('stroke',{points,size,color,sourceWidth,sourceHeight,senderSide:side,senderIndex:index});
  });

  socket.on('clear', ({eventId, slotSide, slotIndex})=>{
    const side=(slotSide ?? socket.data.side);
    const index=Number.isInteger(slotIndex)?slotIndex:socket.data.index;
    if(!eventId || (side!=='A'&&side!=='B') || !Number.isInteger(index)) return;
    io.to(`event:${eventId}`).emit('clear',{senderSide:side,senderIndex:index});
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT,'0.0.0.0',()=> console.log(`Server http://0.0.0.0:${PORT}`));
