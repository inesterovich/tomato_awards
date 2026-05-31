const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');

function removePatronymic(fullName) {
    const words = fullName.trim().split(/\s+/);
    if (words.length < 2) return fullName;
    const last = words[words.length - 1];
    if (/[ая]вич$|[ая]чна$|вна$|чна$|ич$|на$/i.test(last)) words.pop();
    return words.length === 0 ? fullName : words.join(' ');
}

function normalizeString(str) {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

class DancerDatabase {
    constructor(dbPath = './db', cachePath = './.dancer_cache.json') {
        this.dbPath = dbPath;
        this.cachePath = cachePath;
        this.dancers = [];
        this.fuseIndex = null;
    }

    load() {
        if (fs.existsSync(this.cachePath)) {
            console.log(`📦 Загрузка кэша из ${this.cachePath}...`);
            try {
                const cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
                this.dancers = cache.dancers;
                this.fuseIndex = new Fuse(this.dancers, cache.options);
                console.log(`✅ Кэш загружен. Танцоров: ${this.dancers.length}`);
                return;
            } catch (err) { console.warn(`⚠️ Кэш не работает: ${err.message}. Индексация заново.`); }
        }
        if (!fs.existsSync(this.dbPath)) throw new Error(`Папка ${this.dbPath} не найдена`);
        const files = fs.readdirSync(this.dbPath).filter(f => f.endsWith('.json'));
        if (files.length === 0) throw new Error(`Нет JSON в ${this.dbPath}`);
        const dataPath = path.join(this.dbPath, files[0]);
        const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        const dancers = [];
        for (const rec of rawData) {
            const fullName = rec.Familiya_Imya;
            if (!fullName) continue;
            const withoutPatr = removePatronymic(fullName);
            const normalized = normalizeString(withoutPatr);
            if (normalized.length < 2) continue;
            dancers.push({
                kod: rec.Kod,
                fullName: fullName,
                normalizedKey: normalized,
                gender: rec.Pol || null,
                maidenName: rec.Prezhnyaya_familiya ? normalizeString(rec.Prezhnyaya_familiya) : null,
            });
        }
        this.dancers = dancers;
        const options = {
            keys: ['normalizedKey', 'maidenName'],
            threshold: 0.3,
            distance: 100,
            ignoreLocation: true,
            useExtendedSearch: true,
            minMatchCharLength: 3
        };
        console.log(`🔄 Индексация ${this.dancers.length} танцоров...`);
        this.fuseIndex = new Fuse(this.dancers, options);
        const cacheData = { dancers: this.dancers, options };
        fs.writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2));
        console.log(`💾 Кэш сохранён.`);
    }

    searchCandidates(rawName, limit = 5) {
        if (!rawName || typeof rawName !== 'string') return [];
        const cleaned = normalizeString(removePatronymic(rawName));
        if (cleaned.length < 2) return [];
        const results = this.fuseIndex.search(cleaned, { limit });
        return results.map(r => ({
            fullName: r.item.fullName,
            gender: r.item.gender,
            score: r.score
        }));
    }

    findDancer(rawName) {
        const candidates = this.searchCandidates(rawName, 1);
        return candidates[0] || null;
    }

    /** 
     * Пытается найти разнополую пару для двух сырых имён.
     * Возвращает объект { left, right, leftGender, rightGender } или null.
     */
    findBestHeteroPair(leftRaw, rightRaw) {
        const leftCands = this.searchCandidates(leftRaw, 5);
        const rightCands = this.searchCandidates(rightRaw, 5);
        let best = null;
        let bestScore = Infinity;
        for (const l of leftCands) {
            for (const r of rightCands) {
                if (l.gender && r.gender && l.gender !== r.gender) {
                    const totalScore = (l.score || 1) + (r.score || 1);
                    if (totalScore < bestScore) {
                        bestScore = totalScore;
                        best = { left: l.fullName, right: r.fullName, leftGender: l.gender, rightGender: r.gender };
                    }
                }
            }
        }
        if (best) return best;
        // Если нет разнополых, но один из кандидатов есть, а другой — нет, пробуем подобрать противоположный пол
        if (leftCands.length && !rightCands.length) {
            const leftGender = leftCands[0].gender;
            if (leftGender) {
                const opposite = leftGender === 'м' ? 'ж' : 'м';
                const bestRight = this.searchCandidates(rightRaw, 5).find(c => c.gender === opposite);
                if (bestRight) return { left: leftCands[0].fullName, right: bestRight.fullName, leftGender, rightGender: opposite };
            }
        }
        if (rightCands.length && !leftCands.length) {
            const rightGender = rightCands[0].gender;
            if (rightGender) {
                const opposite = rightGender === 'м' ? 'ж' : 'м';
                const bestLeft = this.searchCandidates(leftRaw, 5).find(c => c.gender === opposite);
                if (bestLeft) return { left: bestLeft.fullName, right: rightCands[0].fullName, leftGender: opposite, rightGender };
            }
        }
        return null;
    }
}

module.exports = DancerDatabase;