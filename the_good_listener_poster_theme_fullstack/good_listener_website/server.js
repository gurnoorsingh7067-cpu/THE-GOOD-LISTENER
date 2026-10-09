const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'good-listener.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Open Mic Night',
 description TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, event_time TEXT NOT NULL DEFAULT '',
 venue TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL CHECK(capacity > 0),
 status TEXT NOT NULL DEFAULT 'Open', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, registration_code TEXT NOT NULL UNIQUE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 participation TEXT NOT NULL CHECK(participation IN ('Audience','Performer')),
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(event_id,email)
);
`);

const adminUser = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminUser && adminPassword) {
 const existing = db.prepare('SELECT id FROM admins WHERE username=?').get(adminUser);
 if (!existing) db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(adminUser,bcrypt.hashSync(adminPassword,12));
} else {
 console.warn('ADMIN_USERNAME / ADMIN_PASSWORD not set. Admin login will not be initialized.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for inline prototype scripts; configure CSP before production.
app.use(express.json({limit:'30kb'}));
app.use(express.urlencoded({extended:false,limit:'30kb'}));
app.use(session({
 secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-change-this-session-secret'),
 store: new SQLiteStore({db:'sessions.sqlite',dir:__dirname}),
 resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}
}));
app.use('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}));

function adminOnly(req,res,next){if(!req.session.adminId)return res.status(401).json({error:'Please sign in again.'});next()}
function text(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):''}
function eventRow(e){const count=db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(e.id).n;return {...e,registered_count:count}}
function validateEvent(b){const title=text(b.title,120),date=text(b.event_date,10),capacity=Number(b.capacity);if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(capacity)||capacity<1||capacity>10000)throw Error('Enter a title, valid date, and capacity from 1 to 10000.');return {title,category:text(b.category,80)||'Open Mic Night',description:text(b.description,1000),event_date:date,event_time:text(b.event_time,50),venue:text(b.venue,160),capacity}}
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/events',(req,res)=>{const rows=db.prepare("SELECT * FROM events WHERE event_date >= date('now','localtime') AND status != 'Hidden' ORDER BY event_date,event_time").all().map(eventRow);res.json({events:rows})});
app.post('/api/registrations',rateLimit({windowMs:60*60*1000,limit:20,standardHeaders:true,legacyHeaders:false}),(req,res)=>{
 const b=req.body||{};const fullName=text(b.fullName,100),email=text(b.email,150).toLowerCase(),phone=text(b.phone,25),participation=b.participation==='Performer'?'Performer':'Audience',note=text(b.note,500),eventId=Number(b.eventId);
 if(!fullName||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!Number.isInteger(eventId))return res.status(400).json({error:'Enter a valid name and email.'});
 const create=db.transaction(()=>{
  const e=db.prepare('SELECT * FROM events WHERE id=? AND status=?').get(eventId,'Open');if(!e)throw Error('This event is not accepting registrations.');
  const count=db.prepare('SELECT COUNT(*) n FROM registrations WHERE event_id=?').get(eventId).n;if(count>=e.capacity)throw Error('Sorry, this event is full.');
  if(db.prepare('SELECT id FROM registrations WHERE event_id=? AND email=?').get(eventId,email))throw Error('This email is already registered for this event.');
  const code='GL-'+crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO registrations(registration_code,event_id,full_name,email,phone,participation,note) VALUES(?,?,?,?,?,?,?)').run(code,eventId,fullName,email,phone,participation,note);
  return code;
 });
 try{const registrationId=create();res.status(201).json({ok:true,registrationId})}catch(e){res.status(400).json({error:e.message||'Could not register.'})}
});
app.post('/api/admin/login',(req,res)=>{const username=text(req.body?.username,100),password=typeof req.body?.password==='string'?req.body.password:'';const a=db.prepare('SELECT * FROM admins WHERE username=?').get(username);if(!a||!bcrypt.compareSync(password,a.password_hash))return res.status(401).json({error:'Incorrect username or password.'});req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Could not start a session.'});req.session.adminId=a.id;res.json({ok:true})})});
app.get('/api/admin/me',adminOnly,(req,res)=>res.json({ok:true}));
app.post('/api/admin/logout',adminOnly,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/dashboard',adminOnly,(req,res)=>{
 const events=db.prepare('SELECT * FROM events ORDER BY event_date DESC,id DESC').all().map(eventRow);
 const totalRegistrations=db.prepare('SELECT COUNT(*) n FROM registrations').get().n;
 const performers=db.prepare("SELECT COUNT(*) n FROM registrations WHERE participation='Performer'").get().n;
 const registrations=db.prepare(`SELECT r.*,e.title AS event_title FROM registrations r JOIN events e ON e.id=r.event_id ORDER BY r.id DESC LIMIT 100`).all();
 res.json({events,totalRegistrations,performers,registrations});
});
app.post('/api/admin/events',adminOnly,(req,res)=>{try{const e=validateEvent(req.body);const r=db.prepare('INSERT INTO events(title,category,description,event_date,event_time,venue,capacity) VALUES(@title,@category,@description,@event_date,@event_time,@venue,@capacity)').run(e);res.status(201).json({event:eventRow(db.prepare('SELECT * FROM events WHERE id=?').get(r.lastInsertRowid))})}catch(e){res.status(400).json({error:e.message})}});
app.put('/api/admin/events/:id',adminOnly,(req,res)=>{try{const e=validateEvent(req.body),id=Number(req.params.id),existing=db.prepare('SELECT * FROM events WHERE id=?').get(id);if(!existing)return res.status(404).json({error:'Event not found.'});const count=db.prepare('SELECT COUNT(*) n FROM registrations WHERE event_id=?').get(id).n;if(e.capacity<count)return res.status(400).json({error:`Capacity cannot be below the ${count} existing registrations.`});db.prepare('UPDATE events SET title=@title,category=@category,description=@description,event_date=@event_date,event_time=@event_time,venue=@venue,capacity=@capacity WHERE id=@id').run({...e,id});res.json({event:eventRow(db.prepare('SELECT * FROM events WHERE id=?').get(id))})}catch(e){res.status(400).json({error:e.message})}});
app.delete('/api/admin/events/:id',adminOnly,(req,res)=>{const id=Number(req.params.id);const r=db.prepare('DELETE FROM events WHERE id=?').run(id);if(!r.changes)return res.status(404).json({error:'Event not found.'});res.json({ok:true})});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.listen(PORT,()=>console.log(`The Good Listener running at http://localhost:${PORT}`));
