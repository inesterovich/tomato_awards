const DASH_PATTERN = '[–—-]';
const STOP_WORDS = [
    'командное', 'первенство', 'чемпионат', 'россии', 'года',
    'конкурс', 'турнир', 'номер', 'рутина', 'танец', 'выступление', 'номинация'
];

function extractFullNames(text) {
    if (!text || typeof text !== 'string') return new Set();
    const pattern = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/g;
    const names = new Set();
    let match;
    while ((match = pattern.exec(text)) !== null) {
        names.add(`${match[1]} ${match[2]}`);
        names.add(`${match[2]} ${match[1]}`);
    }
    return names;
}

function buildSurnameMap(votesData) {
    const surnameStats = new Map();

    const updateStats = (fullName) => {
        const words = fullName.split(' ');
        if (words.length < 2) return;
        const surname = words[words.length - 1].toLowerCase();
        if (!surnameStats.has(surname)) {
            surnameStats.set(surname, { variants: new Map(), mostFrequent: fullName });
        }
        const entry = surnameStats.get(surname);
        const count = (entry.variants.get(fullName) || 0) + 1;
        entry.variants.set(fullName, count);
        if (count > (entry.variants.get(entry.mostFrequent) || 0)) {
            entry.mostFrequent = fullName;
        }
    };

    for (const vote of votesData) {
        // Поле text (оригинал) или originalText
        const originalText = vote.text || vote.originalText;
        if (originalText && typeof originalText === 'string') {
            const names = extractFullNames(originalText);
            for (const fullName of names) updateStats(fullName);
        }
        // Очищенный текст
        if (vote.cleanedText && typeof vote.cleanedText === 'string') {
            const names = extractFullNames(vote.cleanedText);
            for (const fullName of names) updateStats(fullName);
        }
        // Уже извлечённые пары (если есть)
        if (vote.pairs && Array.isArray(vote.pairs)) {
            for (const p of vote.pairs) {
                if (p.pairLeft && typeof p.pairLeft === 'string') {
                    const names = extractFullNames(p.pairLeft);
                    for (const fullName of names) updateStats(fullName);
                }
                if (p.pairRight && typeof p.pairRight === 'string') {
                    const names = extractFullNames(p.pairRight);
                    for (const fullName of names) updateStats(fullName);
                }
            }
        }
    }
    return surnameStats;
}

function normalizeSide(side, surnameMap) {
    const trimmed = side.trim();
    const words = trimmed.split(/\s+/);
    if (words.length === 1) {
        const lower = words[0].toLowerCase();
        if (surnameMap.has(lower)) {
            return surnameMap.get(lower).mostFrequent;
        }
        return trimmed;
    } else {
        const lastWord = words[words.length - 1].toLowerCase();
        const firstWord = words[0].toLowerCase();
        let surnameKey = null;
        if (surnameMap.has(lastWord)) surnameKey = lastWord;
        else if (surnameMap.has(firstWord)) surnameKey = firstWord;
        else return trimmed;

        const entry = surnameMap.get(surnameKey);
        for (let [fullName] of entry.variants.entries()) {
            const candidateName = fullName.split(' ')[0];
            if (candidateName === words[0]) {
                return fullName;
            }
        }
        return entry.mostFrequent;
    }
}

function normalizePair(pairLeft, pairRight, surnameMap) {
    let leftNorm = normalizeSide(pairLeft, surnameMap);
    let rightNorm = normalizeSide(pairRight, surnameMap);
    const getSurname = (name) => name.split(' ').pop().toLowerCase();
    if (getSurname(leftNorm) > getSurname(rightNorm)) {
        [leftNorm, rightNorm] = [rightNorm, leftNorm];
    }
    return `${leftNorm} - ${rightNorm}`;
}

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
        const name1 = match[1];
        const name2 = match[2];
        const allWords = name1.split(' ').concat(name2.split(' ')).map(w => w.toLowerCase());
        if (allWords.some(w => STOP_WORDS.includes(w))) continue;
        pairs.push({ pairRaw: `${name1} - ${name2}`, pairLeft: name1, pairRight: name2 });
    }
    if (pairs.length) return pairs;

    const vkTagPattern = /\[id\d+\|([^\]]+)\]\s*[-–]\s*\[id\d+\|([^\]]+)\]/g;
    while ((match = vkTagPattern.exec(statement)) !== null) {
        pairs.push({ pairRaw: `${match[1]} - ${match[2]}`, pairLeft: match[1].trim(), pairRight: match[2].trim() });
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

function serializeSurnameMap(surnameMap) {
    const obj = {};
    for (const [surname, data] of surnameMap.entries()) {
        obj[surname] = {
            mostFrequent: data.mostFrequent,
            variants: Array.from(data.variants.keys())
        };
    }
    return obj;
}

module.exports = {
    extractFullNames,
    buildSurnameMap,
    normalizeSide,
    normalizePair,
    preprocessText,
    splitIntoStatements,
    extractAllPairsFromStatement,
    serializeSurnameMap,
    DASH_PATTERN,
    STOP_WORDS
};