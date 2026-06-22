const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1111';
if (!TOKEN) { console.error('❌ BOT_TOKEN не встановлено!'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });
const DATA_FILE = path.join(__dirname, 'data.json');

const TARIFF_DAY = 4.88;
const TARIFF_NIGHT = 2.44;

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Помилка читання:', e); }
  return { users: {}, readings: [], sessions: {}, admins: {} };
}
function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Помилка збереження:', e); }
}
let db = loadData();

function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
function monthYear(d) { const x = new Date(d); return `${MONTHS[x.getMonth()]} ${x.getFullYear()}`; }

function userMenu() {
  return { reply_markup: { keyboard: [
    [{ text: '📝 Передати показання' }],
    [{ text: '📋 Моя історія' }, { text: 'ℹ️ Допомога' }]
  ], resize_keyboard: true } };
}
function adminMenu() {
  return { reply_markup: { keyboard: [
    [{ text: '👥 Список користувачів' }, { text: '➕ Додати користувача' }],
    [{ text: '⚠️ Очікують підтвердження' }, { text: '📊 Звіт за місяць' }],
    [{ text: '🔐 Вийти з адмін-режиму' }]
  ], resize_keyboard: true } };
}

// === /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  db.sessions[chatId] = { step: 'phone' };
  saveData(db);
  bot.sendMessage(chatId,
    '👋 *Вітаю! Я бот Oblick.ua*\n\nДля авторизації натисніть кнопку нижче:',
    { parse_mode: 'Markdown', reply_markup: {
      keyboard: [[{ text: '📱 Поділитися номером', request_contact: true }]],
      resize_keyboard: true, one_time_keyboard: true
    }}
  );
});

// === /admin ===
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  db.sessions[chatId] = { step: 'adminPwd' };
  saveData(db);
  bot.sendMessage(chatId, '🔐 *Вхід адміністратора*\n\nВведіть пароль:',
    { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
});

// === Отримання контакту ===
bot.on('contact', (msg) => {
  const chatId = msg.chat.id;
  const phone = normalizePhone(msg.contact.phone_number);
  let foundUser = null;
  for (const [plot, user] of Object.entries(db.users)) {
    if (normalizePhone(user.phone) === phone) {
      foundUser = { plot: Number(plot), ...user };
      break;
    }
  }
  if (!foundUser) {
    bot.sendMessage(chatId,
      '❌ Ваш номер не зареєстровано.\n\nЗверніться до адміністратора.',
      { reply_markup: { remove_keyboard: true } });
    return;
  }
  // Зберігаємо chatId для майбутніх сповіщень
  db.users[foundUser.plot].tgChatId = chatId;
  db.sessions[chatId] = { step: 'menu', user: foundUser };
  saveData(db);
  bot.sendMessage(chatId,
    `✅ *Вітаю, ${foundUser.fio}!*\n🏠 Ділянка №${foundUser.plot} — ${foundUser.mt === 'two' ? 'Двотарифний' : 'Однотарифний'}\n\nЩо бажаєте зробити?`,
    { parse_mode: 'Markdown', ...userMenu() });
});

