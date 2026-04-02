require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// بيانات نموذجية للتحويلات
let transfers = [];

// Middleware للتحقق من JWT
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// تسجيل الدخول
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } else {
    res.status(401).json({ message: 'بيانات الدخول خاطئة' });
  }
});

// إضافة تحويل
app.post('/api/transfer', (req, res) => {
  const { from, to, amount } = req.body;
  const profit = amount * 0.05; // مثال عمولة 5%
  transfers.push({ from, to, amount, profit, date: new Date() });
  res.json({ message: 'تم تسجيل التحويل', profit });
});

// الحصول على الإحصائيات
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const totalProfit = transfers.reduce((sum, t) => sum + t.profit, 0);
  res.json({ transfers, totalProfit });
});

// صفحات ثابتة
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
