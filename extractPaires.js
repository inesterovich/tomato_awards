const fs = require('fs');
const path = require('path');

const OUTPUT_BASE = './output';
const DASH_PATTERN = '[–—-]';

// --------------------------------------------------------------
// Вспомогательные функции
// --------------------------------------------------------------
function preprocessText(text) {
    let processed = text.replace(/ë/g, 'ё').replace(/Ë/g, 'Ё');
    processed = processed.replace(/([-–—])\n/g, '$1');
    processed = processed.replace(/\[id\d+\|([^\]]+)\]/g, '$1');
    processed = processed.replace(/@([А-ЯЁа-яё]+)/g, '$1');
    processed = processed.replace(/[ \t]+/g, ' ').trim();
    return processed;
}

function splitIntoStatements(text) {
    const normalized = preprocessText(text);
    const lines = normalized.split(/\n/);
    const result = [];
    for (let line of lines) {
        line = line.trim();
        if (line === '') continue;
        const subParts = line.split(/\d+[\.\)]\s*/);
        for (let sub of subParts) {
            sub = sub.trim();
            if (sub) result.push(sub);
        }
    }
    if (result.length === 0) result.push(normalized);
    return result;
}

function extractAllPairsFromStatement(statement) {
    const pairs = [];
    const fullPattern = new RegExp(`([А-ЯЁ][а-яё]+(?:ё)?\\s+[А-ЯЁ][а-яё]+(?:ё)?)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+(?:ё)?\\s+[А-ЯЁ][а-яё]+(?:ё)?)`, 'g');
    let match;
    while ((match = fullPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
    }
    if (pairs.length) return pairs;

    const shortPattern = new RegExp(`([А-ЯЁ][а-яё]+(?:ё)?)\\s*${DASH_PATTERN}\\s*([А-ЯЁ][а-яё]+(?:ё)?)`, 'g');
    while ((match = shortPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
    }
    if (pairs.length) return pairs;

    const twoFullNamesPattern = /([А-ЯЁ][а-яё]+(?:ё)?\s+[А-ЯЁ][а-яё]+(?:ё)?)\s+([А-ЯЁ][а-яё]+(?:ё)?\s+[А-ЯЁ][а-яё]+(?:ё)?)/g;
    while ((match = twoFullNamesPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1], pairRight: match[2] });
    }
    if (pairs.length) return pairs;

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

// --------------------------------------------------------------
// Парсинг без ручного файла (возвращает recognized и unrecognized)
// --------------------------------------------------------------
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

// --------------------------------------------------------------
// Валидация ручного файла (с юмором и строгой проверкой cleanedText)
// --------------------------------------------------------------
// Допустимые флаги
const ALLOWED_MANUAL_FLAGS = ['cleanedText', 'noPairs', 'notPairs']; // notPairs - синоним

function validateManualFile(manualData, originalVotes, prevUnrecognized) {
    // 1) Проверяем, что записи с флагами (cleanedText или noPairs) соответствуют prevUnrecognized
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
            original.originalText !== manual.text) { // в ручном файле поле text, а не originalText? надо унифицировать
            console.error(`\n📝 Изменены защищённые поля у комментария ${manual.username}. Только cleanedText можно менять (или ставить флаг noPairs). Не жульничайте! 😼`);
            return false;
        }
        // Если флаг "cleanedText" — cleanedText может быть изменён (но не обязан). Если "noPairs" — cleanedText может быть любым (даже не меняться).
        // Дополнительных проверок не нужно.
    }

    // 2) Проверяем "хорошие" комментарии (без флага) — они должны совпадать с originalVotes, исключая нераспознанные
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
        // Проверяем cleanedText: оно должно совпадать, если есть в оригинале
        if (orig.cleanedText !== man.cleanedText) {
            console.error(`\n✂️ Вы изменили cleanedText у успешно распознанного комментария. Это подозрительно! 🤡`);
            return false;
        }
    }
    return true;
}

