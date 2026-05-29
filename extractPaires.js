const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';
const DASH_PATTERN = '[–—-]';
const ALLOWED_MANUAL_FLAGS = ['cleanedText', 'noPairs', 'notPairs'];

// ------------------------------------------------------------------
// 1. Предобработка текста (нормализация ё, склейка -\n, удаление тегов)
// ------------------------------------------------------------------
function preprocessText(text) {
    let processed = text.replace(/ë/g, 'ё').replace(/Ë/g, 'Ё');
    processed = processed.replace(/([-–—])\n/g, '$1');
    processed = processed.replace(/\[id\d+\|([^\]]+)\]/g, '$1');
    processed = processed.replace(/@([А-ЯЁа-яё]+)/g, '$1');
    processed = processed.replace(/[ \t]+/g, ' ').trim();
    return processed;
}

// ------------------------------------------------------------------
// 2. Разбиение на высказывания (сохраняем переносы строк)
// ------------------------------------------------------------------
function splitIntoStatements(text) {
    const normalized = preprocessText(text);
    let lines = normalized.split(/\n/);
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
    if (result.length === 0) result = [normalized];
    return result;
}

// ------------------------------------------------------------------
// 3. Извлечение пар из одного высказывания (со стоп-словами)
// ------------------------------------------------------------------
function extractAllPairsFromStatement(statement) {
    const pairs = [];
    const stopWords = [
        'командное', 'первенство', 'чемпионат', 'россии', 'года',
        'конкурс', 'турнир', 'номер', 'рутина', 'танец', 'выступление', 'номинация'
    ];

    // 1. Полные имена через тире
    const fullPattern = new RegExp(`([А-ЯЁ][а-яё]+(?:ё)?\\s+[А-ЯЁ][а-яё]+(?:ё)?)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+(?:ё)?\\s+[А-ЯЁ][а-яё]+(?:ё)?)`, 'g');
    let match;
    while ((match = fullPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
    }
    if (pairs.length) return pairs;

    // 2. Только фамилии через тире
    const shortPattern = new RegExp(`([А-ЯЁ][а-яё]+(?:ё)?)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+(?:ё)?)`, 'g');
    while ((match = shortPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
    }
    if (pairs.length) return pairs;

    // 3. Два полных имени подряд (без разделителя) – с проверкой на стоп-слова
    const twoFullNamesPattern = /([А-ЯЁ][а-яё]+(?:ё)?\s+[А-ЯЁ][а-яё]+(?:ё)?)\s+([А-ЯЁ][а-яё]+(?:ё)?\s+[А-ЯЁ][а-яё]+(?:ё)?)/g;
    while ((match = twoFullNamesPattern.exec(statement)) !== null) {
        const name1 = match[1];
        const name2 = match[2];
        const allWords = name1.split(' ').concat(name2.split(' ')).map(w => w.toLowerCase());
        if (allWords.some(w => stopWords.includes(w))) continue;
        pairs.push({ pairRaw: `${name1} - ${name2}`, pairLeft: name1, pairRight: name2 });
    }
    if (pairs.length) return pairs;

    // 4. VK-теги (запасной вариант, обычно уже заменены)
    const vkTagPattern = /\[id\d+\|([^\]]+)\]\s*[-–]\s*\[id\d+\|([^\]]+)\]/g;
    while ((match = vkTagPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1].trim(), pairRight: match[2].trim() });
    }
    if (pairs.length) return pairs;

    // 5. Разделители "и", "с", "&", "+", "/"
    const separators = ['\\s+и\\s+', '\\s+с\\s+', '\\s*&\\s*', '\\s*\\+\\s*', '\\s*/\\s*'];
    for (const sep of separators) {
        const pattern = new RegExp(`([А-ЯЁ][а-яё]+(?:ё)?(?:\\s+[А-ЯЁ][а-яё]+(?:ё)?)?)\\s*${sep}\\s*([А-ЯЁ][а-яё]+(?:ё)?(?:\\s+[А-ЯЁ][а-яё]+(?:ё)?)?)`, 'g');
        while ((match = pattern.exec(statement)) !== null) {
            pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
        }
        if (pairs.length) return pairs;
    }
    return pairs;
}

// ------------------------------------------------------------------
// 4. Парсинг без ручного файла
// ------------------------------------------------------------------
function parseVotes(votes) {
    const recognized = [];
    const unrecognized = [];
    for (const vote of votes) {
        const textForParsing = vote.cleanedText || vote.text;
        const statements = splitIntoStatements(textForParsing);
        let allPairs = [];
        for (const stmt of statements) {
            const pairs = extractAllPairsFromStatement(stmt);
            allPairs.push(...pairs);
        }
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
                originalText: vote.text,
                cleanedText: vote.cleanedText || null,
                pairs: uniquePairs
            });
        } else {
            unrecognized.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.text,
                cleanedText: vote.cleanedText || null
            });
        }
    }
    return { recognized, unrecognized };
}

