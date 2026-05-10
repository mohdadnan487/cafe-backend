const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'foodquarter_secret_2024';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(path.join(__dirname, 'cafe.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    cuisine TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    category TEXT,
    is_available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    table_number INTEGER NOT NULL,
    customer_name TEXT,
    status TEXT DEFAULT 'new',
    total REAL NOT NULL,
    payment_status TEXT DEFAULT 'paid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS waiter_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number INTEGER NOT NULL,
    vendor_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

// ===== AUTH MIDDLEWARE =====
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.vendor = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ===== VENDOR AUTH =====
app.post('/api/vendor/register', async (req, res) => {
  const { name, email, password, description, cuisine } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const hashed = await bcrypt.hash(password, 10);
  db.run(
    'INSERT INTO vendors (name, email, password, description, cuisine) VALUES (?, ?, ?, ?, ?)',
    [name, email, hashed, description, cuisine],
    function(err) {
      if (err) return res.status(400).json({ error: 'Email already exists' });
      const token = jwt.sign({ id: this.lastID, email, name }, JWT_SECRET);
      res.json({ token, vendor: { id: this.lastID, name, email, description, cuisine } });
    }
  );
});

app.post('/api/vendor/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM vendors WHERE email = ?', [email], async (err, vendor) => {
    if (!vendor) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, vendor.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: vendor.id, email: vendor.email, name: vendor.name }, JWT_SECRET);
    res.json({ token, vendor: { id: vendor.id, name: vendor.name, email: vendor.email, description: vendor.description, cuisine: vendor.cuisine, logo_url: vendor.logo_url } });
  });
});

app.get('/api/vendor/me', authMiddleware, (req, res) => {
  db.get('SELECT id, name, email, description, cuisine, logo_url FROM vendors WHERE id = ?', [req.vendor.id], (err, vendor) => {
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  });
});

// ===== MENU MANAGEMENT =====
app.get('/api/vendor/menu', authMiddleware, (req, res) => {
  db.all('SELECT * FROM menu_items WHERE vendor_id = ? ORDER BY category, name', [req.vendor.id], (err, items) => {
    res.json(items || []);
  });
});

app.post('/api/vendor/menu', authMiddleware, upload.single('image'), async (req, res) => {
  const { name, description, price, category } = req.body;
  let image_url = null;
  if (req.file) {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder: 'food-quarter' }, (err, result) => err ? reject(err) : resolve(result)).end(req.file.buffer);
    });
    image_url = result.secure_url;
  }
  db.run(
    'INSERT INTO menu_items (vendor_id, name, description, price, image_url, category) VALUES (?, ?, ?, ?, ?, ?)',
    [req.vendor.id, name, description, price, image_url, category],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to add item' });
      res.json({ id: this.lastID, name, description, price, image_url, category, is_available: 1 });
    }
  );
});

app.put('/api/vendor/menu/:id', authMiddleware, upload.single('image'), async (req, res) => {
  const { name, description, price, category, is_available } = req.body;
  let image_url = req.body.image_url;
  if (req.file) {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder: 'food-quarter' }, (err, result) => err ? reject(err) : resolve(result)).end(req.file.buffer);
    });
    image_url = result.secure_url;
  }
  db.run(
    'UPDATE menu_items SET name=?, description=?, price=?, category=?, image_url=?, is_available=? WHERE id=? AND vendor_id=?',
    [name, description, price, category, image_url, is_available, req.params.id, req.vendor.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update item' });
      res.json({ success: true });
    }
  );
});

app.delete('/api/vendor/menu/:id', authMiddleware, (req, res) => {
  db.run('DELETE FROM menu_items WHERE id=? AND vendor_id=?', [req.params.id, req.vendor.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete item' });
    res.json({ success: true });
  });
});

// ===== ORDER MANAGEMENT =====
app.get('/api/vendor/orders', authMiddleware, (req, res) => {
  db.all(
    `SELECT o.*, GROUP_CONCAT(oi.quantity || 'x ' || oi.name) as items_summary
     FROM orders o
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.vendor_id = ?
     GROUP BY o.id
     ORDER BY o.created_at DESC LIMIT 50`,
    [req.vendor.id],
    (err, orders) => res.json(orders || [])
  );
});

