const fs = require('fs');
const path = require('path');

const INPUT_DIR = './input';
const OUTPUT_BASE = './output';

// Удаление эмодзи (сохраняем переносы строк, плюсы, тире)
function removeEmojis(text) {
    return text.replace(/\p{Extended_Pictographic}/gu, '').trim();
}

// Проверка, является ли комментарий голосованием
function isVote(text) {
    const t = text.toLowerCase();
    const votePhrases = [
        'голосую', 'выдвигаю', 'отдаю голос', 'отдаю свой голос',
        'номинирую', 'предлагаю', 'хочу отметить', 'хотела бы отметить',
        'хотел бы отметить', 'выдвинуть', 'выбираю'
    ];
    if (votePhrases.some(p => t.includes(p))) return true;

    // Русские имена с тире
    if (/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s*[-–]\s*[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/.test(text)) return true;

    // VK-теги с тире: [id...|Имя] - [id...|Имя]
    if (/\[id\d+\|[А-ЯЁа-яё\s]+\]\s*[-–]\s*\[id\d+\|[А-ЯЁа-яё\s]+\]/.test(text)) return true;

    // Ссылка ВК + ключевые слова о танце
    if (text.includes('https://vk') && /рутин|танец|выступлени|пара|номер/i.test(text)) return true;

    return false;
}

// Проверка, является ли комментарий дополнением (только ответы)
function isAddition(text, lengthLimit = 200) {
    if (text.length > lengthLimit) return false;
    const addWords = ['добавлю ссылк', 'вот ссылка', 'ссылка на танец', 'вот танец', 'поправлю ссылку'];
    if (addWords.some(w => text.toLowerCase().includes(w))) return true;
    if (text.includes('https://vk')) return true;
    return false;
}

// Обработка одного файла номинации
function processNomination(filePath, nominationName) {
    console.log(`\nОбработка номинации: ${nominationName}`);

    let comments;
    try {
        comments = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`  Ошибка чтения файла ${filePath}: ${err.message}`);
        return;
    }

    // Добавляем очищенное поле
    for (const comment of comments) {
        comment.cleanedRawText = removeEmojis(comment.text);
    }

    // Карта ответов
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

    // Категоризация с приоритетом дополнений
    comments.forEach(c => {
        const cleaned = c.cleanedRawText;
        if (c.isReply && isAddition(cleaned)) {
            additions.push(c);
        } else if (isVote(cleaned)) {
            let text = c.text;
            const children = repliesMap.get(c.id) || [];
            const addChildren = children.filter(r => isAddition(r.cleanedRawText)).map(r => r.text.trim());
            if (addChildren.length) {
                text += '\n[дополнения: ' + addChildren.join(' | ') + ']';
            }
            votes.push({
                userId: c.userId,
                username: c.username,
                text: text,
                cleanedText: cleaned,
                timestamp: c.timestamp,
                isReply: c.isReply || false,
                parentId: c.parentId || null
            });
        } else {
            other.push(c);
        }
    });

    votes.sort((a, b) => parseInt(a.userId) - parseInt(b.userId));

    const outDir = path.join(OUTPUT_BASE, nominationName);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(path.join(outDir, 'votes.json'), JSON.stringify(votes, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'additions.json'), JSON.stringify(additions, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'other.json'), JSON.stringify(other, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(comments, null, 2), 'utf8');

    console.log(`  Всего комментариев: ${comments.length}`);
    console.log(`  Голосований: ${votes.length}`);
    console.log(`  Дополнений: ${additions.length}`);
    console.log(`  Прочих: ${other.length}`);
    console.log(`  Результаты сохранены в: ${outDir}`);
}

function main() {
    if (!fs.existsSync(INPUT_DIR)) {
        console.error(`Ошибка: входная папка "${INPUT_DIR}" не существует.`);
        process.exit(1);
    }
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log(`Нет JSON-файлов в папке "${INPUT_DIR}".`);
        return;
    }
    console.log(`Найдено ${files.length} JSON-файлов:`);
    files.forEach(f => console.log(`  - ${f}`));
    for (const file of files) {
        const nominationName = path.basename(file, '.json');
        const fullPath = path.join(INPUT_DIR, file);
        processNomination(fullPath, nominationName);
    }
    console.log('\nГотово!');
}

main();