// === Основна обробка повідомлень ===
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/') || msg.contact) return;
  const session = db.sessions[chatId] || {};

  // АДМІН: пароль
  if (session.step === 'adminPwd') {
    if (text === ADMIN_PASSWORD) {
      db.admins[chatId] = true;
      db.sessions[chatId] = { step: 'adminMenu', isAdmin: true };
      saveData(db);
      bot.sendMessage(chatId, '✅ *Вхід виконано!*\n\nРежим адміністратора активний.',
        { parse_mode: 'Markdown', ...adminMenu() });
    } else {
      bot.sendMessage(chatId, '❌ Невірний пароль. Спробуйте /admin знову.');
      delete db.sessions[chatId]; saveData(db);
    }
    return;
  }

  // === АДМІН РЕЖИМ ===
  if (session.isAdmin) {
    if (text === '🔐 Вийти з адмін-режиму') {
      delete db.admins[chatId];
      delete db.sessions[chatId];
      saveData(db);
      bot.sendMessage(chatId, 'Вийшли з адмін-режиму.', { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (text === '👥 Список користувачів') {
      const list = Object.entries(db.users).sort((a,b) => Number(a[0]) - Number(b[0]));
      if (list.length === 0) { bot.sendMessage(chatId, '📭 Немає користувачів.', adminMenu()); return; }
      const lines = list.map(([plot, u]) =>
        `🏠 *№${plot}* — ${u.fio}\n📞 ${u.phone || '—'} · ${u.mt === 'two' ? '2-тариф' : '1-тариф'} · ${u.initApproved ? '✅' : '⚠️'}`
      ).join('\n\n');
      bot.sendMessage(chatId, `👥 *Користувачі (${list.length}):*\n\n${lines}`,
        { parse_mode: 'Markdown', ...adminMenu() });
      return;
    }
    if (text === '➕ Додати користувача') {
      db.sessions[chatId] = { step: 'addPlot', isAdmin: true, newUser: {} };
      saveData(db);
      bot.sendMessage(chatId, '➕ *Новий користувач*\n\nВведіть номер ділянки (1-350):',
        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
      return;
    }
    if (text === '⚠️ Очікують підтвердження') {
      const pending = db.readings.filter(r => !r.approved);
      if (pending.length === 0) { bot.sendMessage(chatId, '✅ Немає показань для підтвердження.', adminMenu()); return; }
      const lines = pending.slice(0, 10).map((r, i) =>
        `${i+1}. 🏠 №${r.plot} ${r.fio}\n   ${monthYear(r.rDate)} · ${r.dNum}${r.mt==='two'?'/'+r.nNum:''} кВт·ч · 💰 ${r.total.toFixed(2)} грн\n   📅 ${new Date(r.date).toLocaleString('uk-UA')}\n   👉 /approve_${r.id}`
      ).join('\n\n');
      bot.sendMessage(chatId, `⚠️ *Очікують підтвердження (${pending.length}):*\n\n${lines}`,
        { parse_mode: 'Markdown', ...adminMenu() });
      return;
    }
    if (text === '📊 Звіт за місяць') {
      const now = new Date(), ym = now.toISOString().slice(0, 7);
      const monthly = db.readings.filter(r => r.rDate && r.rDate.startsWith(ym));
      const totD = monthly.reduce((s,r) => s + (r.dNum||0), 0);
      const totN = monthly.reduce((s,r) => s + (r.nNum||0), 0);
      const sumD = monthly.reduce((s,r) => s + (r.dNum||0)*(r.tariffD||TARIFF_DAY), 0);
      const sumN = monthly.reduce((s,r) => s + (r.nNum||0)*(r.tariffN||TARIFF_NIGHT), 0);
      bot.sendMessage(chatId,
        `📊 *Звіт за ${MONTHS[now.getMonth()]} ${now.getFullYear()}:*\n\n` +
        `Записів: ${monthly.length}\n\n` +
        `☀️ День: ${totD} кВт·ч → ${sumD.toFixed(2)} грн\n` +
        `🌙 Ніч: ${totN} кВт·ч → ${sumN.toFixed(2)} грн\n` +
        `🔢 *Загалом: ${totD+totN} кВт·ч → ${(sumD+sumN).toFixed(2)} грн*`,
        { parse_mode: 'Markdown', ...adminMenu() });
      return;
    }

    // Покрокове додавання користувача
    if (session.step === 'addPlot') {
      const p = parseInt(text);
      if (isNaN(p) || p < 1 || p > 350) { bot.sendMessage(chatId, '⚠️ Введіть число від 1 до 350.'); return; }
      if (db.users[p]) { bot.sendMessage(chatId, `⚠️ Ділянка №${p} вже існує. Введіть інший номер:`); return; }
      session.newUser.plot = p;
      session.step = 'addFio';
      saveData(db);
      bot.sendMessage(chatId, '👤 Введіть ПІБ:');
      return;
    }
    if (session.step === 'addFio') {
      session.newUser.fio = text.trim();
      session.step = 'addPhone';
      saveData(db);
      bot.sendMessage(chatId, '📞 Введіть номер телефону (наприклад +380501234567):');
      return;
    }
    if (session.step === 'addPhone') {
      session.newUser.phone = text.trim();
      session.step = 'addMt';
      saveData(db);
      bot.sendMessage(chatId, '⚡ Тип лічильника?',
        { reply_markup: { keyboard: [[{ text: 'Однотарифний' }, { text: 'Двотарифний' }]], resize_keyboard: true, one_time_keyboard: true }});
      return;
    }
    if (session.step === 'addMt') {
      if (text !== 'Однотарифний' && text !== 'Двотарифний') {
        bot.sendMessage(chatId, '⚠️ Оберіть із кнопок.'); return;
      }
      session.newUser.mt = text === 'Двотарифний' ? 'two' : 'one';
      session.step = 'addInitD';
      saveData(db);
      bot.sendMessage(chatId, '☀️ Введіть початкові показання ДЕНЬ (кВт·ч на лічильнику):',
        { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (session.step === 'addInitD') {
      const v = Number(text);
      if (isNaN(v) || v < 0) { bot.sendMessage(chatId, '⚠️ Введіть число.'); return; }
      session.newUser.initD = v;
      if (session.newUser.mt === 'two') {
        session.step = 'addInitN';
        saveData(db);
        bot.sendMessage(chatId, '🌙 Введіть початкові показання НІЧ (кВт·ч):');
      } else {
        session.newUser.initN = 0;
        finishAddUser(chatId, session);
      }
      return;
    }
    if (session.step === 'addInitN') {
      const v = Number(text);
      if (isNaN(v) || v < 0) { bot.sendMessage(chatId, '⚠️ Введіть число.'); return; }
      session.newUser.initN = v;
      finishAddUser(chatId, session);
      return;
    }
    return;
  }

  // === КОРИСТУВАЦЬКИЙ РЕЖИМ ===
  if (!session.user) {
    bot.sendMessage(chatId, '⚠️ Натисніть /start для початку або /admin для адміністратора.');
    return;
  }
  const user = session.user;

  if (text === '📝 Передати показання') {
    session.step = 'askDay'; session.day = null; session.night = null;
    saveData(db);
    bot.sendMessage(chatId, '👋 Передаємо показання за цей місяць.\n\n☀️ Введіть показання ДЕНЬ (кВт·ч за місяць):',
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true }});
    return;
  }
  if (text === '📋 Моя історія') {
    const hist = db.readings.filter(r => r.plot === user.plot).sort((a,b) => b.id - a.id).slice(0,5);
    if (hist.length === 0) { bot.sendMessage(chatId, '📋 Ще немає показань.', userMenu()); return; }
    const lines = hist.map(r =>
      `*${monthYear(r.rDate)}* ${r.approved?'✅':'⚠️'} ${r.source==='telegram'?'🤖':'💻'}\n☀️ ${r.dNum}${r.mt==='two'?` | 🌙 ${r.nNum}`:''} | 💰 ${r.total.toFixed(2)} грн`
    ).join('\n\n');
    bot.sendMessage(chatId, `📋 *Останні 5 показань:*\n\n${lines}`, { parse_mode: 'Markdown', ...userMenu() });
    return;
  }
  if (text === 'ℹ️ Допомога') {
    bot.sendMessage(chatId,
      'ℹ️ *Як користуватись:*\n\n📝 Передати — введіть кВт·ч за місяць\n📋 Історія — останні показання\n\n✅ прийнято · ⚠️ очікує · 💻 сайт · 🤖 telegram',
      { parse_mode: 'Markdown', ...userMenu() });
    return;
  }

  if (session.step === 'askDay') {
    const v = Number(text);
    if (isNaN(v) || v < 0) { bot.sendMessage(chatId, '⚠️ Введіть число.'); return; }
    session.day = v;
    if (user.mt === 'two') {
      session.step = 'askNight'; saveData(db);
      bot.sendMessage(chatId, '🌙 Введіть показання НІЧ (кВт·ч):');
    } else { askConfirmation(chatId, session, user, v, 0); }
    return;
  }
  if (session.step === 'askNight') {
    const v = Number(text);
    if (isNaN(v) || v < 0) { bot.sendMessage(chatId, '⚠️ Введіть число.'); return; }
    session.night = v;
    askConfirmation(chatId, session, user, session.day, v);
    return;
  }
  if (session.step === 'confirm') {
    if (text === '✅ Так, передати') { saveReading(chatId, session, user); return; }
    if (text === '❌ Скасувати') {
      session.step = 'menu'; saveData(db);
      bot.sendMessage(chatId, 'Скасовано.', userMenu()); return;
    }
  }
});

// Команда підтвердження показань: /approve_<id>
bot.onText(/\/approve_(\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!db.admins[chatId]) {
    bot.sendMessage(chatId, '⛔ Доступно лише адміністратору. /admin');
    return;
  }
  const id = Number(match[1]);
  const reading = db.readings.find(r => r.id === id);
  if (!reading) { bot.sendMessage(chatId, '⚠️ Запис не знайдено.'); return; }
  if (reading.approved) { bot.sendMessage(chatId, '✅ Запис вже підтверджено.'); return; }
  reading.approved = true;
  reading.approvedAt = new Date().toISOString();
  saveData(db);
  bot.sendMessage(chatId, `✅ Підтверджено: 🏠 №${reading.plot} · ${monthYear(reading.rDate)} · 💰 ${reading.total.toFixed(2)} грн`, adminMenu());

  // Сповіщення користувача
  const u = db.users[reading.plot];
  if (u && u.tgChatId) {
    bot.sendMessage(u.tgChatId,
      `✅ *Ваші показання прийнято!*\n\n🏠 Ділянка №${reading.plot}\n📅 ${monthYear(reading.rDate)}\n💰 До сплати: ${reading.total.toFixed(2)} грн\n\nДякуємо!`,
      { parse_mode: 'Markdown' });
  }
});

function finishAddUser(chatId, session) {
  const u = session.newUser;
  db.users[u.plot] = {
    fio: u.fio, phone: u.phone, mt: u.mt,
    initD: u.initD, initN: u.initN || 0,
    initApproved: true, passwordChanged: true
  };
  db.sessions[chatId] = { step: 'adminMenu', isAdmin: true };
  saveData(db);
  bot.sendMessage(chatId,
    `✅ *Користувача додано!*\n\n🏠 №${u.plot}\n👤 ${u.fio}\n📞 ${u.phone}\n⚡ ${u.mt === 'two' ? 'Двотарифний' : 'Однотарифний'}\n🔢 Початкові: ${u.initD}${u.mt === 'two' ? '/'+u.initN : ''} кВт·ч`,
    { parse_mode: 'Markdown', ...adminMenu() });
}

function askConfirmation(chatId, session, user, day, night) {
  const last = db.readings.filter(r => r.plot === user.plot).sort((a,b) => b.id - a.id)[0];
  const mD = last ? last.mD + day : (user.initD || 0) + day;
  const mN = last ? last.mN + night : (user.initN || 0) + night;
  const cD = day * TARIFF_DAY;
  const cN = user.mt === 'two' ? night * TARIFF_NIGHT : 0;
  const total = cD + cN;
  session.step = 'confirm';
  session.computed = { mD, mN, mT: mD+mN, cD, cN, total };
  saveData(db);
  let text = `📋 *Перевірте показання:*\n\n🏠 Ділянка: №${user.plot}\n👤 ${user.fio}\n☀️ День: ${day} × ${TARIFF_DAY} = ${cD.toFixed(2)} грн\n`;
  if (user.mt === 'two') text += `🌙 Ніч: ${night} × ${TARIFF_NIGHT} = ${cN.toFixed(2)} грн\n`;
  text += `🔢 На лічильнику: ${mD+mN} кВт·ч\n💰 *Разом: ${total.toFixed(2)} грн*\n\nВсе вірно?`;
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown',
    reply_markup: { keyboard: [[{ text: '✅ Так, передати' }, { text: '❌ Скасувати' }]], resize_keyboard: true, one_time_keyboard: true }});
}

function saveReading(chatId, session, user) {
  const c = session.computed;
  const reading = {
    id: Date.now(), plot: user.plot, fio: user.fio, mt: user.mt,
    rDate: new Date().toISOString().slice(0, 10),
    dNum: session.day || 0, nNum: session.night || 0,
    mD: c.mD, mN: c.mN, mT: c.mT, cD: c.cD, cN: c.cN, total: c.total,
    tariffD: TARIFF_DAY, tariffN: TARIFF_NIGHT,
    date: new Date().toISOString(), approved: false, source: 'telegram'
  };
  db.readings.unshift(reading);
  session.step = 'menu'; session.day = null; session.night = null; session.computed = null;
  saveData(db);
  bot.sendMessage(chatId,
    '🎉 *Дякуємо!*\n\nПоказання передано адміністратору на підтвердження.\n⚠️ Статус: Очікує\n\nВи отримаєте сповіщення коли адмін прийме.',
    { parse_mode: 'Markdown', ...userMenu() });
}

console.log('🤖 Oblick.ua Bot запущено!');
console.log('Адмін-вхід: /admin · Пароль:', ADMIN_PASSWORD);
