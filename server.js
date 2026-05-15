const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Sening bot tokening
const BOT_TOKEN = "8982299795:AAHRfzjK8a-QinoflSWGibLQpj6fTrNRjMI";
const bot = new Telegraf(BOT_TOKEN);

// Bot buyruqlari
bot.start((ctx) => {
    ctx.replyWithHTML("<b>👑 RICH OMAD loyihasiga xush kelibsiz!</b>\n\nPastdagi tugmani bosing va o'yinni boshlang.", 
    Markup.inlineKeyboard([
        [Markup.button.webApp("🎰 O'yinni boshlash", "https://rich-omad.vercel.app")] // Buni keyin o'zgartiramiz
    ]));
});

// Web sahifa uchun yo'l
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

bot.launch();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