// ------------------------------------------------------------------
// 5. Валидация ручного файла (с поддержкой notPairs)
// ------------------------------------------------------------------
function validateManualFile(manualData, originalVotes, prevUnrecognized) {
    const manualFixed = manualData.filter(item => item.withManual && ALLOWED_MANUAL_FLAGS.includes(item.withManual));
    if (manualFixed.length !== prevUnrecognized.length) {
        console.error(`\n😈 Ой-ой-ой! Вы отметили ${manualFixed.length} комментариев как "ручные", но нераспознанных было ${prevUnrecognized.length}. Либо вы ошиблись, либо намухлевали. 🚫`);
        return false;
    }

    const prevMap = new Map();
    for (const u of prevUnrecognized) {
        const key = `${u.userId}|${u.timestamp}`;
        prevMap.set(key, u);
    }

    for (const manual of manualFixed) {
        const key = `${manual.userId}|${manual.timestamp}`;
        const original = prevMap.get(key);
        if (!original) {
            console.error(`\n🔍 Хм... комментарий от ${manual.username} (${manual.timestamp}) не был нераспознанным. Попытка подтасовки? 🎩`);
            return false;
        }
        if (original.userId !== manual.userId ||
            original.username !== manual.username ||
            original.timestamp !== manual.timestamp ||
            original.originalText !== manual.text) {
            console.error(`\n📝 Изменены защищённые поля у комментария ${manual.username}. Только cleanedText можно менять (или ставить флаг noPairs). Не жульничайте! 😼`);
            return false;
        }
        // Для флагов notPairs/noPairs дополнительные проверки не нужны
    }

    // Проверяем "хорошие" комментарии (без флага)
    const goodManual = manualData.filter(v => !v.withManual);
    const goodOriginal = originalVotes.filter(v => {
        return !prevUnrecognized.some(u => u.userId === v.userId && u.timestamp === v.timestamp);
    });
    if (goodManual.length !== goodOriginal.length) {
        console.error(`\n🧮 Количество «хороших» (без флага) не совпадает: в ручном ${goodManual.length}, в оригинале ${goodOriginal.length}. Что-то добавлено или удалено. Так нельзя! 📏`);
        return false;
    }

    for (let i = 0; i < goodOriginal.length; i++) {
        const orig = goodOriginal[i];
        const man = goodManual[i];
        if (orig.userId !== man.userId ||
            orig.username !== man.username ||
            orig.timestamp !== man.timestamp ||
            orig.text !== man.text) {
            console.error(`\n⚠️ У комментария ${orig.username} от ${orig.timestamp} изменены защищённые поля. Нечестно! 🦹`);
            return false;
        }
        if (orig.cleanedText !== man.cleanedText) {
            console.error(`\n✂️ Вы изменили cleanedText у успешно распознанного комментария. Это подозрительно! 🤡`);
            return false;
        }
    }
    return true;
}