app.put('/api/vendor/orders/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  db.run('UPDATE orders SET status=? WHERE id=? AND vendor_id=?', [status, req.params.id, req.vendor.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update order' });
    res.json({ success: true });
  });
});

// ===== CUSTOMER ENDPOINTS =====
app.get('/api/vendors', (req, res) => {
  db.all('SELECT id, name, description, cuisine, logo_url FROM vendors WHERE is_active=1', (err, vendors) => {
    const result = (vendors || []).map(v => ({...v, is_open: true, wait_time: 15}));
    res.json(result);
  });
});

app.get('/api/vendors/:id/menu', (req, res) => {
  db.all('SELECT * FROM menu_items WHERE vendor_id=? AND is_available=1 ORDER BY category, name', [req.params.id], (err, items) => {
    res.json(items || []);
  });
});

app.post('/api/orders', (req, res) => {
  const { vendor_id, table_number, items, total, customer_name } = req.body;
  db.run(
    'INSERT INTO orders (vendor_id, table_number, customer_name, total) VALUES (?, ?, ?, ?)',
    [vendor_id, table_number, customer_name, total],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to place order' });
      const orderId = this.lastID;
      const stmt = db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
      items.forEach(item => stmt.run([orderId, item.id, item.name, item.price, item.quantity]));
      stmt.finalize();
      res.json({ success: true, order_id: orderId });
    }
  );
});

app.post('/api/waiter-request', (req, res) => {
  const { table_number, vendor_id } = req.body;
  db.run('INSERT INTO waiter_requests (table_number, vendor_id) VALUES (?, ?)', [table_number, vendor_id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to submit request' });
    res.json({ success: true });
  });
});

app.get('/api/vendor/waiter-requests', authMiddleware, (req, res) => {
  db.all(
    `SELECT * FROM waiter_requests WHERE (vendor_id=? OR vendor_id IS NULL) AND status='pending' ORDER BY created_at DESC`,
    [req.vendor.id],
    (err, rows) => res.json(rows || [])
  );
});

app.put('/api/vendor/waiter-requests/:id', authMiddleware, (req, res) => {
  db.run('UPDATE waiter_requests SET status="done" WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: 'Failed' });
    res.json({ success: true });
  });
});

app.get('/api/vendor/stats', authMiddleware, (req, res) => {
  db.get(
    `SELECT 
      COUNT(CASE WHEN status='new' THEN 1 END) as new_orders,
      COUNT(CASE WHEN status='preparing' THEN 1 END) as preparing,
      COUNT(CASE WHEN DATE(created_at)=DATE('now') THEN 1 END) as today_orders,
      SUM(CASE WHEN DATE(created_at)=DATE('now') THEN total ELSE 0 END) as today_revenue
     FROM orders WHERE vendor_id=?`,
    [req.vendor.id],
    (err, stats) => res.json(stats || {})
  );
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const { WebSocketServer } = require('ws');
const http = require('http');
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const groupOrders = {};

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const groupId = url.searchParams.get('groupId');
  const userName = url.searchParams.get('name') || 'Guest';

  if (!groupId) return ws.close();

  if (!groupOrders[groupId]) groupOrders[groupId] = { cart: [], members: [] };
  
  groupOrders[groupId].members.push({ ws, name: userName });

  ws.send(JSON.stringify({ type: 'init', cart: groupOrders[groupId].cart, members: groupOrders[groupId].members.map(m => m.name) }));

  const broadcast = (groupId, data) => {
    groupOrders[groupId]?.members.forEach(m => {
      if (m.ws.readyState === 1) m.ws.send(JSON.stringify(data));
    });
  };

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'update_cart') {
        groupOrders[groupId].cart = data.cart;
        broadcast(groupId, { type: 'cart_updated', cart: data.cart, updatedBy: userName });
      }
    } catch (err) {}
  });

  ws.on('close', () => {
    if (groupOrders[groupId]) {
      groupOrders[groupId].members = groupOrders[groupId].members.filter(m => m.ws !== ws);
      if (groupOrders[groupId].members.length === 0) delete groupOrders[groupId];
      else broadcast(groupId, { type: 'member_left', members: groupOrders[groupId].members.map(m => m.name) });
    }
  });

  broadcast(groupId, { type: 'member_joined', name: userName, members: groupOrders[groupId].members.map(m => m.name) });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));