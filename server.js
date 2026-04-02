require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const FormData = require('form-data');
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// تهيئة Firebase من متغير البيئة FIREBASE_CONFIG
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
initializeApp({
  credential: cert(firebaseConfig)
});
const db = getFirestore();

const app = express();
app.use(cors());
app.use(express.json());

// إعداد multer لتخزين الملفات مؤقتًا في الذاكرة
const upload = multer({ storage: multer.memoryStorage() });

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
  } else {
    res.status(401).json({ message: 'بيانات الدخول خاطئة' });
  }
});

// Transfer
app.post('/api/transfer', upload.single('screenshot'), async (req, res) => {
  try {
    const { fromServiceType, toServiceType, fromNumber, fromName, toNumber, toName, amount } = req.body;

    const profit = parseFloat(amount) * 0.02;
    const totalAmount = parseFloat(amount) + profit;

    let screenshotURL = null;

    // رفع الصورة إذا موجودة
    if (req.file) {
      const form = new FormData();
      form.append('image', req.file.buffer.toString('base64'));
      form.append('key', process.env.IMGBB_API_KEY);

      try {
        const response = await axios.post('https://api.imgbb.com/1/upload', form, {
          headers: form.getHeaders()
        });
        screenshotURL = response.data.data.display_url;
      } catch (imgErr) {
        console.error('ImgBB upload failed:', imgErr.message);
      }
    }

    const now = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const dateStr = now.toLocaleString('ar-EG', options);

    // تسجيل التحويل في Firestore
    const transfer = {
      from: { type: fromServiceType, number: fromNumber, name: fromName, screenshot: screenshotURL },
      to: { type: toServiceType, number: toNumber, name: toName },
      amount: parseFloat(amount),
      profit,
      totalAmount,
      date: dateStr
    };

    const docRef = await db.collection('transfers').add(transfer);

    // تحضير رسالة Telegram
    const textMsg = `طلب تحويل جديد:
من: ${fromServiceType} (${fromNumber})
إلى: ${toServiceType} (${toNumber})
اسم المحول: ${fromName}
اسم المستلم: ${toName}
المبلغ: ${amount}
العمولة: ${profit}
الإجمالي: ${totalAmount}
التاريخ: ${dateStr}`;

    // إرسال رسالة Telegram لكن لا نرسل الرد مباشرة هنا
    let telegramError = false;
    try {
      if (screenshotURL) {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`, {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          photo: screenshotURL,
          caption: textMsg
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: textMsg
        });
      }
    } catch (tgErr) {
      console.error('Telegram notification failed:', tgErr.message);
      telegramError = true;
    }

    // إرسال الرد مرة واحدة فقط
    res.json({
      message: telegramError ? 'تم تسجيل التحويل، لكن لم يتم إرسال الإشعار' : 'تم تسجيل التحويل بنجاح',
      totalAmount,
      id: docRef.id
    });

  } catch (err) {
    console.error('Transfer failed:', err);
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل التحويل' });
  }
});

// Dashboard
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection('transfers').orderBy('date', 'desc').get();
    const transfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const totalProfit = transfers.reduce((sum, t) => sum + t.profit, 0);
    res.json({ transfers, totalProfit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب البيانات' });
  }
});

// Delete transfer
app.delete('/api/transfer/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const docRef = db.collection('transfers').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'التحويل غير موجود' });

    await docRef.delete();
    res.json({ message: 'تم حذف التحويل' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'حدث خطأ أثناء حذف التحويل' });
  }
});

// صفحات
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
