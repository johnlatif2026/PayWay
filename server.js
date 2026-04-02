require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json()); // استقبال JSON
app.use(express.urlencoded({ extended: true })); // لدعم form-data بدون ملفات
app.use(express.static(path.join(__dirname)));

const upload = multer({ storage: multer.memoryStorage() });

let transfers = [];

// Middleware JWT
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } else res.status(401).json({ message: 'بيانات الدخول خاطئة' });
});

// Transfer
app.post('/api/transfer', upload.single('screenshot'), async (req, res) => {
  try {
    const { fromType, fromNumber, fromName, toType, toNumber, toName, amount } = req.body;
    const profit = 15;
    const totalAmount = parseFloat(amount) + profit;

    let screenshotBase64 = null;
    if (req.file && req.file.buffer) {
      screenshotBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const transfer = {
      from: { type: fromType, number: fromNumber, name: fromName, screenshot: screenshotBase64 },
      to: { type: toType, number: toNumber, name: toName },
      amount: parseFloat(amount),
      profit,
      totalAmount,
      date: new Date()
    };
    transfers.push(transfer);

    // إرسال على Telegram
    const textMsg = `طلب تحويل جديد:\nمن: ${fromType} (${fromNumber})\nإلى: ${toType} (${toNumber})\nالمبلغ: ${amount}\nالعمولة: ${profit}\nالإجمالي: ${totalAmount}`;

    try {
      if (screenshotBase64) {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`, {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          photo: screenshotBase64,
          caption: textMsg
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: textMsg
        });
      }
    } catch (telegramErr) {
      console.error('Telegram Error:', telegramErr.message);
    }

    res.json({ message: 'تم تسجيل التحويل', totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل التحويل' });
  }
});

// Dashboard
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const totalProfit = transfers.reduce((sum, t) => sum + t.profit, 0);
  res.json({ transfers, totalProfit });
});

// Delete transfer
app.delete('/api/transfer/:index', authenticateToken, (req, res) => {
  const idx = parseInt(req.params.index);
  if (idx >= 0 && idx < transfers.length) {
    transfers.splice(idx, 1);
    res.json({ message: 'تم حذف التحويل' });
  } else res.status(404).json({ message: 'التحويل غير موجود' });
});

// صفحات
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// Serverless note: Vercel يستخدم PORT تلقائيًا
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
