const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'cafe.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database error:', err);
  else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Service requests table
    db.run(`CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number INTEGER NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Google reviews table
    db.run(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rating INTEGER NOT NULL,
      comment TEXT,
      table_number INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // QR sessions table
    db.run(`CREATE TABLE IF NOT EXISTS qr_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number INTEGER NOT NULL UNIQUE,
      session_code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Database initialized successfully');
  });
}

// ===== CUSTOMER ENDPOINTS =====

// Get menu
app.get('/api/menu', (req, res) => {
  const menu = {
    cafe_name: 'The Blue Cup Cafe',
    categories: {
      'Hot Drinks': [
        { name: 'Cappuccino', price: '£3.50' },
        { name: 'Latte', price: '£3.80' },
        { name: 'Espresso', price: '£2.50' },
        { name: 'Americano', price: '£2.80' }
      ],
      'Cold Drinks': [
        { name: 'Iced Coffee', price: '£3.50' },
        { name: 'Cold Brew', price: '£3.20' },
        { name: 'Iced Tea', price: '£2.50' }
      ],
      'Pastries': [
        { name: 'Croissant', price: '£2.20' },
        { name: 'Muffin', price: '£2.50' },
        { name: 'Bagel', price: '£2.00' },
        { name: 'Chocolate Cake', price: '£3.50' }
      ]
    }
  };
  res.json(menu);
});

// Submit service request
app.post('/api/service-request', (req, res) => {
  const { table_number, request_type } = req.body;
  db.run(
    'INSERT INTO service_requests (table_number, request_type) VALUES (?, ?)',
    [table_number, request_type],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to submit request' });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Submit review
app.post('/api/review', (req, res) => {
  const { rating, comment, table_number } = req.body;
  db.run(
    'INSERT INTO reviews (rating, comment, table_number) VALUES (?, ?, ?)',
    [rating, comment, table_number],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to submit review' });
      res.json({ success: true });
    }
  );
});

// ===== WAITER ENDPOINTS =====

// Get pending service requests
app.get('/api/pending-requests', (req, res) => {
  db.all(
    `SELECT id, table_number, request_type, created_at 
     FROM service_requests 
     WHERE status = 'pending' 
     ORDER BY created_at DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch requests' });
      res.json(rows || []);
    }
  );
});

// Mark request as complete
app.post('/api/complete-request/:id', (req, res) => {
  db.run(
    'UPDATE service_requests SET status = ? WHERE id = ?',
    ['completed', req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to complete request' });
      res.json({ success: true });
    }
  );
});

// Get recent reviews
app.get('/api/reviews', (req, res) => {
  db.all(
    `SELECT rating, comment, table_number, created_at 
     FROM reviews 
     ORDER BY created_at DESC 
     LIMIT 50`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch reviews' });
      res.json(rows || []);
    }
  );
});

// Get dashboard stats
app.get('/api/stats', (req, res) => {
  db.all(
    `SELECT 
       (SELECT COUNT(*) FROM service_requests WHERE status = 'pending') as pending,
       (SELECT COUNT(*) FROM service_requests WHERE status = 'completed' AND DATE(created_at) = DATE('now')) as completed_today,
       (SELECT AVG(rating) FROM reviews) as avg_rating`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch stats' });
      const stats = rows[0] || { pending: 0, completed_today: 0, avg_rating: 0 };
      res.json(stats);
    }
  );
});

// Upload menu PDF URL
app.post('/api/upload-menu', (req, res) => {
  const { pdf_url } = req.body;
  db.run(
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
    () => {
      db.run(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('menu_pdf_url', ?)`,
        [pdf_url],
        (err) => {
          if (err) return res.status(500).json({ error: 'Failed to save URL' });
          res.json({ success: true });
        }
      );
    }
  );
});

// Get menu PDF URL
app.get('/api/menu-pdf-url', (req, res) => {
  db.get(
    `SELECT value FROM settings WHERE key = 'menu_pdf_url'`,
    (err, row) => {
      if (err || !row) return res.json({ url: null });
      res.json({ url: row.value });
    }
  );
});


// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`\nServer running on port ${PORT}`);
  console.log(`Customer App: http://localhost:3001`);
  console.log(`API: http://localhost:${PORT}/api\n`);
});