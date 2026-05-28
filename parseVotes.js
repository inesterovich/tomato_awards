const fs = require('fs');
const path = require('path');

// НАСТРОЙКИ
const INPUT_DIR = './input';          // папка с исходными JSON-файлами (по номинациям)
const OUTPUT_BASE = './output';       // базовая папка для результатов

// Функции определения голосования / дополнения (те же, что и раньше)
function isVote(text) {
  const t = text.toLowerCase();
  const votePhrases = [
    'голосую', 'выдвигаю', 'отдаю голос', 'отдаю свой голос',
    'номинирую', 'предлагаю', 'хочу отметить', 'хотела бы отметить',
    'хотел бы отметить', 'выдвинуть'
  ];
  if (votePhrases.some(p => t.includes(p))) return true;
  if (/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s*[-–]\s*[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/.test(text)) return true;
  if (text.includes('https://vk') && /рутин|танец|выступлени|пара|номер/i.test(text)) return true;
  return false;
}

function isAddition(text) {
  if (isVote(text)) return false;
  if (text.length > 200) return false;
  const addWords = ['добавлю ссылк', 'вот ссылка', 'ссылка на танец', 'вот танец', 'поправлю ссылку'];
  if (addWords.some(w => text.toLowerCase().includes(w))) return true;
  if (text.includes('https://vk')) return true;
  return false;
}

// Основная функция обработки одного файла
function processNomination(filePath, nominationName) {
  console.log(`\nОбработка номинации: ${nominationName}`);

  // Чтение исходных данных
  let comments;
  try {
    comments = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`  Ошибка чтения файла ${filePath}: ${err.message}`);
    return;
  }

  // Индекс ответов
  const repliesMap = new Map();
  comments.forEach(c => {
    if (c.isReply && c.parentId) {
      if (!repliesMap.has(c.parentId)) repliesMap.set(c.parentId, []);
      repliesMap.get(c.parentId).push(c);
    }
  });

  const votes = [];
  const additions = [];
  const other = [];

  comments.forEach(c => {
    if (isVote(c.text)) {
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
      additions.push(c);
    } else {
      other.push(c);
    }
  });

  // Сортировка голосований по userId
  votes.sort((a, b) => parseInt(a.userId) - parseInt(b.userId));

  // Создание выходной папки
  const outDir = path.join(OUTPUT_BASE, nominationName);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Сохранение файлов
  fs.writeFileSync(path.join(outDir, 'votes.json'), JSON.stringify(votes, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'additions.json'), JSON.stringify(additions, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'other.json'), JSON.stringify(other, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(comments, null, 2), 'utf8');

  // Статистика
  console.log(`  Всего комментариев: ${comments.length}`);
  console.log(`  Голосований: ${votes.length}`);
  console.log(`  Дополнений: ${additions.length}`);
  console.log(`  Прочих: ${other.length}`);
  console.log(`  Результаты сохранены в: ${outDir}`);
}

// Главная функция – обход всех JSON-файлов во входной папке
function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Ошибка: входная папка "${INPUT_DIR}" не существует.`);
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    console.log(`Нет JSON-файлов в папке "${INPUT_DIR}".`);
    return;
  }

  console.log(`Найдено ${jsonFiles.length} JSON-файлов:`);
  jsonFiles.forEach(f => console.log(`  - ${f}`));

  for (const file of jsonFiles) {
    const nominationName = path.basename(file, '.json');
    const fullPath = path.join(INPUT_DIR, file);
    processNomination(fullPath, nominationName);
  }

  console.log('\nГотово!');
}

main();