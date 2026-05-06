/* ── db.js — NutriTrack IndexedDB layer ── */
'use strict';

const DB_NAME = 'nutritrack';
const DB_VERSION = 1;

let _db = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('food_log')) {
                const fl = db.createObjectStore('food_log', { keyPath: 'id', autoIncrement: true });
                fl.createIndex('date', 'date', { unique: false });
            }
            if (!db.objectStoreNames.contains('water_log')) {
                db.createObjectStore('water_log', { keyPath: 'date' });
            }
            if (!db.objectStoreNames.contains('weight_log')) {
                db.createObjectStore('weight_log', { keyPath: 'date' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('meal_plan')) {
                const mp = db.createObjectStore('meal_plan', { keyPath: 'id', autoIncrement: true });
                mp.createIndex('date', 'date', { unique: false });
            }
            if (!db.objectStoreNames.contains('shop_items')) {
                db.createObjectStore('shop_items', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('expenses')) {
                const ex = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
                ex.createIndex('date', 'date', { unique: false });
            }
        };
        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror = e => reject(e.target.error);
    });
}

function txGet(store, key) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function txGetAll(store) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function txGetByIndex(store, indexName, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly')
            .objectStore(store).index(indexName).getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function txPut(store, obj) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function txAdd(store, obj) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).add(obj);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function txDelete(store, key) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

// ── Settings ────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    id: 1,
    name: '', age: 0, gender: '', activity_level: 'moderate',
    goal_type: 'maintain', onboarding_done: 0,
    calorie_goal: 2100, protein_goal: 90, carbs_goal: 250, fat_goal: 65,
    water_goal: 10, steps_goal: 8000, height_cm: 170, weight_kg: 70, target_weight: 0,
    groq_api_key: ''
};

