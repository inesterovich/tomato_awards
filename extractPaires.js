const fs = require('fs');
const path = require('path');
const {
    buildSurnameMap,
    splitIntoStatements,
    extractAllPairsFromStatement
} = require('./pairNormalizer.js');

const OUTPUT_BASE = './output';
const ALLOWED_MANUAL_FLAGS = ['cleanedText', 'noPairs', 'notPairs'];

// ------------------------------------------------------------------
// Парсинг без ручного файла
// ------------------------------------------------------------------
function parseVotes(votes, surnameMap) {
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
// Валидация ручного файла
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
    }

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
// Основная обработка номинации
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
    const surnameMap = buildSurnameMap(originalVotes);
    // сохраняем карту для отладки
    fs.writeFileSync(path.join(nominationPath, 'surname_map.json'), JSON.stringify(
        Object.fromEntries([...surnameMap.entries()].map(([k, v]) => [k, { mostFrequent: v.mostFrequent, variants: [...v.variants.keys()] }])),
        null, 2), 'utf8');

    // --- Режим без ручного файла ---
    if (!fs.existsSync(manualFile)) {
        console.log(`  ${nominationName}: 🤖 Ручного файла нет. Запускаю автоматическое распознавание...`);
        const { recognized, unrecognized } = parseVotes(originalVotes, surnameMap);
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

    // Подготовка данных (для notPairs текст не важен)
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

    // --- Сохранение истории и лога решённых ---
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
// Главная функция
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