// ------------------------------------------------------------------
// 6. Основная обработка номинации (с историей и флагом notPairs)
// ------------------------------------------------------------------
function processNomination(nominationPath, nominationName) {
    const votesFile = path.join(nominationPath, 'votes.json');
    const unrecognizedFile = path.join(nominationPath, 'votes_unrecognized.json');
    const manualFile = path.join(nominationPath, 'votes_with_manual.json');
    const historyDir = path.join(nominationPath, 'history');

    if (!fs.existsSync(votesFile)) {
        console.log(`  ${nominationName}: votes.json не найден, пропускаем`);
        return;
    }

    const originalVotes = JSON.parse(fs.readFileSync(votesFile, 'utf8'));

    // --- Ручной файл отсутствует ---
    if (!fs.existsSync(manualFile)) {
        console.log(`  ${nominationName}: 🤖 Ручного файла нет. Запускаю автоматическое распознавание...`);
        const { recognized, unrecognized } = parseVotes(originalVotes);
        fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(recognized, null, 2), 'utf8');
        fs.writeFileSync(unrecognizedFile, JSON.stringify(unrecognized, null, 2), 'utf8');

        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const historyFile = path.join(historyDir, `unrecognized_${timestamp}.json`);
        fs.copyFileSync(unrecognizedFile, historyFile);
        console.log(`    Копия unrecognized сохранена: ${historyFile}`);

        console.log(`  📊 ${nominationName}: Всего ${originalVotes.length} | ✅ Распознано: ${recognized.length} | ❌ Не распознано: ${unrecognized.length}`);
        if (unrecognized.length > 0) {
            console.log(`  💡 Совет: скопируйте votes.json в votes_with_manual.json, найдите нераспознанные записи, добавьте "withManual": "cleanedText" и исправьте cleanedText, или "notPairs" если пар нет.`);
        }
        return;
    }

    // --- Ручной файл существует ---
    console.log(`  ${nominationName}: 🕵️‍♂️ Найден votes_with_manual.json. Проверяю честность...`);
    const manualData = JSON.parse(fs.readFileSync(manualFile, 'utf8'));

    if (!fs.existsSync(unrecognizedFile)) {
        console.error(`  ❓ А где votes_unrecognized.json? Сначала запустите скрипт без ручного файла.`);
        return;
    }
    const prevUnrecognized = JSON.parse(fs.readFileSync(unrecognizedFile, 'utf8'));
    const originalUnrecognized = JSON.parse(JSON.stringify(prevUnrecognized));

    if (!validateManualFile(manualData, originalVotes, prevUnrecognized)) {
        console.error(`  🔥 ВАЛИДАЦИЯ ПРОВАЛЕНА! Пары не будут извлечены. Исправьте votes_with_manual.json.`);
        return;
    }

    console.log(`  ✅ Валидация успешна! Запускаю распознавание с учётом ваших правок.`);

    // Подготовка данных для парсинга (для notPairs текст не важен)
    const votesToParse = manualData.map(v => {
        if (v.withManual === 'cleanedText') {
            return { ...v, textForParsing: v.cleanedText };
        } else {
            return { ...v, textForParsing: v.cleanedText || v.text };
        }
    });

    const recognized = [];
    const unrecognizedOut = [];

    for (const vote of votesToParse) {
        // Пропускаем помеченные notPairs / noPairs
        if (vote.withManual === 'notPairs' || vote.withManual === 'noPairs') {
            continue;
        }
        const textForParsing = vote.textForParsing;
        const statements = splitIntoStatements(textForParsing);
        let allPairs = [];
        for (const stmt of statements) {
            const pairs = extractAllPairsFromStatement(stmt);
            allPairs.push(...pairs);
        }
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
                originalText: vote.text,
                cleanedText: vote.cleanedText,
                pairs: uniquePairs,
                manualFixed: !!vote.withManual
            });
        } else {
            unrecognizedOut.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.text,
                cleanedText: vote.cleanedText
            });
        }
    }

    fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(recognized, null, 2), 'utf8');
    fs.writeFileSync(unrecognizedFile, JSON.stringify(unrecognizedOut, null, 2), 'utf8');

    // --- Сохранение истории и лога решённых записей ---
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const historyFile = path.join(historyDir, `unrecognized_${timestamp}.json`);
    fs.copyFileSync(unrecognizedFile, historyFile);
    console.log(`    Копия unrecognized сохранена: ${historyFile}`);

    const resolved = originalUnrecognized.filter(old =>
        !unrecognizedOut.some(newItem => newItem.userId === old.userId && newItem.timestamp === old.timestamp)
    );
    if (resolved.length > 0) {
        const resolvedLogFile = path.join(nominationPath, 'resolved_unrecognized.json');
        let log = [];
        if (fs.existsSync(resolvedLogFile)) {
            log = JSON.parse(fs.readFileSync(resolvedLogFile, 'utf8'));
        }
        log.push({
            timestamp: new Date().toISOString(),
            resolvedCount: resolved.length,
            resolvedItems: resolved
        });
        fs.writeFileSync(resolvedLogFile, JSON.stringify(log, null, 2), 'utf8');
        console.log(`    👏 Исправлено нераспознанных комментариев: ${resolved.length}. Лог: ${resolvedLogFile}`);
    }

    const totalProcessed = votesToParse.filter(v => v.withManual !== 'notPairs' && v.withManual !== 'noPairs').length;
    console.log(`  📈 ${nominationName}: Всего обработано (исключая notPairs): ${totalProcessed}`);
    console.log(`      Распознано: ${recognized.length}, не распознано: ${unrecognizedOut.length}`);
    if (unrecognizedOut.length === 0) {
        console.log(`  🎉 Отлично! Все комментарии удалось распознать. Можете праздновать! 🥳`);
    } else {
        console.log(`  😢 Ещё осталось ${unrecognizedOut.length} непокорённых комментариев. Вы можете снова отредактировать votes_with_manual.json и перезапустить меня.`);
    }
}

// ------------------------------------------------------------------
// 7. Главная функция
// ------------------------------------------------------------------
function main() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`📂 Папка ${OUTPUT_BASE} не найдена. Сначала запустите parseVotes.js.`);
        process.exit(1);
    }

    const nominations = fs.readdirSync(OUTPUT_BASE).filter(item => {
        const itemPath = path.join(OUTPUT_BASE, item);
        return fs.statSync(itemPath).isDirectory();
    });

    if (nominations.length === 0) {
        console.log(`😴 Нет папок номинаций в ${OUTPUT_BASE}. Запустите parseVotes.js.`);
        return;
    }

    console.log(`🔍 Найдено номинаций: ${nominations.length}\n`);
    for (const nom of nominations) {
        const nomPath = path.join(OUTPUT_BASE, nom);
        processNomination(nomPath, nom);
        console.log('');
    }
    console.log('🏁 Работа завершена.');
}

main();