const DB = {
    // ── Settings ──────────────────────────────────────────
    async getSettings() {
        const s = await txGet('settings', 1);
        return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
    },

    async saveSettings(data) {
        const current = await this.getSettings();
        await txPut('settings', { ...current, ...data, id: 1 });
        return this.getSettings();
    },

    // ── Food log ──────────────────────────────────────────
    async addFood(entry) {
        const id = await txAdd('food_log', entry);
        return { ...entry, id };
    },

    async deleteFood(id) {
        await txDelete('food_log', id);
    },

    async getFoodsByDate(date) {
        const rows = await txGetByIndex('food_log', 'date', date);
        return rows.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    },

    async getAllFoods() {
        return txGetAll('food_log');
    },

    async getDailySummary(date) {
        const foods = await this.getFoodsByDate(date);
        const water = await txGet('water_log', date);
        const totals = foods.reduce((acc, f) => ({
            calories: acc.calories + (f.calories || 0),
            protein_g: acc.protein_g + (f.protein_g || 0),
            carbs_g: acc.carbs_g + (f.carbs_g || 0),
            fat_g: acc.fat_g + (f.fat_g || 0),
        }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
        totals.protein_g = Math.round(totals.protein_g * 10) / 10;
        totals.carbs_g = Math.round(totals.carbs_g * 10) / 10;
        totals.fat_g = Math.round(totals.fat_g * 10) / 10;
        totals.water_glasses = water ? water.glasses : 0;
        return { totals, foods };
    },

    // ── Water ─────────────────────────────────────────────
    async logWater(date) {
        const rec = await txGet('water_log', date) || { date, glasses: 0 };
        rec.glasses = Math.min(rec.glasses + 1, 20);
        await txPut('water_log', rec);
        return rec.glasses;
    },

    async resetWater(date) {
        await txPut('water_log', { date, glasses: 0 });
        return 0;
    },

    async setWater(date, glasses) {
        const clamped = Math.max(0, Math.min(glasses, 20));
        await txPut('water_log', { date, glasses: clamped });
        return clamped;
    },

    // ── Weight ────────────────────────────────────────────
    async logWeight(date, weight_kg, notes) {
        await txPut('weight_log', { date, weight_kg, notes: notes || '' });
    },

    async deleteWeight(date) {
        await txDelete('weight_log', date);
    },

    async getWeightHistory() {
        const rows = await txGetAll('weight_log');
        const entries = rows.sort((a, b) => b.date.localeCompare(a.date)); // newest first
        const change_kg = entries.length >= 2
            ? Math.round((entries[0].weight_kg - entries[entries.length - 1].weight_kg) * 10) / 10
            : 0;
        return { entries, change_kg };
    },

    // ── Streak ────────────────────────────────────────────
    async getStreak() {
        const all = await txGetAll('food_log');
        const dates = [...new Set(all.map(f => f.date))].sort();
        if (!dates.length) return { streak: 0, longest: 0 };
        const today = new Date().toISOString().slice(0, 10);
        let streak = 0;
        let check = today;
        while (dates.includes(check)) {
            streak++;
            const d = new Date(check + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            check = d.toISOString().slice(0, 10);
        }
        // Calculate longest streak
        let longest = 0, cur = 1;
        for (let i = 1; i < dates.length; i++) {
            const prev = new Date(dates[i - 1] + 'T00:00:00');
            prev.setDate(prev.getDate() + 1);
            if (prev.toISOString().slice(0, 10) === dates[i]) { cur++; }
            else { cur = 1; }
            if (cur > longest) longest = cur;
        }
        if (dates.length === 1) longest = 1;
        return { streak, longest: Math.max(streak, longest) };
    },

    // ── History ───────────────────────────────────────────
    async getHistory(days = 30) {
        const all = await txGetAll('food_log');
        const dateMap = {};
        all.forEach(f => {
            if (!dateMap[f.date]) dateMap[f.date] = { date: f.date, foods: [], calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
            dateMap[f.date].foods.push(f);
            dateMap[f.date].calories += f.calories || 0;
            dateMap[f.date].protein_g += f.protein_g || 0;
            dateMap[f.date].carbs_g += f.carbs_g || 0;
            dateMap[f.date].fat_g += f.fat_g || 0;
        });
        const history = Object.values(dateMap)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, days)
            .map(d => ({ date: d.date, total_calories: Math.round(d.calories), total_protein: Math.round(d.protein_g * 10) / 10, meal_count: d.foods.length }));
        return { history };
    },

    async getCalorieTrend(days = 14) {
        const all = await txGetAll('food_log');
        const dateMap = {};
        all.forEach(f => {
            dateMap[f.date] = (dateMap[f.date] || 0) + (f.calories || 0);
        });
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const ds = d.toISOString().slice(0, 10);
            result.push({ date: ds, calories: ds in dateMap ? dateMap[ds] : null });
        }
        return result;
    },

    // ── Meal Plan ─────────────────────────────────────────
    async getMealPlan(weekStart) {
        const all = await txGetAll('meal_plan');
        let plans = all;
        if (weekStart) {
            const start = new Date(weekStart + 'T00:00:00');
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            const endStr = end.toISOString().slice(0, 10);
            plans = all.filter(p => p.date >= weekStart && p.date < endStr);
        }
        return { week_start: weekStart || new Date().toISOString().slice(0, 10), plans };
    },

    async getTodayMealPlan() {
        const today = new Date().toISOString().slice(0, 10);
        return txGetByIndex('meal_plan', 'date', today);
    },

    async addMealPlan(entry) {
        const id = await txAdd('meal_plan', entry);
        return { ...entry, id };
    },

    async deleteMealPlan(id) {
        await txDelete('meal_plan', id);
    },

    // ── Shop items ────────────────────────────────────────
    async getShopItems() {
        return txGetAll('shop_items');
    },

    async addShopItem(item) {
        const id = await txAdd('shop_items', item);
        return { ...item, id };
    },

    async updateShopItem(id, patch) {
        const item = await txGet('shop_items', id);
        if (!item) return;
        await txPut('shop_items', { ...item, ...patch });
    },

    async deleteShopItem(id) {
        await txDelete('shop_items', id);
    },

    async deleteCheckedShopItems() {
        const all = await txGetAll('shop_items');
        for (const item of all) {
            if (item.checked) await txDelete('shop_items', item.id);
        }
    },

    // ── Expenses ──────────────────────────────────────────
    async getExpenses(filters = {}) {
        let rows = await txGetAll('expenses');
        if (filters.month) rows = rows.filter(e => e.date && e.date.startsWith(filters.month));
        if (filters.category && filters.category !== 'all') rows = rows.filter(e => e.category === filters.category);
        if (filters.q) {
            const q = filters.q.toLowerCase();
            rows = rows.filter(e =>
                (e.description || '').toLowerCase().includes(q) ||
                (e.note || '').toLowerCase().includes(q) ||
                String(e.amount || '').includes(q)
            );
        }
        return rows.sort((a, b) => b.date.localeCompare(a.date));
    },

    async addExpense(entry) {
        const id = await txAdd('expenses', entry);
        return { ...entry, id };
    },

    async updateExpense(id, patch) {
        const e = await txGet('expenses', id);
        if (!e) return;
        await txPut('expenses', { ...e, ...patch });
    },

    async deleteExpense(id) {
        await txDelete('expenses', id);
    },

    async getExpenseSummary(month) {
        const rows = await this.getExpenses({ month });
        const total = rows.reduce((s, e) => s + (e.amount || 0), 0);
        const byCategory = {};
        rows.forEach(e => {
            byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
        });
        return { total: Math.round(total * 100) / 100, by_category: byCategory, count: rows.length };
    },

    // ── Export CSV ────────────────────────────────────────
    async exportFoodsCSV() {
        const rows = await txGetAll('food_log');
        const headers = ['date', 'time', 'meal_type', 'description', 'calories', 'protein_g', 'carbs_g', 'fat_g'];
        const lines = [headers.join(',')];
        rows.sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
            lines.push(headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
        });
        return lines.join('\n');
    },

    // ── Full Backup / Restore ─────────────────────────────
    async exportAll() {
        const stores = ['food_log', 'water_log', 'weight_log', 'settings', 'meal_plan', 'shop_items', 'expenses'];
        const backup = { version: 1, exported_at: new Date().toISOString() };
        for (const s of stores) backup[s] = await txGetAll(s);
        return backup;
    },

    async importAll(backup) {
        if (!backup || backup.version !== 1) throw new Error('Invalid backup file');
        const db = await openDB();
        const stores = ['food_log', 'water_log', 'weight_log', 'settings', 'meal_plan', 'shop_items', 'expenses'];
        for (const s of stores) {
            if (!backup[s]) continue;
            await new Promise((res, rej) => {
                const tx = db.transaction(s, 'readwrite');
                const store = tx.objectStore(s);
                store.clear();
                backup[s].forEach(row => store.put(row));
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });
        }
    },
};
