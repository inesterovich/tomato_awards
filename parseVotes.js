const fs = require('fs');

// НАСТРОЙКИ
const INPUT_FILE = 'vk-routine_of_the_year.json';   // ваш полный файл
const OUTPUT_VOTES = 'votes.json';
const OUTPUT_ADDITIONS = 'additions.json';
const OUTPUT_OTHER = 'other.json';

// Загрузка
const comments = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

// Эвристика: голосование
function isVote(text) {
  const t = text.toLowerCase();
  const votePhrases = [
    'голосую', 'выдвигаю', 'отдаю голос', 'отдаю свой голос',
    'номинирую', 'предлагаю', 'хочу отметить', 'хотела бы отметить',
    'хотел бы отметить', 'выдвинуть'
  ];
  if (votePhrases.some(p => t.includes(p))) return true;
  // шаблон "Фамилия Имя - Фамилия Имя"
  if (/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s*[-–]\s*[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/.test(text)) return true;
  // ссылка + слова о танце/рутине/паре
  if (text.includes('https://vk') && /рутин|танец|выступлени|пара|номер/i.test(text)) return true;
  return false;
}

// Дополнение: короткий ответ (не голосование) со ссылкой или словами-маркерами
function isAddition(text) {
  if (isVote(text)) return false;
  if (text.length > 200) return false;
  const addWords = ['добавлю ссылк', 'вот ссылка', 'ссылка на танец', 'вот танец', 'поправлю ссылку'];
  if (addWords.some(w => text.toLowerCase().includes(w))) return true;
  if (text.includes('https://vk')) return true;
  return false;
}

// Построение индекса ответов (parentId -> список ответов)
const repliesMap = new Map();
comments.forEach(c => {
  if (c.isReply && c.parentId) {
    if (!repliesMap.has(c.parentId)) repliesMap.set(c.parentId, []);
    repliesMap.get(c.parentId).push(c);
  }
});

// Массивы для трёх групп
const votes = [];
const additions = [];
const other = [];

// Обработка каждого комментария
comments.forEach(c => {
  if (isVote(c.text)) {
    // Голосование: собираем дополнения (ответы, которые НЕ голосования, но дополнения)
    let text = c.text;
    const children = repliesMap.get(c.id) || [];
    const addChildren = children.filter(r => isAddition(r.text)).map(r => r.text.trim());
    if (addChildren.length) {
      text += '\n[дополнения: ' + addChildren.join(' | ') + ']';
    }
    votes.push({
      userId: c.userId,
      username: c.username,
      text: text,
      timestamp: c.timestamp,
      isReply: c.isReply || false,
      parentId: c.parentId || null
    });
  } else if (c.isReply && isAddition(c.text)) {
    // Дополнение (ответ без голосования, но с признаками дополнения)
    additions.push(c);
  } else {
    // Всё остальное
    other.push(c);
  }
});

// Сортировка голосований по userId (как число)
votes.sort((a, b) => parseInt(a.userId) - parseInt(b.userId));

// Сохранение в файлы
fs.writeFileSync(OUTPUT_VOTES, JSON.stringify(votes, null, 2), 'utf8');
fs.writeFileSync(OUTPUT_ADDITIONS, JSON.stringify(additions, null, 2), 'utf8');
fs.writeFileSync(OUTPUT_OTHER, JSON.stringify(other, null, 2), 'utf8');

// Статистика
console.log('===== СТАТИСТИКА =====');
console.log(`Всего комментариев в файле: ${comments.length}`);
console.log(`Голосований (сохранено в ${OUTPUT_VOTES}): ${votes.length}`);
console.log(`Дополнений (сохранено в ${OUTPUT_ADDITIONS}): ${additions.length}`);
console.log(`Прочих (сохранено в ${OUTPUT_OTHER}): ${other.length}`);
console.log('Готово.');