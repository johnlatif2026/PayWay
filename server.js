require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const axios = require('axios');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// تهيئة Firebase
initializeApp({
  credential: applicationDefault(),
});
const db = getFirestore();

const app = express();
app.use(cors());
app.use(express.json());

// المجلد اللي هيتحفظ فيه الصور
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// نخلي المجلد static علشان نقدر نوصل للصور بالرابط
app.use('/uploads', express.static(uploadsDir));

// إعداد multer لحفظ الملفات على السيرفر
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

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

    const fromType = fromServiceType;
    const toType = toServiceType;
    const profit = 15;
    const totalAmount = parseFloat(amount) + profit;

    let screenshotURL = null;

    if (req.file) {
      const form = new FormData();
      form.append('image', req.file.buffer.toString('base64'));
      form.append('key', process.env.IMGBB_API_KEY);

      const response = await axios.post('https://api.imgbb.com/1/upload', form, {
        headers: form.getHeaders()
      });
      screenshotURL = response.data.data.display_url;
    }

    const transfer = {
      from: { type: fromType, number: fromNumber, name: fromName, screenshot: screenshotURL },
      to: { type: toType, number: toNumber, name: toName },
      amount: parseFloat(amount),
      profit,
      totalAmount,
      date: new Date()
    };

    // حفظ التحويل في Firebase
    await db.collection('transfers').add(transfer);

    // إرسال الرسالة على تيليجرام
    let textMsg = `طلب تحويل جديد:\nمن: ${fromType} (${fromNumber})\nإلى: ${toType} (${toNumber})\nالمبلغ: ${amount}\nالعمولة: ${profit}\nالإجمالي: ${totalAmount}`;

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

    res.json({ message: 'تم تسجيل التحويل', totalAmount });
  } catch (err) {
    console.error(err);
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

    // حذف الصورة من السيرفر لو موجودة
    const screenshotUrl = doc.data().from.screenshot;
    if (screenshotUrl) {
      const filePath = path.join(__dirname, 'uploads', path.basename(screenshotUrl));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

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