// --------------------------------------------------------------
// Основная обработка номинации
// --------------------------------------------------------------
function processNomination(nominationPath, nominationName) {
    const votesFile = path.join(nominationPath, 'votes.json');
    const unrecognizedFile = path.join(nominationPath, 'votes_unrecognized.json');
    const manualFile = path.join(nominationPath, 'votes_with_manual.json');

    if (!fs.existsSync(votesFile)) {
        console.log(`  ${nominationName}: votes.json не найден, пропускаем`);
        return;
    }

    const originalVotes = JSON.parse(fs.readFileSync(votesFile, 'utf8'));

    // Если нет ручного файла – обычный режим
    if (!fs.existsSync(manualFile)) {
        console.log(`  ${nominationName}: 🤖 Ручного файла нет. Запускаю автоматическое распознавание...`);
        const { recognized, unrecognized } = parseVotes(originalVotes);
        fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(recognized, null, 2), 'utf8');
        fs.writeFileSync(path.join(nominationPath, 'votes_unrecognized.json'), JSON.stringify(unrecognized, null, 2), 'utf8');
        console.log(`  📊 ${nominationName}: Всего ${originalVotes.length} | ✅ Распознано: ${recognized.length} | ❌ Не распознано: ${unrecognized.length}`);
        if (unrecognized.length > 0) {
            console.log(`  💡 Совет: если хотите вручную поправить нераспознанные, скопируйте votes.json в votes_with_manual.json, найдите там нераспознанные комментарии, добавьте к ним ключ "withManual": "cleanedText" и отредактируйте поле cleanedText (добавьте туда исправленный текст). Затем запустите меня снова.`);
        }
        return;
    }

    // Ручной файл существует – валидация
    console.log(`  ${nominationName}: 🕵️‍♂️ Найден votes_with_manual.json. Проверяю честность...`);
    const manualData = JSON.parse(fs.readFileSync(manualFile, 'utf8'));

    if (!fs.existsSync(unrecognizedFile)) {
        console.error(`  ❓ А где votes_unrecognized.json? Сначала запустите скрипт без ручного файла, чтобы он создал этот файл. Потом уже правьте.`);
        return;
    }
    const prevUnrecognized = JSON.parse(fs.readFileSync(unrecognizedFile, 'utf8'));

    if (!validateManualFile(manualData, originalVotes, prevUnrecognized)) {
        console.error(`  🔥 ВАЛИДАЦИЯ ПРОВАЛЕНА! Пары не будут извлечены. Исправьте votes_with_manual.json, не жульничайте.`);
        return;
    }

    console.log(`  ✅ Валидация успешна! Вы честный человек (или просто хорошо жульничаете, но я не заметил 😜). Запускаю распознавание с учётом ваших правок.`);

    // Собираем массив для парсинга: для записей с флагом берём cleanedText как текст для парсинга, для остальных – оригинальный cleanedText или text
    const votesToParse = manualData.map(v => {
        if (v.withManual === 'cleanedText') {
            // Используем исправленный очищенный текст
            return { ...v, textForParsing: v.cleanedText };
        } else {
            return { ...v, textForParsing: v.cleanedText || v.originalText };
        }
    });

    const recognized = [];
    const unrecognizedOut = [];

    for (const vote of votesToParse) {
        if (vote.withManual === 'noPairs' || vote.withManual === 'notPairs') {
            // Игнорируем такой комментарий — не добавляем ни в recognized, ни в unrecognized
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
                originalText: vote.originalText,
                cleanedText: vote.cleanedText,
                pairs: uniquePairs,
                manualFixed: !!vote.withManual
            });
        } else {
            unrecognizedOut.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.originalText,
                cleanedText: vote.cleanedText
            });
        }
    }

    fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(recognized, null, 2), 'utf8');
    fs.writeFileSync(path.join(nominationPath, 'votes_unrecognized.json'), JSON.stringify(unrecognizedOut, null, 2), 'utf8');

    console.log(`  📈 ${nominationName}: Всего ${votesToParse.length} | ✅ Распознано: ${recognized.length} | ❌ Не распознано: ${unrecognizedOut.length}`);
    if (unrecognizedOut.length === 0) {
        console.log(`  🎉 Отлично! Все комментарии удалось распознать. Можете праздновать! 🥳`);
    } else {
        console.log(`  😢 Ещё осталось ${unrecognizedOut.length} непокорённых комментариев. Вы можете снова отредактировать votes_with_manual.json и перезапустить меня.`);
    }
}

// --------------------------------------------------------------
// Главная функция
// --------------------------------------------------------------
function main() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`📂 Папка ${OUTPUT_BASE} не найдена. Сначала запустите parseVotes.js, чтобы создать структуру.`);
        process.exit(1);
    }

    const nominations = fs.readdirSync(OUTPUT_BASE).filter(item => {
        const itemPath = path.join(OUTPUT_BASE, item);
        return fs.statSync(itemPath).isDirectory();
    });

    if (nominations.length === 0) {
        console.log(`😴 Нет папок номинаций в ${OUTPUT_BASE}. Запустите parseVotes.js, чтобы обработать сырые данные.`);
        return;
    }

    console.log(`🔍 Найдено номинаций: ${nominations.length}\n`);
    for (const nom of nominations) {
        const nomPath = path.join(OUTPUT_BASE, nom);
        processNomination(nomPath, nom);
        console.log('');
    }
    console.log('🏁 Работа завершена. Если остались нераспознанные комментарии, создайте votes_with_manual.json и поправьте cleanedText. Удачи! 🍀');
}

main();