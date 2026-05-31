const fs = require('fs');
const path = require('path');
const DancerDatabase = require('./dancerDatabase');
const { splitIntoStatements, extractAllPairsFromStatement, buildSurnameMap, normalizePair } = require('./pairNormalizer.js');

const OUTPUT_BASE = './output';
const DB_PATH = './db';

function showProgress(current, total, prefix = 'Обработка') {
    const percent = ((current / total) * 100).toFixed(1);
    const filled = Math.floor(40 * current / total);
    const empty = 40 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    process.stdout.write(`\r${prefix}: [${bar}] ${percent}% (${current}/${total})`);
    if (current === total) process.stdout.write('\n');
}

function formatCanonical(fullName1, fullName2) {
    const getLastName = s => s.split(' ').pop().toLowerCase();
    let left = fullName1, right = fullName2;
    if (getLastName(left) > getLastName(right)) [left, right] = [right, left];
    return `${left} - ${right}`;
}

// Гибридное распознавание всех голосов
function parseAllVotes(votes, db, surnameMap, onProgress) {
    const results = [];          // нормальные распознанные пары
    const unrecognizedIndices = [];
    const suspicious = [];       // подозрительные комментарии (есть пары, но с сомнениями)

    for (let i = 0; i < votes.length; i++) {
        if (onProgress) onProgress(i+1, votes.length);
        const vote = votes[i];
        const textForParsing = vote.cleanedText || vote.text;
        const statements = splitIntoStatements(textForParsing);
        let allPairsRaw = [];
        for (const stmt of statements) {
            const pairs = extractAllPairsFromStatement(stmt);
            allPairsRaw.push(...pairs);
        }
        const uniquePairsRaw = [];
        const seen = new Set();
        for (const p of allPairsRaw) {
            if (!seen.has(p.pairRaw)) {
                seen.add(p.pairRaw);
                uniquePairsRaw.push(p);
            }
        }

        const finalPairs = [];
        let hasAnyPair = false;
        let commentSuspicious = false;

        for (const p of uniquePairsRaw) {
            // 1. Пытаемся через базу с проверкой пола
            const hetero = db.findBestHeteroPair(p.pairLeft, p.pairRight);
            if (hetero) {
                finalPairs.push({
                    canonical: formatCanonical(hetero.left, hetero.right),
                    raw: p.pairRaw,
                    pairLeft: p.pairLeft,
                    pairRight: p.pairRight,
                    confidence: 'high'
                });
                hasAnyPair = true;
                continue;
            }
            // 2. Используем старую нормализацию (через surnameMap)
            const oldCanonical = normalizePair(p.pairLeft, p.pairRight, surnameMap);
            if (oldCanonical) {
                // Проверяем, нет ли в базе обоих участников и одинакового пола
                const [name1, name2] = oldCanonical.split(' - ');
                const dancer1 = db.findDancer(name1);
                const dancer2 = db.findDancer(name2);
                if (dancer1 && dancer2 && dancer1.gender === dancer2.gender) {
                    // подозрительная однополая пара
                    commentSuspicious = true;
                    suspicious.push({
                        comment: vote,
                        extractedPairs: [{ raw: oldCanonical, reason: 'same_gender_old_norm' }]
                    });
                    continue;
                }
                finalPairs.push({
                    canonical: oldCanonical,
                    raw: p.pairRaw,
                    pairLeft: p.pairLeft,
                    pairRight: p.pairRight,
                    confidence: 'medium'
                });
                hasAnyPair = true;
            } else {
                // Не распознано вообще
                commentSuspicious = true;
                suspicious.push({
                    comment: vote,
                    extractedPairs: [{ raw: p.pairRaw, reason: 'no_match' }]
                });
            }
        }

        if (hasAnyPair && !commentSuspicious) {
            results.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.text,
                cleanedText: vote.cleanedText || null,
                pairs: finalPairs
            });
        } else if (!hasAnyPair) {
            unrecognizedIndices.push(i);
        } else if (commentSuspicious && hasAnyPair) {
            // есть и нормальные пары, и подозрительные — нормальные всё равно сохраняем
            results.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.text,
                cleanedText: vote.cleanedText || null,
                pairs: finalPairs
            });
        }
    }
    return { results, unrecognizedIndices, suspicious };
}

