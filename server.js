require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

let transfers = [];

function authenticateToken(req,res,next){
  const token = req.headers['authorization']?.split(' ')[1];
  if(!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET,(err,user)=>{
    if(err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.post('/api/login',(req,res)=>{
  const {username,password} = req.body;
  if(username===process.env.ADMIN_USER && password===process.env.ADMIN_PASS){
    const token = jwt.sign({username},process.env.JWT_SECRET,{expiresIn:'8h'});
    res.json({token});
  }else res.status(401).json({message:'بيانات الدخول خاطئة'});
});

app.post('/api/transfer', async (req,res)=>{
  const {from,to,amount} = req.body;
  const profit = 15;
  const totalAmount = amount + profit;
  const transfer = {from,to,amount,profit,totalAmount,date:new Date()};
  transfers.push(transfer);

  try{
    let textMsg = `طلب تحويل جديد:\nمن: ${from.type} (${from.number})\nإلى: ${to.type} (${to.number})\nالمبلغ: ${amount}\nالعمولة: ${profit}\nالإجمالي: ${totalAmount}`;
    if(from.screenshot){
      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`,{
        chat_id: process.env.TELEGRAM_CHAT_ID,
        photo: from.screenshot,
        caption: textMsg
      });
    }else{
      await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,{
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: textMsg
      });
    }
  }catch(err){ console.log('Telegram error:',err.message); }

  res.json({message:'تم تسجيل التحويل', totalAmount});
});

app.delete('/api/transfer/:index', authenticateToken,(req,res)=>{
  const idx = parseInt(req.params.index);
  if(idx>=0 && idx<transfers.length){
    transfers.splice(idx,1);
    res.json({message:'تم حذف التحويل'});
  }else res.status(404).json({message:'التحويل غير موجود'});
});

app.get('/api/dashboard', authenticateToken,(req,res)=>{
  const totalProfit = transfers.reduce((sum,t)=>sum+t.profit,0);
  res.json({transfers,totalProfit});
});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/login',(req,res)=>res.sendFile(path.join(__dirname,'login.html')));
app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'dashboard.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
