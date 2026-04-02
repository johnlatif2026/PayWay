require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json()); // استقبال JSON
app.use(express.static(path.join(__dirname)));

// إنشاء مجلد uploads لو مش موجود
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// إعداد Multer لتخزين الملفات على القرص
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `screenshot-${timestamp}${ext}`);
  }
});
const upload = multer({ storage });

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
    const { fromType, toType, fromNumber, fromName, toNumber, toName, amount } = req.body;
    const profit = 15;
    const totalAmount = parseFloat(amount) + profit;

    let screenshotPath = null;
    if (req.file) {
      screenshotPath = path.join('uploads', req.file.filename);
    }

    const transfer = {
      from: { type: fromType, number: fromNumber, name: fromName, screenshot: screenshotPath },
      to: { type: toType, number: toNumber, name: toName },
      amount: parseFloat(amount),
      profit,
      totalAmount,
      date: new Date()
    };
    transfers.push(transfer);

    // إرسال على Telegram
    let textMsg = `طلب تحويل جديد:\nمن: ${fromType} (${fromNumber})\nإلى: ${toType} (${toNumber})\nالمبلغ: ${amount}\nالعمولة: ${profit}\nالإجمالي: ${totalAmount}`;

    if (req.file) {
      // إرسال الملف كصورة من السيرفر
      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        photo: `https://paywayy.vercel.app/${screenshotPath}`, // ضع رابط السيرفر الخاص بك هنا
        caption: textMsg
      });
    } else {
      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: textMsg
      });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