function processAuto(nominationPath, nominationName, db) {
    const votesFile = path.join(nominationPath, 'votes.json');
    if (!fs.existsSync(votesFile)) {
        console.log(`  ${nominationName}: votes.json не найден`);
        return;
    }
    const originalVotes = JSON.parse(fs.readFileSync(votesFile, 'utf8'));
    console.log(`  ${nominationName}: Автоматическое распознавание (${originalVotes.length} голосов)...`);
    
    const surnameMap = buildSurnameMap(originalVotes);
    const { results, unrecognizedIndices, suspicious } = parseAllVotes(originalVotes, db, surnameMap, (cur,total) => showProgress(cur,total,`    ${nominationName}`));
    
    // Сохраняем votes_with_pairs.json (результаты)
    fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(results, null, 2));
    
    // Список уникальных канонических пар
    const allCanonical = new Set();
    results.forEach(v => v.pairs.forEach(p => allCanonical.add(p.canonical)));
    fs.writeFileSync(path.join(nominationPath, 'recognized_pairs_summary.json'), JSON.stringify(Array.from(allCanonical).sort(), null, 2));
    
    // Шаблон для ручной правки (полная копия votes.json, у нераспознанных добавляем withManual: null)
    const template = originalVotes.map((vote, idx) => {
        if (unrecognizedIndices.includes(idx)) {
            return { ...vote, withManual: null };
        }
        return { ...vote };
    });
    fs.writeFileSync(path.join(nominationPath, 'votes_with_manual_template.json'), JSON.stringify(template, null, 2));
    
    // Единый статистический файл со всеми проблемными комментариями (нераспознанные + подозрительные)
    const stats = [];
    for (const idx of unrecognizedIndices) {
        stats.push({
            ...originalVotes[idx],
            issueType: 'unrecognized',
            extractedPairs: []
        });
    }
    for (const susp of suspicious) {
        stats.push({
            ...susp.comment,
            issueType: 'suspicious',
            extractedPairs: susp.extractedPairs
        });
    }
    if (stats.length) {
        fs.writeFileSync(path.join(nominationPath, 'stats_needing_attention.json'), JSON.stringify(stats, null, 2));
        console.log(`  📊 Проблемные комментарии (для статистики): ${stats.length} — сохранены в stats_needing_attention.json`);
    } else {
        const oldStats = path.join(nominationPath, 'stats_needing_attention.json');
        if (fs.existsSync(oldStats)) fs.unlinkSync(oldStats);
    }
    
    console.log(`\n  ✅ Распознано: ${results.length} | ❌ Не распознано (нет пар): ${unrecognizedIndices.length} | ⚠️ Подозрительных: ${suspicious.length}`);
    if (unrecognizedIndices.length) {
        console.log(`  📄 Шаблон для ручной правки: ${path.join(nominationPath, 'votes_with_manual_template.json')}`);
        console.log(`     Отредактируйте его, затем переименуйте в votes_with_manual.json и перезапустите скрипт.`);
    }
}

function processWithManual(nominationPath, nominationName, db) {
    const manualFile = path.join(nominationPath, 'votes_with_manual.json');
    if (!fs.existsSync(manualFile)) return false;
    console.log(`  ${nominationName}: 🕵️ Обработка ручного файла votes_with_manual.json`);
    const manualData = JSON.parse(fs.readFileSync(manualFile, 'utf8'));
    const surnameMap = buildSurnameMap(manualData);
    const results = [];
    for (const vote of manualData) {
        if (vote.withManual === 'notPairs' || vote.withManual === 'noPairs') continue;
        let textForParsing = vote.cleanedText || vote.text;
        if (vote.withManual === 'cleanedText' && vote.cleanedText) textForParsing = vote.cleanedText;
        const statements = splitIntoStatements(textForParsing);
        let allPairsRaw = [];
        for (const stmt of statements) {
            const pairs = extractAllPairsFromStatement(stmt);
            allPairsRaw.push(...pairs);
        }
        const uniquePairsRaw = [];
        const seen = new Set();
        for (const p of allPairsRaw) {
            if (!seen.has(p.pairRaw)) {
                seen.add(p.pairRaw);
                uniquePairsRaw.push(p);
            }
        }
        const finalPairs = [];
        for (const p of uniquePairsRaw) {
            const hetero = db.findBestHeteroPair(p.pairLeft, p.pairRight);
            if (hetero) {
                finalPairs.push({
                    canonical: formatCanonical(hetero.left, hetero.right),
                    raw: p.pairRaw,
                    confidence: 'high'
                });
            } else {
                const oldCanonical = normalizePair(p.pairLeft, p.pairRight, surnameMap);
                if (oldCanonical) finalPairs.push({
                    canonical: oldCanonical,
                    raw: p.pairRaw,
                    confidence: 'medium'
                });
            }
        }
        if (finalPairs.length) {
            results.push({
                userId: vote.userId,
                username: vote.username,
                timestamp: vote.timestamp,
                originalText: vote.text,
                cleanedText: vote.cleanedText || null,
                pairs: finalPairs,
                manualFixed: !!vote.withManual
            });
        }
    }
    fs.writeFileSync(path.join(nominationPath, 'votes_with_pairs.json'), JSON.stringify(results, null, 2));
    const allCanonical = new Set();
    results.forEach(v => v.pairs.forEach(p => allCanonical.add(p.canonical)));
    fs.writeFileSync(path.join(nominationPath, 'recognized_pairs_summary.json'), JSON.stringify(Array.from(allCanonical).sort(), null, 2));
    console.log(`  ✅ После ручных правок: распознано ${results.length} записей, ${allCanonical.size} уникальных пар.`);
    return true;
}

async function main() {
    if (!fs.existsSync(OUTPUT_BASE)) {
        console.error(`Папка ${OUTPUT_BASE} не найдена. Сначала запустите parseVotes.js`);
        process.exit(1);
    }
    console.log('🔄 Загрузка базы танцоров...');
    const db = new DancerDatabase(DB_PATH);
    try {
        db.load();
    } catch (err) {
        console.error(`❌ Ошибка загрузки базы: ${err.message}`);
        process.exit(1);
    }
    const nominations = fs.readdirSync(OUTPUT_BASE).filter(item => {
        const itemPath = path.join(OUTPUT_BASE, item);
        return fs.statSync(itemPath).isDirectory();
    });
    console.log(`🔍 Найдено номинаций: ${nominations.length}\n`);
    for (const nom of nominations) {
        const nomPath = path.join(OUTPUT_BASE, nom);
        const handled = processWithManual(nomPath, nom, db);
        if (!handled) processAuto(nomPath, nom, db);
        console.log('');
    }
    console.log('🏁 Готово.');
}

main();