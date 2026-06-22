const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ BOT_TOKEN не встановлено! Додайте змінну середовища BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const DATA_FILE = path.join(__dirname, 'data.json');

// Тарифи
const TARIFF_DAY = 4.88;
const TARIFF_NIGHT = 2.44;

// База даних у файлі
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) { console.error('Помилка читання даних:', e); }
  return { users: {}, readings: [], sessions: {} };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('Помилка збереження:', e); }
}

let db = loadData();

// Нормалізація номера телефону
function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

// Місяці
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
function monthYear(dateStr) {
  const d = new Date(dateStr);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// === КОМАНДА /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  db.sessions[chatId] = { step: 'phone' };
  saveData(db);

  bot.sendMessage(chatId,
    '👋 *Вітаю! Я бот Oblick.ua* для передачі показань лічильника дачного кооперативу.\n\n' +
    'Для авторизації натисніть кнопку нижче, щоб поділитися номером телефону:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
});

// === ОТРИМАННЯ КОНТАКТУ ===
bot.on('contact', (msg) => {
  const chatId = msg.chat.id;
  const phone = normalizePhone(msg.contact.phone_number);

  // Шукаємо користувача за номером
  let foundUser = null;
  for (const [plot, user] of Object.entries(db.users)) {
    if (normalizePhone(user.phone) === phone) {
      foundUser = { plot: Number(plot), ...user };
      break;
    }
  }

  if (!foundUser) {
    bot.sendMessage(chatId,
      '❌ *Ваш номер не зареєстровано в системі.*\n\n' +
      'Зверніться до адміністратора Oblick.ua для додавання вашого профілю.',
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  if (!foundUser.initApproved) {
    bot.sendMessage(chatId,
      `⏳ Знайдено профіль:\n🏠 Ділянка №${foundUser.plot}\n👤 ${foundUser.fio}\n\n` +
      'Але ваші початкові показання ще не підтверджено адміністратором. Зачекайте підтвердження.',
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  db.sessions[chatId] = { step: 'menu', user: foundUser };
  saveData(db);

  bot.sendMessage(chatId,
    `✅ *Вітаю, ${foundUser.fio}!*\n` +
    `🏠 Ділянка №${foundUser.plot} — ${foundUser.mt === 'two' ? 'Двотарифний' : 'Однотарифний'} лічильник\n\n` +
    'Що бажаєте зробити?',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📝 Передати показання' }],
          [{ text: '📋 Моя історія' }, { text: 'ℹ️ Допомога' }]
        ],
        resize_keyboard: true
      }
    }
  );
});

// === ОБРОБКА ПОВІДОМЛЕНЬ ===
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/') || msg.contact) return;

  const session = db.sessions[chatId];
  if (!session || !session.user) {
    bot.sendMessage(chatId, '⚠️ Будь ласка, натисніть /start для початку.');
    return;
  }

  const user = session.user;

  // МЕНЮ
  if (text === '📝 Передати показання') {
    session.step = 'askDay';
    session.day = null;
    session.night = null;
    saveData(db);
    bot.sendMessage(chatId,
      '👋 Давайте передамо ваші показання за цей місяць.\n\n' +
      '☀️ Введіть показання за *ДЕНЬ* (кВт·ч за місяць):',
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  if (text === '📋 Моя історія') {
    const hist = db.readings
      .filter(r => r.plot === user.plot)
      .sort((a, b) => b.id - a.id)
      .slice(0, 5);

    if (hist.length === 0) {
      bot.sendMessage(chatId, '📋 *Ваша історія показань:*\n\nЩе немає переданих показань.', { parse_mode: 'Markdown' });
    } else {
      const lines = hist.map(r =>
        `*${monthYear(r.rDate)}* ${r.approved ? '✅' : '⚠️'} ${r.source === 'telegram' ? '🤖' : '💻'}\n` +
        `☀️ День: ${r.dNum}${r.mt === 'two' ? ` | 🌙 Ніч: ${r.nNum}` : ''} | 💰 ${r.total.toFixed(2)} грн`
      ).join('\n\n');
      bot.sendMessage(chatId, `📋 *Ваша історія показань (останні 5):*\n\n${lines}`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (text === 'ℹ️ Допомога') {
    bot.sendMessage(chatId,
      'ℹ️ *Як користуватись ботом Oblick.ua:*\n\n' +
      '📝 «Передати показання» — введіть кВт·ч за поточний місяць\n' +
      '📋 «Моя історія» — перегляньте свої останні показання\n\n' +
      '*Значки:*\n' +
      '✅ — прийнято адміністратором\n' +
      '⚠️ — очікує підтвердження\n' +
      '💻 — передано через сайт\n' +
      '🤖 — передано через Telegram',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ВВЕДЕННЯ ДНЯ
  if (session.step === 'askDay') {
    const v = Number(text);
    if (isNaN(v) || v < 0) {
      bot.sendMessage(chatId, '⚠️ Введіть число (наприклад: 20).');
      return;
    }
    session.day = v;
    if (user.mt === 'two') {
      session.step = 'askNight';
      saveData(db);
      bot.sendMessage(chatId, '🌙 Введіть показання за *НІЧ* (кВт·ч за місяць):', { parse_mode: 'Markdown' });
    } else {
      askConfirmation(chatId, session, user, v, 0);
    }
    return;
  }

  // ВВЕДЕННЯ НОЧІ
  if (session.step === 'askNight') {
    const v = Number(text);
    if (isNaN(v) || v < 0) {
      bot.sendMessage(chatId, '⚠️ Введіть число (наприклад: 10).');
      return;
    }
    session.night = v;
    askConfirmation(chatId, session, user, session.day, v);
    return;
  }

  // ПІДТВЕРДЖЕННЯ
  if (session.step === 'confirm') {
    if (text === '✅ Так, передати') {
      saveReading(chatId, session, user);
      return;
    }
    if (text === '❌ Скасувати') {
      session.step = 'menu';
      session.day = null;
      session.night = null;
      saveData(db);
      bot.sendMessage(chatId, 'Скасовано. Що бажаєте зробити?', {
        reply_markup: {
          keyboard: [
            [{ text: '📝 Передати показання' }],
            [{ text: '📋 Моя історія' }, { text: 'ℹ️ Допомога' }]
          ],
          resize_keyboard: true
        }
      });
      return;
    }
  }
});

function askConfirmation(chatId, session, user, day, night) {
  const last = db.readings.filter(r => r.plot === user.plot).sort((a, b) => b.id - a.id)[0];
  const mD = last ? last.mD + day : (user.initD || 0) + day;
  const mN = last ? last.mN + night : (user.initN || 0) + night;
  const cD = day * TARIFF_DAY;
  const cN = user.mt === 'two' ? night * TARIFF_NIGHT : 0;
  const total = cD + cN;

  session.step = 'confirm';
  session.computed = { mD, mN, mT: mD + mN, cD, cN, total };
  saveData(db);

  let text = `📋 *Перевірте показання:*\n\n` +
    `🏠 Ділянка: №${user.plot}\n` +
    `👤 ПІБ: ${user.fio}\n` +
    `☀️ День: ${day} кВт·ч × ${TARIFF_DAY} = ${cD.toFixed(2)} грн\n`;
  if (user.mt === 'two') {
    text += `🌙 Ніч: ${night} кВт·ч × ${TARIFF_NIGHT} = ${cN.toFixed(2)} грн\n`;
  }
  text += `🔢 На лічильнику: ${mD + mN} кВт·ч\n` +
    `💰 *Разом до сплати: ${total.toFixed(2)} грн*\n\n` +
    `Все вірно?`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [[{ text: '✅ Так, передати' }, { text: '❌ Скасувати' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

function saveReading(chatId, session, user) {
  const d = session.day || 0;
  const n = session.night || 0;
  const c = session.computed;

  const reading = {
    id: Date.now(),
    plot: user.plot,
    fio: user.fio,
    mt: user.mt,
    rDate: new Date().toISOString().slice(0, 10),
    dNum: d,
    nNum: n,
    mD: c.mD,
    mN: c.mN,
    mT: c.mT,
    cD: c.cD,
    cN: c.cN,
    total: c.total,
    tariffD: TARIFF_DAY,
    tariffN: TARIFF_NIGHT,
    date: new Date().toISOString(),
    approved: false,
    source: 'telegram'
  };

  db.readings.unshift(reading);
  session.step = 'menu';
  session.day = null;
  session.night = null;
  session.computed = null;
  saveData(db);

  bot.sendMessage(chatId,
    '🎉 *Дякуємо!*\n\n' +
    'Ваші показання передано адміністратору на підтвердження.\n\n' +
    '⚠️ Статус: *Очікує підтвердження*\n\n' +
    'Ви отримаєте сповіщення, коли адміністратор прийме показання.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📝 Передати показання' }],
          [{ text: '📋 Моя історія' }, { text: 'ℹ️ Допомога' }]
        ],
        resize_keyboard: true
      }
    }
  );
}

console.log('🤖 Oblick.ua Bot запущено!');
