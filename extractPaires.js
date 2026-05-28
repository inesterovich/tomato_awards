const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';
const DASH_PATTERN = '[–—-]'; // длинное тире, короткое тире, дефис

// Разбиение текста на отдельные выдвижения (кандидаты)
function splitIntoStatements(text) {
  let lines = text.split(/\n/);
  let result = [];
  for (let line of lines) {
    line = line.trim();
    if (line === '') continue;
    let subParts = line.split(/\d+[\.\)]\s*/);
    for (let sub of subParts) {
      sub = sub.trim();
      if (sub) result.push(sub);
    }
  }
  if (result.length === 0) result = [text];
  return result;
}

// Извлечение всех пар из одного выдвижения
function extractAllPairsFromStatement(statement) {
  const pairs = [];
  // Полные имена "Имя Фамилия — Имя Фамилия" (любое тире)
  const fullPattern = new RegExp(`([А-ЯЁ][а-яё]+\\s+[А-ЯЁ][а-яё]+)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+\\s+[А-ЯЁ][а-яё]+)`, 'g');
  let match;
  while ((match = fullPattern.exec(statement)) !== null) {
    pairs.push({
      pairRaw: `${match[1]} - ${match[2]}`,
      pairLeft: match[1],
      pairRight: match[2]
    });
  }
  if (pairs.length > 0) return pairs;

  // Только фамилии "Фамилия — Фамилия"
  const shortPattern = new RegExp(`([А-ЯЁ][а-яё]+)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+)`, 'g');
  while ((match = shortPattern.exec(statement)) !== null) {
    pairs.push({
      pairRaw: `${match[1]} - ${match[2]}`,
      pairLeft: match[1],
      pairRight: match[2]
    });
  }
  if (pairs.length > 0) return pairs;

  // "Имя и Имя" (например, "Катунин и Холонина")
  const andPattern = /([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s+и\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/g;
  while ((match = andPattern.exec(statement)) !== null) {
    pairs.push({
      pairRaw: `${match[1]} - ${match[2]}`,
      pairLeft: match[1],
      pairRight: match[2]
    });
  }
  return pairs;
}

// Обработка одной номинации
function processNomination(nominationPath, nominationName) {
  const votesFile = path.join(nominationPath, 'votes.json');
  if (!fs.existsSync(votesFile)) {
    console.log(`  ${nominationName}: votes.json не найден, пропускаем`);
    return;
  }

  const votes = JSON.parse(fs.readFileSync(votesFile, 'utf8'));
  const recognized = [];   // комментарии, где найдены пары
  const unrecognized = []; // комментарии, где пар нет

  for (const vote of votes) {
    const text = vote.text;
    const statements = splitIntoStatements(text);
    let allPairs = [];
    for (const stmt of statements) {
      const pairs = extractAllPairsFromStatement(stmt);
      allPairs.push(...pairs);
    }
    // Удаляем дубликаты пар внутри одного комментария (по pairRaw)
    const uniquePairs = [];
    const seen = new Set();
    for (const p of allPairs) {
      if (!seen.has(p.pairRaw)) {
        seen.add(p.pairRaw);
        uniquePairs.push(p);
      }
    }
    if (uniquePairs.length > 0) {
      recognized.push({
        userId: vote.userId,
        username: vote.username,
        timestamp: vote.timestamp,
        originalText: text,
        pairs: uniquePairs
      });
    } else {
      unrecognized.push({
        userId: vote.userId,
        username: vote.username,
        timestamp: vote.timestamp,
        originalText: text
      });
    }
  }

  // Сохраняем распознанные комментарии
  const outRecognized = path.join(nominationPath, 'votes_with_pairs.json');
  fs.writeFileSync(outRecognized, JSON.stringify(recognized, null, 2), 'utf8');

  // Сохраняем нераспознанные (для ручной проверки)
  const outUnrecognized = path.join(nominationPath, 'votes_unrecognized.json');
  fs.writeFileSync(outUnrecognized, JSON.stringify(unrecognized, null, 2), 'utf8');

  const total = votes.length;
  const recogCount = recognized.length;
  const unrecogCount = unrecognized.length;
  const avgPairs = recogCount > 0 ? (recognized.reduce((acc, r) => acc + r.pairs.length, 0) / recogCount).toFixed(1) : 0;

  console.log(`  ${nominationName}:`);
  console.log(`    Всего комментариев: ${total}`);
  console.log(`    Распознано (с парами): ${recogCount}`);
  console.log(`    Не распознано (пустых): ${unrecogCount}`);
  console.log(`    Среднее количество пар на распознанный комментарий: ${avgPairs}`);
  console.log(`    Результаты сохранены в: ${nominationPath}`);
}

// Главная функция
function main() {
  if (!fs.existsSync(OUTPUT_BASE)) {
    console.error(`Папка ${OUTPUT_BASE} не существует. Сначала запустите process_nominations.js`);
    process.exit(1);
  }

  const nominations = fs.readdirSync(OUTPUT_BASE).filter(item => {
    const itemPath = path.join(OUTPUT_BASE, item);
    return fs.statSync(itemPath).isDirectory();
  });

  if (nominations.length === 0) {
    console.log(`Нет папок номинаций в ${OUTPUT_BASE}`);
    return;
  }

  console.log(`Найдено номинаций: ${nominations.length}`);
  for (const nom of nominations) {
    const nomPath = path.join(OUTPUT_BASE, nom);
    processNomination(nomPath, nom);
  }
  console.log('Готово!');
}

main();