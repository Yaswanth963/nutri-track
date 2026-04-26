/* ── app.js — NutriTrack frontend logic ── */

'use strict';

// ── Utility ──────────────────────────────────────────────
function toLocalDateStr(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function ri() {
    if (window.lucide) lucide.createIcons();
}

// ── App settings cache ────────────────────────────────────
let _settings = {
    name: '', age: 0, gender: '', activity_level: 'moderate',
    goal_type: 'maintain', onboarding_done: 0,
    calorie_goal: 2100, protein_goal: 90, carbs_goal: 250, fat_goal: 65,
    water_goal: 10, height_cm: 170, target_weight: 0
};

async function fetchSettings() {
    try {
        _settings = await DB.getSettings();
        const calGoalEl = document.getElementById('lbl-cal-goal');
        const protGoalEl = document.getElementById('lbl-protein-goal');
        const waterGoalEl = document.getElementById('water-goal-lbl');
        if (calGoalEl) calGoalEl.textContent = 'Target: ' + _settings.calorie_goal + ' kcal';
        if (protGoalEl) protGoalEl.textContent = 'Target: ' + _settings.protein_goal + 'g';
        if (waterGoalEl) waterGoalEl.textContent = _settings.water_goal;
        updateHeaderProfile();
    } catch (e) { console.error('fetchSettings:', e); }
}

function updateHeaderProfile() {
    const greetEl = document.getElementById('header-greeting');
    if (!greetEl) return;
    const hour = new Date().getHours();
    const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = _settings.name ? `, ${_settings.name}` : '';
    greetEl.textContent = `${timeGreet}${name}!`;
}

// ── TDEE / Recommendation calculator ─────────────────────
function calcRecommendedCalories(weight_kg, height_cm, age, gender, activity_level, goal_type) {
    if (!weight_kg || !height_cm || !age) return 2000;
    const bmr = gender === 'female'
        ? 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
        : 10 * weight_kg + 6.25 * height_cm - 5 * age + 5;
    const mult = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
    const tdee = bmr * (mult[activity_level] || 1.55);
    const adj = { lose: -500, maintain: 0, gain: 300 };
    return Math.max(1000, Math.round(tdee + (adj[goal_type] || 0)));
}

function calcRecommendedProtein(weight_kg, goal_type) {
    if (!weight_kg) return 90;
    const ratio = { lose: 1.2, maintain: 0.9, gain: 1.6 };
    return Math.round(weight_kg * (ratio[goal_type] || 0.9));
}

// ── Onboarding Wizard ─────────────────────────────────────
let _obStep = 1;
let _obGender = '';
let _obActivity = 'moderate';
let _obGoal = 'maintain';
let _obWeight = 0;
let _obDiet = 'veg';

function showOnboarding() {
    document.getElementById('onboarding').classList.remove('hidden');
    setObStep(1);
    ri();
}

function hideOnboarding() {
    document.getElementById('onboarding').classList.add('hidden');
}

function setObStep(n) {
    _obStep = n;
    // Update panels
    document.querySelectorAll('.ob-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('ob-' + n);
    if (panel) panel.classList.add('active');
    // Update step dots
    document.querySelectorAll('.ob-step').forEach(s => {
        const sn = parseInt(s.dataset.step);
        s.classList.toggle('active', sn === n);
        s.classList.toggle('done', sn < n);
    });
    document.querySelectorAll('.ob-step-line').forEach((l, i) => {
        l.classList.toggle('done', i + 1 < n);
    });
    // Update recommendation on step 3
    if (n === 3) updateObRecommendation();
    ri();
}

function obSelectChip(group, val) {
    document.querySelectorAll(`[data-ob-group="${group}"]`).forEach(c => c.classList.remove('selected'));
    const selected = document.querySelector(`[data-ob-group="${group}"][data-val="${val}"]`);
    if (selected) selected.classList.add('selected');
    if (group === 'gender') _obGender = val;
    if (group === 'activity') { _obActivity = val; updateObRecommendation(); }
    if (group === 'goal') { _obGoal = val; updateObRecommendation(); }
    if (group === 'diet') _obDiet = val;
}

function updateObRecommendation() {
    const recEl = document.getElementById('ob-recommendation');
    if (!recEl) return;
    const w = parseFloat(document.getElementById('ob-weight').value) || 0;
    const h = parseFloat(document.getElementById('ob-height').value) || 0;
    _obWeight = w;
    const calRec = calcRecommendedCalories(w, h, parseInt(document.getElementById('ob-age').value) || 25, _obGender, _obActivity, _obGoal);
    const protRec = calcRecommendedProtein(w, _obGoal);
    const goalLabels = { lose: 'Lose Weight', maintain: 'Maintain', gain: 'Gain Muscle' };
    recEl.innerHTML = `Based on your profile, we recommend:<br>
        <strong>${calRec} kcal/day</strong> · <strong>${protRec}g protein/day</strong><br>
        <span style="font-size:0.78rem;opacity:0.8">Goal: ${goalLabels[_obGoal] || 'Maintain'} · ${['sedentary','light','moderate','active','very_active'].includes(_obActivity) ? _obActivity.replace('_',' ') : 'moderate'} activity</span>`;
    document.getElementById('ob-cal-override').placeholder = calRec;
    document.getElementById('ob-protein-override').placeholder = protRec;
}

async function obNext(fromStep) {
    if (fromStep === 1) {
        const name = document.getElementById('ob-name').value.trim();
        const age = parseInt(document.getElementById('ob-age').value);
        if (!name) { showToast('warn', 'Name required', 'Please enter your name.'); return; }
        if (!age || age < 10 || age > 100) { showToast('warn', 'Valid age required', 'Enter age between 10–100.'); return; }
        if (!_obGender) { showToast('warn', 'Select gender', 'Please select your gender.'); return; }
        setObStep(2);
    } else if (fromStep === 2) {
        const h = parseFloat(document.getElementById('ob-height').value);
        const w = parseFloat(document.getElementById('ob-weight').value);
        if (!h || h < 50 || h > 250) { showToast('warn', 'Valid height required', 'Enter height between 50–250 cm.'); return; }
        if (!w || w < 20 || w > 300) { showToast('warn', 'Valid weight required', 'Enter weight between 20–300 kg.'); return; }
        setObStep(3);
    }
}

async function obFinish() {
    const name = document.getElementById('ob-name').value.trim();
    const age = parseInt(document.getElementById('ob-age').value);
    const height_cm = parseFloat(document.getElementById('ob-height').value);
    const weight_kg = parseFloat(document.getElementById('ob-weight').value);
    const calRec = calcRecommendedCalories(weight_kg, height_cm, age, _obGender, _obActivity, _obGoal);
    const protRec = calcRecommendedProtein(weight_kg, _obGoal);
    const calGoal = parseInt(document.getElementById('ob-cal-override').value) || calRec;
    const protGoal = parseInt(document.getElementById('ob-protein-override').value) || protRec;

    const payload = {
        name, age, gender: _obGender,
        activity_level: _obActivity, goal_type: _obGoal,
        diet_type: _obDiet,
        height_cm, calorie_goal: calGoal, protein_goal: protGoal,
        water_goal: 10, onboarding_done: 1
    };

    // Save weight entry
    if (weight_kg) {
        await DB.logWeight(toLocalDateStr(new Date()), weight_kg, '');
    }

    await DB.saveSettings(payload);
    hideOnboarding();
    await fetchSettings();
    loadDailySummary();
    loadStreak();
    loadTodayPlan();
    showToast('success', `Welcome, ${name}!`, `Your goals are set: ${calGoal} kcal · ${protGoal}g protein/day`);
}

// ── Tab scroll arrows ────────────────────────────────────
function scrollTabs(dir) {
    const el = document.getElementById('tabs-scroll');
    if (!el) return;
    el.scrollBy({ left: dir * 120, behavior: 'smooth' });
    setTimeout(updateTabArrows, 300);
}
function updateTabArrows() {
    const el = document.getElementById('tabs-scroll');
    const left = document.getElementById('tab-arrow-left');
    const right = document.getElementById('tab-arrow-right');
    if (!el || !left || !right) return;
    left.classList.toggle('hidden', el.scrollLeft <= 2);
    right.classList.toggle('hidden', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
}

// ── Track date strip ─────────────────────────────────────
let _trackDate = toLocalDateStr(new Date());
let _pastEditMode = false;

function buildDateStrip() {
    const strip = document.getElementById('track-date-strip');
    if (!strip) return;
    const today = toLocalDateStr(new Date());
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push(toLocalDateStr(d));
    }
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    strip.innerHTML = days.map(ds => {
        const d = new Date(ds + 'T00:00:00');
        const isToday = ds === today;
        const isActive = ds === _trackDate;
        const dayName = isToday ? 'Today' : DAY_NAMES[d.getDay()];
        const dayNum = d.getDate();
        const monthName = MONTH_NAMES[d.getMonth()];
        return `<button class="track-date-chip${isActive ? ' active' : ''}" onclick="selectTrackDate('${ds}')">
            <span class="tdc-month">${monthName}</span>
            <span class="tdc-num">${dayNum}</span>
            <span class="tdc-day">${dayName}</span>
        </button>`;
    }).join('');
    // Scroll active (today on load) into view after render
    requestAnimationFrame(() => {
        const active = strip.querySelector('.track-date-chip.active');
        if (active) active.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    });
}

function selectTrackDate(dateStr) {
    _trackDate = dateStr;
    _pastEditMode = false;
    buildDateStrip();
    loadDailySummary();
    const picker = document.getElementById('track-date-picker');
    if (picker) picker.value = dateStr;
}

function jumpToDate(dateStr) {
    if (!dateStr) return;
    const today = toLocalDateStr(new Date());
    if (dateStr > today) {
        const picker = document.getElementById('track-date-picker');
        if (picker) picker.value = _trackDate;
        return;
    }
    _trackDate = dateStr;
    _pastEditMode = false;
    buildDateStrip();
    loadDailySummary();
}

function togglePastEdit() {
    _pastEditMode = !_pastEditMode;
    loadDailySummary();
}

// ── Tabs ──────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'today') loadDailySummary();
        if (tab.dataset.tab === 'weight') loadWeightHistory();
        if (tab.dataset.tab === 'history') { loadHistory(); loadCalorieTrend(); }
        if (tab.dataset.tab === 'plan') { loadMealPlan(); initPlanTab(); }
        if (tab.dataset.tab === 'shop') { loadShopItems(); }
        if (tab.dataset.tab === 'spend') loadExpenses();
        if (tab.dataset.tab === 'settings') loadSettingsTab();
        if (tab.dataset.tab === 'cook') {
            document.getElementById('recipe-result').style.display = 'none';
            document.getElementById('recipe-result').innerHTML = '';
            document.getElementById('recipe-loading').style.display = 'none';
            document.getElementById('recipe-dish-input').value = '';
        }
        ri(); // re-render icons in newly visible tab
    });
});

// ── Init ──────────────────────────────────────────────────
document.getElementById('weight-date').value = new Date().toISOString().split('T')[0];
// Default spend month filter to current month
const _nowYM = new Date().toISOString().slice(0, 7);
document.getElementById('spend-month-filter') && (document.getElementById('spend-month-filter').value = _nowYM);
document.getElementById('plan-date').value = toLocalDateStr(new Date());
// Build track date strip on load
buildDateStrip();

(function initTheme() {
    const saved = localStorage.getItem('nutritrack-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
})();

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    const icon = btn.querySelector('[data-lucide]');
    if (icon) {
        icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
        ri();
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('nutritrack-theme', next);
    updateThemeIcon(next);
}

function switchToSettings() {
    const tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab) tab.click();
}

// ── Startup ───────────────────────────────────────────────
async function init() {
    ri();
    await fetchSettings();
    if (!_settings.onboarding_done) {
        showOnboarding();
    } else {
        loadDailySummary();
        loadStreak();
        loadTodayPlan();
        startWaterReminder();
    }
}
init();

// ── Toast system ──────────────────────────────────────────
const _toastIcons = {
    success: 'check-circle', error: 'x-circle', info: 'info', warn: 'alert-triangle'
};
function showToast(type, title, msg, duration = 3800) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon"><i data-lucide="${_toastIcons[type] || 'info'}"></i></span>
        <div class="toast-body"><div class="toast-title">${title}</div>${msg ? `<div class="toast-msg">${msg}</div>` : ''}</div>
        <button class="toast-close" onclick="this.closest('.toast').remove()"><i data-lucide="x"></i></button>`;
    container.appendChild(t);
    ri();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, duration);
}

// ── Confirm dialog ────────────────────────────────────────
let _dlgResolve = null;
function showConfirm(lucideIcon, title, msg, confirmLabel = 'Delete') {
    const iconEl = document.getElementById('dlg-icon');
    iconEl.innerHTML = `<i data-lucide="${lucideIcon}"></i>`;
    document.getElementById('dlg-title').textContent = title;
    document.getElementById('dlg-msg').textContent = msg;
    document.getElementById('dlg-confirm-btn').textContent = confirmLabel;
    document.getElementById('dialog-backdrop').classList.add('show');
    ri();
    return new Promise(resolve => {
        _dlgResolve = (val) => {
            document.getElementById('dialog-backdrop').classList.remove('show');
            resolve(val);
        };
    });
}

// ── Food Search ───────────────────────────────────────────
function onSearchInput() {
    const val = document.getElementById('search-input').value;
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.style.display = val.length ? 'flex' : 'none';
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    const result = document.getElementById('search-result');
    result.classList.remove('show');
    result.innerHTML = '';
    document.getElementById('search-input').focus();
}

async function searchFood() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;
    const btn = document.getElementById('search-btn');
    const loading = document.getElementById('search-loading');
    const result = document.getElementById('search-result');
    btn.disabled = true;
    loading.classList.add('show');
    result.classList.remove('show');
    try {
        const apiKey = _settings.groq_api_key || '';
        const data = await Groq.analyzeFood(apiKey, query);
        if (data.suggestion && !data.calories && !apiKey) {
            result.innerHTML = `<div style="color:var(--danger);font-size:0.85rem">${data.suggestion}</div>`;
            result.classList.add('show'); return;
        }
        const score = data.health_score || 5;
        const badgeClass = score >= 7 ? 'badge-good' : score >= 4 ? 'badge-ok' : 'badge-bad';
        const badgeText = score >= 7 ? 'Healthy Choice' : score >= 4 ? 'Eat in Moderation' : 'Avoid or Limit';
        const imgSlug = encodeURIComponent(data.food_name.split(' ').slice(0, 2).join(' '));
        const imgUrl = `https://source.unsplash.com/120x120/?${imgSlug},food`;
        result.innerHTML = `
            <div class="search-result-header">
                <img class="search-food-img" src="${imgUrl}" alt="${data.food_name}"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="search-food-img-placeholder" style="display:none">
                    <i data-lucide="utensils"></i>
                </div>
                <div>
                    <div class="search-food-name">${data.food_name}</div>
                    <span class="health-badge ${badgeClass}">${badgeText} · ${score}/10</span>
                </div>
            </div>
            <div class="search-macro-grid">
                <div class="search-macro"><div class="sv">${data.calories}</div><div class="sl">kcal</div></div>
                <div class="search-macro"><div class="sv">${data.protein_g}g</div><div class="sl">protein</div></div>
                <div class="search-macro"><div class="sv">${data.carbs_g}g</div><div class="sl">carbs</div></div>
                <div class="search-macro"><div class="sv">${data.fat_g}g</div><div class="sl">fat</div></div>
            </div>
            <div class="search-verdict">${data.suggestion}</div>
            <button class="btn btn-primary search-log-btn"
                onclick="quickLogFromSearch(${JSON.stringify(data.food_name)}, ${data.calories}, ${data.protein_g}, ${data.carbs_g}, ${data.fat_g})">
                <i data-lucide="plus-circle"></i> Log This
            </button>`;
        result.classList.add('show');
        // show clear button once results are visible
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.style.display = 'flex';
        ri();
    } catch (err) {
        result.innerHTML = `<div style="color:var(--danger);font-size:0.85rem">Error: ${err.message}</div>`;
        result.classList.add('show');
        showToast('error', 'Search failed', err.message);
    } finally { btn.disabled = false; loading.classList.remove('show'); }
}

// ── Quick-log from search result ─────────────────────────
async function quickLogFromSearch(name, cal, prot, carbs, fat) {
    const mealType = document.getElementById('meal-type') ? document.getElementById('meal-type').value : 'snack';
    const now = new Date();
    const time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    try {
        await DB.addFood({
            description: name, meal_type: mealType,
            date: _trackDate, time,
            calories: parseFloat(cal), protein_g: parseFloat(prot),
            carbs_g: parseFloat(carbs), fat_g: parseFloat(fat),
            health_score: 5, suggestion: '',
        });
        showToast('success', `Logged: ${name}`, `${cal} kcal · ${prot}g protein`, 4000);
        loadDailySummary();
        loadStreak();
    } catch (e) { showToast('error', 'Log failed', e.message); }
}

// ── Mic / Speech Recognition ──────────────────────────────
let _recog = null;
let _isRecording = false;

function toggleMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { showToast('warn', 'Not supported', 'Speech recognition requires Chrome or Safari.'); return; }
    if (_isRecording) { _recog && _recog.stop(); return; }
    _recog = new SpeechRecognition();
    _recog.lang = 'en-IN';
    _recog.interimResults = true;
    _recog.maxAlternatives = 1;
    _isRecording = true;
    const micBtn = document.getElementById('mic-btn');
    micBtn.classList.add('recording');
    const micIcon = micBtn.querySelector('[data-lucide]');
    if (micIcon) { micIcon.setAttribute('data-lucide', 'mic-off'); ri(); }
    _recog.onresult = (event) => {
        document.getElementById('food-desc').value = Array.from(event.results).map(r => r[0].transcript).join('');
        refreshLogBtn();
    };
    _recog.onend = () => {
        _isRecording = false;
        micBtn.classList.remove('recording');
        if (micIcon) { micIcon.setAttribute('data-lucide', 'mic'); ri(); }
        _recog = null;
    };
    _recog.onerror = (e) => {
        _isRecording = false;
        micBtn.classList.remove('recording');
        if (micIcon) { micIcon.setAttribute('data-lucide', 'mic'); ri(); }
        if (e.error !== 'aborted') showToast('error', 'Mic error', e.error);
    };
    _recog.start();
}

// ── Photo section toggle ─────────────────────────────────
function togglePhotoSection() {
    const section = document.getElementById('photo-section');
    const btn = document.getElementById('photo-toggle');
    const isOpen = section.classList.contains('open');
    if (isOpen) {
        stopCamera();
        section.classList.remove('open');
        btn.classList.remove('active');
    } else {
        section.classList.add('open');
        btn.classList.add('active');
        ri();
    }
}

// ── Log button enable/disable ─────────────────────────────
function refreshLogBtn() {
    const desc = document.getElementById('food-desc').value.trim();
    const hasImage = document.getElementById('preview-wrap').classList.contains('show');
    const btn = document.getElementById('log-btn');
    const ready = desc.length > 0 || hasImage;
    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.4';
    btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}

function showPreview(src) {
    const preview = document.getElementById('img-preview');
    const wrap = document.getElementById('preview-wrap');
    preview.src = src;
    wrap.classList.add('show');
    refreshLogBtn();
}

function retakeImage() {
    _capturedBlob = null;
    document.getElementById('img-preview').src = '';
    document.getElementById('preview-wrap').classList.remove('show');
    document.getElementById('food-image').value = '';
    document.getElementById('file-drop').classList.remove('has-file');
    refreshLogBtn();
}

// ── Camera capture ────────────────────────────────────────
let _stream = null;
let _capturedBlob = null;

function setMode(mode) {
    const isFile = mode === 'file';
    document.getElementById('btn-mode-file').classList.toggle('active', isFile);
    document.getElementById('btn-mode-cam').classList.toggle('active', !isFile);
    document.getElementById('file-drop').style.display = isFile ? '' : 'none';
    if (!isFile) startCamera(); else stopCamera();
}

async function startCamera() {
    try {
        _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const video = document.getElementById('cam-video');
        video.srcObject = _stream;
        document.getElementById('camera-wrap').classList.add('show');
        document.getElementById('cam-controls').style.display = 'flex';
        _capturedBlob = null;
        document.getElementById('img-preview').style.display = 'none';
    } catch (err) {
        showToast('error', 'Camera unavailable', err.message);
        setMode('file');
    }
}

function stopCamera() {
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
    document.getElementById('camera-wrap').classList.remove('show');
    document.getElementById('cam-controls').style.display = 'none';
}

function snapPhoto() {
    const video = document.getElementById('cam-video');
    const canvas = document.getElementById('cam-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
        _capturedBlob = blob;
        showPreview(URL.createObjectURL(blob));
        const wrap = document.getElementById('camera-wrap');
        wrap.style.opacity = '0.2';
        setTimeout(() => { wrap.style.opacity = '1'; }, 120);
    }, 'image/jpeg', 0.92);
}

function previewImage(input) {
    _capturedBlob = null;
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => {
            document.getElementById('file-drop').classList.add('has-file');
            showPreview(e.target.result);
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// ── Log Food ──────────────────────────────────────────────
async function logFood(e) {
    e.preventDefault();
    const form = document.getElementById('food-form');
    const desc = document.getElementById('food-desc').value.trim();
    const fileImg = document.getElementById('food-image').files[0];
    const img = _capturedBlob || fileImg;
    if (!desc && !img) { showToast('warn', 'Nothing to log', 'Add a description or capture a photo.'); return false; }

    const btn = document.getElementById('log-btn');
    const loading = document.getElementById('loading');
    btn.disabled = true;
    loading.classList.add('show');

    try {
        const mealType = document.getElementById('meal-type').value;
        const now = new Date();
        const time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
        const apiKey = _settings.groq_api_key || '';

        // Convert image to base64 if provided
        let imgBase64 = null;
        if (img) {
            imgBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(img);
            });
        }

        const a = await Groq.analyzeFood(apiKey, desc, imgBase64);
        await DB.addFood({
            description: desc || a.food_name, meal_type: mealType,
            date: _trackDate, time,
            calories: a.calories, protein_g: a.protein_g,
            carbs_g: a.carbs_g, fat_g: a.fat_g,
            health_score: a.health_score || 5, suggestion: a.suggestion || '',
        });
        showToast('success', `Logged: ${a.food_name}`, `${a.calories} kcal · ${a.protein_g}g protein`, 4500);
        // Inline result card
        const lrcName = document.getElementById('lrc-name');
        if (lrcName) { const sp = lrcName.querySelector('span') || lrcName; sp.textContent = a.food_name; }
        document.getElementById('lrc-cal').textContent = a.calories;
        document.getElementById('lrc-p').textContent = a.protein_g + 'g';
        document.getElementById('lrc-c').textContent = a.carbs_g + 'g';
        document.getElementById('lrc-f').textContent = a.fat_g + 'g';
        document.getElementById('lrc-tip').textContent = a.suggestion || '';
        document.getElementById('log-result-card').style.display = 'block';
        form.reset();
        _capturedBlob = null;
        document.getElementById('preview-wrap').classList.remove('show');
        document.getElementById('img-preview').src = '';
        document.getElementById('file-drop').classList.remove('has-file');
        // Collapse photo section
        const ps = document.getElementById('photo-section');
        const pt = document.getElementById('photo-toggle');
        if (ps) ps.classList.remove('open');
        if (pt) pt.classList.remove('active');
        refreshLogBtn();
        loadDailySummary();
        loadStreak();
    } catch (err) { showToast('error', 'Log failed', err.message); }
    finally { btn.disabled = false; loading.classList.remove('show'); }
    return false;
}

// ── Today's Plan card ─────────────────────────────────────
const _loggedPlanIds = new Set(); // track which plan items logged this session

async function loadTodayPlan() {
    const today = toLocalDateStr(new Date());
    const dismissKey = 'plan-dismissed-' + today;
    const card = document.getElementById('today-plan-card');
    const list = document.getElementById('today-plan-list');
    if (!card || !list) return;

    // Hidden if dismissed today
    if (sessionStorage.getItem(dismissKey)) { card.style.display = 'none'; return; }

    try {
        const plans = await DB.getTodayMealPlan();

        if (!plans.length) { card.style.display = 'none'; return; }

        card.style.display = 'block';
        list.innerHTML = '';
        plans.forEach(p => {
            const logged = _loggedPlanIds.has(p.id);
            const item = document.createElement('div');
            item.className = 'today-plan-item' + (logged ? ' logged' : '');
            item.dataset.planId = p.id;
            item.dataset.description = p.description;
            item.dataset.mealType = p.meal_type;
            item.innerHTML = `
                <div class="today-plan-item-info">
                    <div class="today-plan-item-name">${p.description}</div>
                    <div class="today-plan-item-meta">
                        <i data-lucide="clock"></i>
                        ${p.meal_type}${p.planned_calories ? ' · ' + p.planned_calories + ' kcal' : ''}
                        ${logged ? ' &nbsp;<span style="color:var(--success);font-weight:600;display:inline-flex;align-items:center;gap:3px"><i data-lucide="check-circle" style="width:11px;height:11px;stroke:var(--success)"></i> Done</span>' : ''}
                    </div>
                </div>
                <button class="today-plan-log-btn" ${logged ? 'disabled style="display:none"' : ''}
                    onclick="logPlanItem(${p.id})"
                    title="${logged ? 'Already logged' : 'Log this meal'}">
                    <i data-lucide="${logged ? 'check' : 'plus'}"></i>
                </button>`;
            list.appendChild(item);
        });
        ri();
    } catch (e) { console.error('loadTodayPlan:', e); card.style.display = 'none'; }
}

async function logPlanItem(planId) {
    const item = document.querySelector(`[data-plan-id="${planId}"]`);
    const mealType = item ? item.dataset.mealType : '';
    const description = item ? item.dataset.description : '';

    // Optimistically hide the button
    const btn = item ? item.querySelector('.today-plan-log-btn') : null;
    if (btn) { btn.style.display = 'none'; }

    try {
        const apiKey = _settings.groq_api_key || '';
        const now = new Date();
        const time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
        const a = await Groq.analyzeFood(apiKey, description);
        await DB.addFood({
            description, meal_type: mealType,
            date: _trackDate, time,
            calories: a.calories, protein_g: a.protein_g,
            carbs_g: a.carbs_g, fat_g: a.fat_g,
            health_score: a.health_score || 5, suggestion: a.suggestion || '',
        });
        _loggedPlanIds.add(planId);
        showToast('success', 'Logged from plan', `${a.food_name} · ${a.calories} kcal`);
        await loadDailySummary();
        loadStreak();
        loadTodayPlan(); // re-render to show ✓ Done state
    } catch (e) {
        showToast('error', 'Log failed', e.message);
        if (btn) { btn.style.display = 'flex'; }
    }
}

function dismissTodayPlan() {
    const today = toLocalDateStr(new Date());
    sessionStorage.setItem('plan-dismissed-' + today, '1');
    document.getElementById('today-plan-card').style.display = 'none';
}

// ── Daily Summary ─────────────────────────────────────────
async function loadDailySummary() {
    const today = toLocalDateStr(new Date());
    const isToday = _trackDate === today;
    try {
    try {
        const data = await DB.getDailySummary(_trackDate);
        const t = data.totals;

        // Update macros
        document.getElementById('total-cal').textContent = t.calories;
        document.getElementById('total-protein').textContent = t.protein_g + 'g';
        document.getElementById('total-carbs').textContent = t.carbs_g + 'g';
        document.getElementById('total-fat').textContent = t.fat_g + 'g';

        document.getElementById('cal-progress').style.width =
            Math.min(100, (t.calories / _settings.calorie_goal) * 100) + '%';
        document.getElementById('protein-progress').style.width =
            Math.min(100, (t.protein_g / _settings.protein_goal) * 100) + '%';

        document.getElementById('lbl-cal').textContent = t.calories + ' kcal';
        document.getElementById('lbl-protein').textContent = t.protein_g + 'g protein';

        // Remaining labels
        const calRem = _settings.calorie_goal - t.calories;
        const protRem = _settings.protein_goal - t.protein_g;
        const calRemEl = document.getElementById('lbl-cal-remaining');
        const protRemEl = document.getElementById('lbl-protein-remaining');
        if (calRemEl) {
            const over = calRem < 0;
            calRemEl.textContent = over ? `${Math.abs(calRem)} kcal over goal` : `${calRem} kcal remaining`;
            calRemEl.className = 'remaining-' + (over ? 'over' : calRem < _settings.calorie_goal * 0.1 ? 'warn' : 'ok');
        }
        if (protRemEl) {
            const over = protRem < 0;
            protRemEl.textContent = over ? `${Math.abs(protRem).toFixed(1)}g over goal` : `${protRem.toFixed(1)}g remaining`;
            protRemEl.className = 'remaining-' + (over ? 'over' : 'ok');
        }

        // Carbs + fat progress bars
        const carbsProgEl = document.getElementById('carbs-progress');
        const fatProgEl = document.getElementById('fat-progress');
        const carbsLbl = document.getElementById('lbl-carbs');
        const fatLbl = document.getElementById('lbl-fat-prog');
        const carbsGoalLbl = document.getElementById('lbl-carbs-goal');
        const fatGoalLbl = document.getElementById('lbl-fat-goal');
        if (carbsProgEl) carbsProgEl.style.width = Math.min(100, (t.carbs_g / _settings.carbs_goal) * 100) + '%';
        if (fatProgEl) fatProgEl.style.width = Math.min(100, (t.fat_g / _settings.fat_goal) * 100) + '%';
        if (carbsLbl) carbsLbl.textContent = t.carbs_g + 'g carbs';
        if (fatLbl) fatLbl.textContent = t.fat_g + 'g fat';
        if (carbsGoalLbl) carbsGoalLbl.textContent = 'Target: ' + _settings.carbs_goal + 'g';
        if (fatGoalLbl) fatGoalLbl.textContent = 'Target: ' + _settings.fat_goal + 'g';

        // Remaining carbs + fat labels
        const carbsRem = _settings.carbs_goal - t.carbs_g;
        const fatRem = _settings.fat_goal - t.fat_g;
        const carbsRemEl = document.getElementById('lbl-carbs-remaining');
        const fatRemEl = document.getElementById('lbl-fat-remaining');
        if (carbsRemEl) {
            const over = carbsRem < 0;
            carbsRemEl.textContent = over ? `${Math.abs(carbsRem)}g over goal` : `${carbsRem}g remaining`;
            carbsRemEl.className = 'remaining-' + (over ? 'over' : carbsRem < _settings.carbs_goal * 0.1 ? 'warn' : 'ok');
        }
        if (fatRemEl) {
            const over = fatRem < 0;
            fatRemEl.textContent = over ? `${Math.abs(fatRem).toFixed(1)}g over goal` : `${fatRem.toFixed(1)}g remaining`;
            fatRemEl.className = 'remaining-' + (over ? 'over' : fatRem < _settings.fat_goal * 0.1 ? 'warn' : 'ok');
        }

        document.getElementById('water-count').textContent = t.water_glasses;
        renderWater(t.water_glasses);

        // Dynamic title + past-day banner
        const d = new Date(_trackDate + 'T00:00:00');
        const labelStr = isToday ? "Today's" : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const titleEl = document.getElementById('track-progress-title');
        if (titleEl) titleEl.textContent = labelStr + ' Progress';
        const mealsTitle = document.getElementById('track-meals-title');
        if (mealsTitle) mealsTitle.textContent = labelStr + ' Meals';

        const banner = document.getElementById('track-past-banner');
        const logCard = document.getElementById('track-log-card');
        if (banner) banner.style.display = isToday ? 'none' : 'flex';
        if (banner && !isToday) {
            document.getElementById('track-past-label').textContent =
                d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
            const editBtn = document.getElementById('btn-edit-past');
            if (editBtn) {
                editBtn.innerHTML = _pastEditMode
                    ? '<i data-lucide="check" style="width:12px;height:12px"></i> Done'
                    : '<i data-lucide="pencil" style="width:12px;height:12px"></i> Edit';
            }
        }
        if (logCard) logCard.style.display = (isToday || _pastEditMode) ? '' : 'none';

        // Water action buttons — only for today
        const waterActions = document.querySelector('.water-actions');
        if (waterActions) waterActions.style.display = isToday ? '' : 'none';

        // Render food list in Track tab
        const trackList = document.getElementById('track-food-list');
        const trackNoFood = document.getElementById('track-no-food');
        if (trackList) {
            trackList.innerHTML = '';
            if (!data.foods.length) {
                if (trackNoFood) trackNoFood.style.display = 'block';
            } else {
                if (trackNoFood) trackNoFood.style.display = 'none';
                data.foods.forEach(f => {
                    const li = document.createElement('li');
                    li.className = 'food-item';
                    const mealLabel = f.meal_type.charAt(0).toUpperCase() + f.meal_type.slice(1);
                    li.innerHTML = `
                        <div>
                            <div class="food-name">${f.description}
                                <span style="color:var(--muted);font-size:0.7rem">${f.time} · ${mealLabel}</span>
                            </div>
                            <div class="food-meta">P: ${f.protein_g}g · C: ${f.carbs_g}g · F: ${f.fat_g}g</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px">
                            <span class="food-cals">${f.calories} kcal</span>
                            ${(isToday || _pastEditMode) ? `<button class="btn-danger" onclick="deleteFood(${f.id})"><i data-lucide="trash-2"></i></button>` : ''}
                        </div>`;
                    trackList.appendChild(li);
                });
            }
        }

        // Also update Today tab food list (backward compat)
        const list = document.getElementById('food-list');
        const noFood = document.getElementById('no-food');
        if (list) {
            list.innerHTML = '';
            if (!data.foods.length) { if (noFood) noFood.style.display = 'block'; }
            else {
                if (noFood) noFood.style.display = 'none';
                data.foods.forEach(f => {
                    const li = document.createElement('li');
                    li.className = 'food-item';
                    li.innerHTML = `
                        <div>
                            <div class="food-name">${f.description}
                                <span style="color:var(--muted);font-size:0.7rem">${f.time} · ${f.meal_type}</span>
                            </div>
                            <div class="food-meta">P: ${f.protein_g}g · C: ${f.carbs_g}g · F: ${f.fat_g}g</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px">
                            <span class="food-cals">${f.calories} kcal</span>
                            <button class="btn-danger" onclick="deleteFood(${f.id})">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>`;
                    list.appendChild(li);
                });
            }
        }
        ri();
        // Auto-refresh suggestion for today only
        if (isToday) getSuggestion();
    } catch (err) { console.error(err); }
}

async function deleteFood(id) {
    const ok = await showConfirm('trash-2', 'Delete entry?', 'This meal will be permanently removed.', 'Delete');
    if (!ok) return;
    await DB.deleteFood(id);
    showToast('info', 'Entry deleted', 'Meal removed.');
    loadDailySummary();
}

// ── Water ─────────────────────────────────────────────────
async function logWater() {
    const glasses = await DB.logWater(_trackDate);
    document.getElementById('water-count').textContent = glasses;
    renderWater(glasses);
}

async function resetWater() {
    await DB.resetWater(_trackDate);
    document.getElementById('water-count').textContent = 0;
    renderWater(0);
}

function _glassSVG(filled, idx) {
    const uid = `wg${idx}`;
    // Glass path: trapezoid wider at top, rounded bottom — matches a tumbler silhouette
    const path = 'M1.5,2 L20.5,2 L16.5,29 Q11,31.5 5.5,29 Z';
    const stroke = filled ? '#ff6600' : 'rgba(255,102,0,0.35)';
    const water = filled ? `
        <rect x="0" y="11" width="22" height="21" clip-path="url(#${uid})" fill="#ff6600" opacity="0.78"/>
        <path d="M1.5,11 Q5.5,9.5 11,11 Q16.5,12.5 20.5,11"
              fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"
              clip-path="url(#${uid})"/>
    ` : '';
    return `<svg viewBox="0 0 22 32" width="22" height="32" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="${uid}"><path d="${path}"/></clipPath></defs>
        ${water}
        <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.8"
              stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

function renderWater(count) {
    const goal = _settings.water_goal || 10;
    const container = document.getElementById('water-display');
    container.innerHTML = '';
    for (let i = 0; i < goal; i++) {
        const filled = i < count;
        const d = document.createElement('div');
        d.className = 'glass' + (filled ? ' filled' : '');
        d.title = `${i + 1} glass${i + 1 > 1 ? 'es' : ''}`;
        d.innerHTML = _glassSVG(filled, i);
        d.addEventListener('click', async () => {
            const target = i + 1;
            const newCount = target <= count ? target - 1 : target;
            const glasses = await DB.setWater(_trackDate, newCount);
            document.getElementById('water-count').textContent = glasses;
            renderWater(glasses);
        });
        container.appendChild(d);
    }
}

function startWaterReminder() {
    const reminder = document.getElementById('water-reminder');
    setInterval(() => {
        reminder.classList.add('show');
        setTimeout(() => reminder.classList.remove('show'), 15000);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Drink Water!', { body: 'Stay hydrated — have a glass of water now.' });
        }
    }, 45 * 60 * 1000);
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    setTimeout(() => { reminder.classList.add('show'); setTimeout(() => reminder.classList.remove('show'), 10000); }, 120000);
}

// ── AI Suggestion ─────────────────────────────────────────
async function getSuggestion() {
    const el = document.getElementById('suggestion');
    el.innerHTML = `<div class="sug-loading"><div class="spinner"></div> Analysing your intake...</div>`;
    try {
        const apiKey = _settings.groq_api_key || '';
        const today = toLocalDateStr(new Date());
        const summary = await DB.getDailySummary(today);
        const raw = await Groq.getSuggestion(apiKey, _settings, summary.foods || [], summary.totals.water_glasses || 0);
        // Split into sentences / bullet points
        const lines = raw
            .split(/(?:\r?\n|(?<=\.)\s+(?=[A-Z0-9•\-]))/g)
            .map(l => l.replace(/^[\d\.\-\*•]\s*/, '').trim())
            .filter(Boolean);
        const icons = ['zap', 'leaf', 'target', 'trending-up', 'heart'];
        if (lines.length <= 1) {
            el.innerHTML = `<div class="sug-single">${raw}</div>`;
        } else {
            el.innerHTML = lines.map((l, i) => `
                <div class="sug-item">
                    <span class="sug-icon"><i data-lucide="${icons[i % icons.length]}"></i></span>
                    <span class="sug-text">${l}</span>
                </div>`).join('');
        }
        ri();
    } catch (err) {
        el.innerHTML = `<div class="sug-single" style="color:var(--danger)">Could not load suggestion.</div>`;
    }
}

// ── History ───────────────────────────────────────────────
// ── Nutrition Gaps ────────────────────────────────────────
async function loadNutritionGaps() {
    const grid = document.getElementById('gaps-grid');
    const loading = document.getElementById('gaps-loading');
    const summary = document.getElementById('gap-summary');
    grid.innerHTML = '';
    loading.style.display = 'flex';
    try {
        const apiKey = _settings.groq_api_key || '';
        const today = toLocalDateStr(new Date());
        const todaySummary = await DB.getDailySummary(today);
        const data = await Groq.nutritionGaps(apiKey, _settings, todaySummary.foods || []);
        loading.style.display = 'none';
        const scoreColor = data.score >= 7 ? 'var(--success)' : data.score >= 4 ? 'var(--warning)' : 'var(--danger)';
        summary.innerHTML = `<span style="font-weight:700;color:${scoreColor}">${data.score}/10</span> — ${data.summary}`;
        (data.gaps || []).forEach(g => {
            const statusColor = g.status === 'good' ? 'var(--success)' : g.status === 'ok' ? 'var(--warning)' : 'var(--danger)';
            const statusLabel = g.status === 'good' ? '✓ Good' : g.status === 'ok' ? '~ OK' : '↓ Low';
            const foodTags = (g.foods || []).map(f => `<span class="suggest-tag">${f}</span>`).join('');
            grid.innerHTML += `<div class="gap-item">
                <div class="gap-item-top">
                    <span class="gap-emoji">${g.emoji}</span>
                    <span class="gap-name">${g.nutrient}</span>
                    <span class="gap-status" style="color:${statusColor}">${statusLabel}</span>
                </div>
                <div class="gap-tip">${g.tip}</div>
                <div class="gap-foods">${foodTags}</div>
            </div>`;
        });
        ri();
    } catch (e) {
        loading.style.display = 'none';
        document.getElementById('gaps-grid').innerHTML = `<div class="sug-single" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
}

// ── Meal Swap Suggestions ─────────────────────────────────
async function loadMealSwaps() {
    const list = document.getElementById('swap-list');
    const loading = document.getElementById('swap-loading');
    list.innerHTML = '';
    loading.style.display = 'flex';
    try {
        const apiKey = _settings.groq_api_key || '';
        const today = toLocalDateStr(new Date());
        const todaySummary = await DB.getDailySummary(today);
        const data = await Groq.mealSwap(apiKey, _settings, todaySummary.foods || []);
        loading.style.display = 'none';
        (data.issues || []).forEach(issue => {
            list.innerHTML += `<div class="swap-item">
                <div class="swap-item-header">
                    <i data-lucide="${issue.icon || 'alert-circle'}" class="swap-icon"></i>
                    <span class="swap-problem">${issue.problem}</span>
                    <span class="swap-impact">${issue.kcal_impact || ''}</span>
                </div>
                <div class="swap-suggestion">
                    <i data-lucide="arrow-right" style="width:13px;height:13px;stroke:var(--primary);flex-shrink:0"></i>
                    ${issue.swap}
                </div>
                <div class="swap-benefit">${issue.benefit}</div>
            </div>`;
        });
        ri();
    } catch (e) {
        loading.style.display = 'none';
        list.innerHTML = `<div class="sug-single" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
}

// ── Recipe Generator ──────────────────────────────────────
const DISH_EMOJIS = {
    biryani:'🍚', pulao:'🍚', fried:'🍳', rice:'🍚',
    curry:'🍛', masala:'🍛', sabzi:'🍛', korma:'🍛', gravy:'🍛',
    dal:'🍲', sambar:'🍲', soup:'🥣', rasam:'🥣',
    roti:'🫓', paratha:'🫓', naan:'🫓', chapati:'🫓',
    dosa:'🥞', idli:'🥞', uttapam:'🥞',
    salad:'🥗', raita:'🥗',
    chicken:'🍗', mutton:'🥩', fish:'🐟', prawn:'🦐', egg:'🍳',
    paneer:'🧀', tofu:'🧀',
    kheer:'🍮', halwa:'🍮', payasam:'🍮', ladoo:'🍬', sweet:'🍮', dessert:'🍮',
    sandwich:'🥪', burger:'🍔', wrap:'🌯',
    noodle:'🍜', pasta:'🍝', maggi:'🍜',
    chai:'🍵', tea:'🍵', coffee:'☕',
    juice:'🥤', smoothie:'🥤', lassi:'🥛',
    pizza:'🍕', taco:'🌮',
};

function getDishEmoji(dish) {
    const lower = dish.toLowerCase();
    for (const [key, emoji] of Object.entries(DISH_EMOJIS)) {
        if (lower.includes(key)) return emoji;
    }
    return '🍽️';
}

async function generateRecipe() {
    const dish = document.getElementById('recipe-dish-input').value.trim();
    if (!dish) { showToast('warn', 'Input needed', 'Enter a dish name first'); return; }
    const servings = document.getElementById('recipe-servings').value;

    document.getElementById('recipe-result').style.display = 'none';
    document.getElementById('recipe-loading').style.display = 'flex';

    try {
        const apiKey = _settings.groq_api_key || '';
        const data = await Groq.generateRecipe(apiKey, dish);

        const ytQuery = encodeURIComponent(`how to make ${data.title || dish} recipe`);
        const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;
        const srv = data.servings || servings;
        const emoji = getDishEmoji(data.title || dish);

        const result = document.getElementById('recipe-result');
        const n = data.nutrition_per_serving || {};
        result.innerHTML = `
            <div class="card recipe-hero-card">
                <div class="recipe-hero-emoji">${emoji}</div>
                <h2 class="recipe-dish-title">${data.title || dish}</h2>
                <p class="recipe-hero-sub">For ${srv} serving${srv > 1 ? 's' : ''}</p>
                <div class="recipe-meta-chips">
                    <span class="recipe-meta-chip">⏱ ${data.prep_time || '--'} prep</span>
                    <span class="recipe-meta-chip">🔥 ${data.cook_time || '--'} cook</span>
                    ${n.calories ? `<span class="recipe-meta-chip">${n.calories} kcal/serve</span>` : ''}
                </div>
                <a class="recipe-yt-btn" href="${ytUrl}" target="_blank" rel="noopener noreferrer">
                    <span class="yt-icon"><span class="yt-triangle"></span></span>
                    Watch on YouTube
                </a>
            </div>

            <div class="card">
                <h2 class="recipe-section-title">🥕 Ingredients</h2>
                <ul class="recipe-ingr-list">
                    ${(data.ingredients || []).map(i => `<li class="recipe-ingr-item">${i}</li>`).join('')}
                </ul>
            </div>

            <div class="card">
                <h2 class="recipe-section-title">👨‍🍳 Preparation</h2>
                <div class="recipe-timeline">
                    ${(data.instructions || []).map((s, i) => `
                        <div class="recipe-step">
                            <div class="recipe-step-num">${i + 1}</div>
                            <div class="recipe-step-text">${s}</div>
                        </div>`).join('')}
                </div>
            </div>

            ${n.calories ? `
            <div class="card">
                <h2 class="recipe-section-title">📊 Nutrition per Serving</h2>
                <div class="search-macro-grid">
                    <div class="search-macro"><div class="sv">${n.calories}</div><div class="sl">kcal</div></div>
                    <div class="search-macro"><div class="sv">${n.protein_g}g</div><div class="sl">protein</div></div>
                    <div class="search-macro"><div class="sv">${n.carbs_g}g</div><div class="sl">carbs</div></div>
                    <div class="search-macro"><div class="sv">${n.fat_g}g</div><div class="sl">fat</div></div>
                </div>
            </div>` : ''}

            ${data.tips ? `
            <div class="card recipe-tips-card">
                <div class="recipe-tips-inner">
                    <span class="recipe-tips-icon">💡</span>
                    <div>
                        <div class="recipe-tips-label">Pro Tip</div>
                        <p class="recipe-tips-text">${data.tips}</p>
                    </div>
                </div>
            </div>` : ''}
        `;
        result.style.display = '';
        ri();
    } catch (e) {
        showToast('error', 'Failed', 'Failed to generate recipe. Try again.');
    } finally {
        document.getElementById('recipe-loading').style.display = 'none';
    }
}

// ── Voice Input (Cook tab) ───────────────────────────────
let _voiceRecognition = null;
let _voiceActive = false;

function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('warn', 'Not supported', 'Voice input is not supported in this browser.');
        return;
    }
    if (_voiceActive && _voiceRecognition) {
        _voiceRecognition.stop();
        return;
    }
    _voiceRecognition = new SpeechRecognition();
    _voiceRecognition.lang = 'en-IN';
    _voiceRecognition.interimResults = false;
    _voiceRecognition.maxAlternatives = 1;

    _voiceRecognition.onstart = () => {
        _voiceActive = true;
        const btn = document.getElementById('recipe-mic-btn');
        if (btn) btn.classList.add('mic-active');
    };
    _voiceRecognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        const input = document.getElementById('recipe-dish-input');
        if (input) input.value = transcript;
    };
    _voiceRecognition.onerror = (e) => {
        if (e.error !== 'aborted') showToast('error', 'Voice error', 'Could not capture voice. Try again.');
    };
    _voiceRecognition.onend = () => {
        _voiceActive = false;
        const btn = document.getElementById('recipe-mic-btn');
        if (btn) btn.classList.remove('mic-active');
    };
    _voiceRecognition.start();
}

document.getElementById('recipe-dish-input') && document.getElementById('recipe-dish-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') generateRecipe();
});

// ── Spend / Expenses ─────────────────────────────────────
const CAT_EMOJI = {
    Food:'🍱', Groceries:'🛒', Restaurant:'🍽️',
    Snacks:'🍿', Supplements:'💊', Transport:'🚌', Other:'📦'
};

function fmtAmt(n) {
    return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`;
}

async function loadExpenses() {
    const month = document.getElementById('spend-month-filter').value;
    const cat = document.getElementById('spend-cat-filter').value;
    const search = document.getElementById('spend-search').value;

    const params = new URLSearchParams();
    if (month) params.set('month', month);
    params.set('type', 'debit');
    if (cat) params.set('category', cat);
    if (search) params.set('search', search);

    const expenses = await DB.getExpenses({ month, category: cat, q: search });
    const data = {
        expenses,
        total_debit: expenses.reduce((s, e) => s + (e.amount || 0), 0),
        cat_totals: expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + (e.amount || 0); return acc; }, {}),
    };

    // Summary
    document.getElementById('ss-debit').textContent = fmtAmt(data.total_debit);
    const countEl = document.getElementById('ss-count');
    if (countEl) countEl.textContent = (data.expenses || []).length;

    // Category bars
    const catCard = document.getElementById('spend-cat-card');
    const catBars = document.getElementById('spend-cat-bars');
    const catEntries = Object.entries(data.cat_totals || {}).sort((a,b) => b[1]-a[1]);
    if (catEntries.length > 0) {
        const max = catEntries[0][1];
        catBars.innerHTML = catEntries.map(([c, amt]) => `
            <div class="spend-cat-bar-row">
                <span class="spend-cat-bar-label">${CAT_EMOJI[c]||'📦'} ${c}</span>
                <div class="spend-cat-bar-track">
                    <div class="spend-cat-bar-fill" style="width:${Math.round((amt/max)*100)}%"></div>
                </div>
                <span class="spend-cat-bar-amt">${fmtAmt(amt)}</span>
            </div>`).join('');
        catCard.style.display = '';
    } else {
        catCard.style.display = 'none';
    }

    // Expense list
    const list = document.getElementById('spend-list');
    const empty = document.getElementById('spend-empty');
    if (!data.expenses || data.expenses.length === 0) {
        list.innerHTML = '';
        empty.style.display = '';
    } else {
        empty.style.display = 'none';
        list.innerHTML = data.expenses.map(e => `
            <div class="spend-item">
                <div class="spend-item-icon ${e.type}">${CAT_EMOJI[e.category]||'📦'}</div>
                <div class="spend-item-body">
                    <div class="spend-item-desc">${e.description}</div>
                    <div class="spend-item-meta">
                        <span class="spend-item-badge">${e.category}</span>
                        <span>${e.payment_method}</span>
                        ${e.note ? `<span>· ${e.note}</span>` : ''}
                    </div>
                </div>
                <div class="spend-item-right">
                    <div class="spend-item-amount ${e.type}">${fmtAmt(e.amount)}</div>
                    <div class="spend-item-date">${fmtDate(e.date)}</div>
                </div>
                <div class="spend-item-actions">
                    <button class="spend-action-btn" onclick="editExpense(${e.id})" title="Edit">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="spend-action-btn del" onclick="deleteExpense(${e.id})" title="Delete">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>`).join('');
        ri();
    }
}

// filters auto-reload
['spend-month-filter','spend-cat-filter'].forEach(id => {
    document.getElementById(id) && document.getElementById(id).addEventListener('change', loadExpenses);
});
document.getElementById('spend-search') && document.getElementById('spend-search').addEventListener('input', () => {
    clearTimeout(window._spendSearchTimer);
    window._spendSearchTimer = setTimeout(loadExpenses, 300);
});

function openExpenseModal(expense) {
    const modal = document.getElementById('expense-modal-backdrop');
    document.getElementById('expense-edit-id').value = expense ? expense.id : '';
    document.getElementById('expense-modal-title').textContent = expense ? 'Edit Expense' : 'Add Expense';
    document.getElementById('exp-save-label').textContent = expense ? 'Update' : 'Save';
    document.getElementById('exp-desc').value = expense ? expense.description : '';
    document.getElementById('exp-amount').value = expense ? expense.amount : '';
    document.getElementById('exp-date').value = expense ? expense.date : new Date().toISOString().split('T')[0];
    document.getElementById('exp-cat').value = expense ? expense.category : 'Food';
    document.getElementById('exp-pay').value = expense ? expense.payment_method : 'UPI';
    document.getElementById('exp-note').value = expense ? expense.note : '';
    selectExpType(expense ? expense.type : 'debit');
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('exp-desc').focus(), 100);
}

function closeExpenseModal(e) {
    if (e && e.target !== document.getElementById('expense-modal-backdrop')) return;
    document.getElementById('expense-modal-backdrop').style.display = 'none';
}

function selectExpType(type) {
    document.querySelectorAll('.exp-type-chip').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.type === type);
    });
}

async function saveExpense() {
    const id = document.getElementById('expense-edit-id').value;
    const desc = document.getElementById('exp-desc').value.trim();
    const amount = document.getElementById('exp-amount').value;
    if (!desc) { showToast('warn', 'Missing field', 'Description required'); return; }
    if (!amount || parseFloat(amount) <= 0) { showToast('warn', 'Missing field', 'Enter a valid amount'); return; }
    const type = 'debit';
    const body = {
        description: desc,
        amount: parseFloat(amount),
        date: document.getElementById('exp-date').value,
        category: document.getElementById('exp-cat').value,
        payment_method: document.getElementById('exp-pay').value,
        type,
        note: document.getElementById('exp-note').value.trim()
    };
    if (id) {
        await DB.updateExpense(parseInt(id), body);
    } else {
        await DB.addExpense(body);
    }
    document.getElementById('expense-modal-backdrop').style.display = 'none';
    showToast('success', id ? 'Updated' : 'Added', id ? 'Expense updated.' : 'Expense logged.');
    loadExpenses();
}

async function editExpense(id) {
    const expenses = await DB.getExpenses({});
    const exp = expenses.find(e => e.id === id);
    if (exp) openExpenseModal(exp);
}

async function deleteExpense(id) {
    const ok = await showConfirm('trash-2', 'Delete expense?', 'This entry will be permanently removed.', 'Delete');
    if (!ok) return;
    await DB.deleteExpense(id);
    showToast('info', 'Deleted', 'Expense removed.');
    loadExpenses();
}

function exportExpenses(e) {
    e.preventDefault();
    showToast('info', 'Export', 'Use the CSV export in History tab for food data.');
}

// ── Shop / Buy List ───────────────────────────────────────
const SHOP_CAT_EMOJI = {
    Grocery: '🛒', Snacks: '🍿', Dairy: '🥛',
    Produce: '🥦', Supplements: '💊', Other: '📦'
};

async function loadShopItems() {
    const loading = document.getElementById('shop-loading');
    const content = document.getElementById('shop-content');
    const empty   = document.getElementById('shop-empty');
    const clearBtn = document.getElementById('shop-clear-btn');
    const countLbl = document.getElementById('shop-count-label');
    if (!content) return;

    loading.style.display = 'flex';
    content.innerHTML = '';
    empty.style.display = 'none';

    try {
        const shopItems = await DB.getShopItems();
        loading.style.display = 'none';

        const grouped = {};
        shopItems.forEach(item => {
            const cat = item.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });
        const keys = Object.keys(grouped);
        const totalItems  = keys.reduce((s, k) => s + grouped[k].length, 0);
        const checkedCount = keys.reduce((s, k) => s + grouped[k].filter(i => i.checked).length, 0);

        if (totalItems === 0) {
            empty.style.display = 'block';
            clearBtn.style.display = 'none';
            countLbl.textContent = '';
            ri();
            return;
        }

        countLbl.textContent = `${totalItems - checkedCount} remaining · ${checkedCount} checked`;
        clearBtn.style.display = checkedCount > 0 ? 'flex' : 'none';

        let html = '';
        keys.forEach(cat => {
            const items = grouped[cat];
            const emoji = SHOP_CAT_EMOJI[cat] || '📦';
            html += `<div class="shop-category">
                <div class="shop-cat-header">${emoji} ${cat}</div>`;
            items.forEach(item => {
                html += `<div class="shop-item${item.checked ? ' checked' : ''}" id="shop-item-${item.id}">
                    <label class="shop-check-label">
                        <input type="checkbox" class="shop-check" ${item.checked ? 'checked' : ''}
                            onchange="toggleShopItem(${item.id}, this.checked)">
                        <span class="shop-item-name">${item.name}</span>
                        ${item.quantity ? `<span class="shop-item-qty">${item.quantity}</span>` : ''}
                    </label>
                    <button class="shop-delete-btn" onclick="deleteShopItem(${item.id})" title="Remove">
                        <i data-lucide="x" style="width:13px;height:13px;stroke:var(--muted)"></i>
                    </button>
                </div>`;
            });
            html += '</div>';
        });

        content.innerHTML = html;
        ri();
    } catch (e) {
        loading.style.display = 'none';
        content.innerHTML = `<div class="sug-single" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
}

async function addShopItem() {
    const nameEl = document.getElementById('shop-add-name');
    const qtyEl  = document.getElementById('shop-add-qty');
    const catEl  = document.getElementById('shop-add-cat');
    const name   = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }

    const item = await DB.addShopItem({ name, quantity: qtyEl.value.trim(), category: catEl.value });
    if (item) {
        nameEl.value = '';
        qtyEl.value  = '';
        await loadShopItems();
    }
}

async function toggleShopItem(id, checked) {
    const el = document.getElementById('shop-item-' + id);
    if (el) el.classList.toggle('checked', checked);
    await DB.updateShopItem(id, { checked });
    // Refresh count labels without full re-render
    const allItems = document.querySelectorAll('#shop-content .shop-item');
    const total    = allItems.length;
    const chk      = document.querySelectorAll('#shop-content .shop-item.checked').length;
    const lbl = document.getElementById('shop-count-label');
    if (lbl) lbl.textContent = `${total - chk} remaining · ${chk} checked`;
    const clearBtn = document.getElementById('shop-clear-btn');
    if (clearBtn) clearBtn.style.display = chk > 0 ? 'flex' : 'none';
}

async function deleteShopItem(id) {
    await DB.deleteShopItem(id);
    await loadShopItems();
}

async function clearCheckedShopItems() {
    await DB.deleteCheckedShopItems();
    await loadShopItems();
}

// ── Calorie Trend Chart ───────────────────────────────────
let _trendDays = 7;

function setTrendRange(days) {
    _trendDays = days;
    document.querySelectorAll('.trend-range-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.days) === days);
    });
    loadCalorieTrend();
}

async function loadCalorieTrend() {
    const container = document.getElementById('calorie-trend-chart');
    const stats = document.getElementById('trend-stats');
    if (!container) return;
    container.innerHTML = '<div class="sug-loading" style="padding:16px"><div class="spinner"></div></div>';
    try {
        const trend = await DB.getCalorieTrend(_trendDays);
        const goal = _settings.calorie_goal || 2100;
        const logged = trend.filter(t => t.calories !== null);
        const avgCal = logged.length ? Math.round(logged.reduce((s, t) => s + t.calories, 0) / logged.length) : 0;

        if (!logged.length) {
            container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px;font-size:0.85rem">No data logged yet for this period.</div>';
            stats.innerHTML = '';
            return;
        }

        // Fixed coordinate system: 400 wide × 140 tall
        const W = 400, H = 140, padL = 36, padR = 12, padT = 10, padB = 28;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const n = trend.length;
        const colW = chartW / n;

        const allCals = logged.map(t => t.calories);
        const rawMax = Math.max(...allCals, goal);
        const rawMin = Math.min(...allCals, goal);
        const pad = (rawMax - rawMin) * 0.15 || 200;
        const yMax = rawMax + pad;
        const yMin = Math.max(0, rawMin - pad);
        const yRange = yMax - yMin || 1;

        const toY  = v => padT + chartH - ((v - yMin) / yRange) * chartH;
        const toX  = i => padL + i * colW + colW / 2;
        const barX = i => padL + i * colW + colW * 0.15;
        const barW = colW * 0.7;

        // Y-axis ticks
        let yAxisSVG = '';
        const tickCount = 4;
        for (let ti = 0; ti <= tickCount; ti++) {
            const val = Math.round(yMin + (yRange * ti) / tickCount);
            const y = toY(val);
            yAxisSVG += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--item-border)" stroke-width="0.5"/>`;
            yAxisSVG += `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="7" fill="var(--muted)">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val}</text>`;
        }

        // Bars
        let barsSVG = '';
        trend.forEach((t, i) => {
            if (t.calories === null) return;
            const barH = Math.max(2, toY(yMin) - toY(t.calories));
            const y = toY(t.calories);
            const over = t.calories > goal * 1.05;
            barsSVG += `<rect x="${barX(i)}" y="${y}" width="${barW}" height="${barH}"
                fill="${over ? 'var(--danger)' : 'var(--primary)'}" opacity="0.82" rx="2"/>`;
        });

        // Goal line
        const goalY = toY(goal);
        const goalLineSVG = `<line x1="${padL}" y1="${goalY}" x2="${W - padR}" y2="${goalY}"
            stroke="var(--success)" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.8"/>
            <text x="${W - padR - 2}" y="${goalY - 3}" text-anchor="end" font-size="7" fill="var(--success)">goal</text>`;

        // Rolling avg polyline
        let avgLineSVG = '';
        const avgPts = trend
            .map((t, i) => t.rolling_avg !== null ? `${toX(i)},${toY(t.rolling_avg)}` : null)
            .filter(Boolean);
        if (avgPts.length > 1) {
            avgLineSVG = `<polyline points="${avgPts.join(' ')}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>`;
        }

        // X-axis labels — show max 7, evenly spaced
        let labelsSVG = '';
        const maxLabels = Math.min(7, n);
        const step = Math.ceil(n / maxLabels);
        trend.forEach((t, i) => {
            if (i % step === 0 || i === n - 1) {
                const label = t.date.slice(5); // MM-DD
                labelsSVG += `<text x="${toX(i)}" y="${H - 4}" text-anchor="middle" font-size="7" fill="var(--muted)">${label}</text>`;
            }
        });

        container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible">
            ${yAxisSVG}${barsSVG}${goalLineSVG}${avgLineSVG}${labelsSVG}
        </svg>`;

        stats.innerHTML = `
            <div class="trend-stat"><span>${logged.length}</span><small>days logged</small></div>
            <div class="trend-stat"><span>${avgCal}</span><small>avg kcal</small></div>
            <div class="trend-stat">
                <span style="color:${avgCal > goal ? 'var(--danger)' : 'var(--success)'}">${avgCal > goal ? '+' : ''}${avgCal - goal}</span>
                <small>vs goal</small>
            </div>`;
    } catch (e) {
        container.innerHTML = `<div class="sug-single" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
}

async function loadHistory() {
    try {
        const data = await DB.getHistory(60);
        const container = document.getElementById('history-list');
        const noHist = document.getElementById('no-history');
        container.innerHTML = '';
        if (!data.history.length) { noHist.style.display = 'block'; ri(); return; }
        noHist.style.display = 'none';
        data.history.forEach(d => {
            const calPct = Math.min(100, Math.round((d.total_calories / _settings.calorie_goal) * 100));
            container.innerHTML += `<div class="history-row">
                <span>${d.date}</span>
                <span>${d.total_calories} kcal · ${d.total_protein}g P</span>
                <span style="color:${calPct >= 90 && calPct <= 110 ? 'var(--success)' : 'var(--muted)'}">${d.meal_count} meals</span>
            </div>`;
        });
        ri();
    } catch (err) { console.error(err); }
}

async function exportCSV() {
    try {
        const csv = await DB.exportFoodsCSV();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nutritrack-export.csv';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) { showToast('error', 'Export failed', e.message); }
}

// ── Weight ────────────────────────────────────────────────
async function logWeight() {
    const kg = parseFloat(document.getElementById('weight-kg').value);
    const dt = document.getElementById('weight-date').value;
    const note = document.getElementById('weight-note').value.trim();
    if (!kg || kg < 30 || kg > 300) { showToast('warn', 'Invalid weight', 'Enter a value between 30–300 kg.'); return; }
    await DB.logWeight(dt, kg, note);
    document.getElementById('weight-kg').value = '';
    document.getElementById('weight-note').value = '';
    showToast('success', 'Weight saved', `${kg} kg logged for ${dt}.`);
    loadWeightHistory();
}

async function loadWeightHistory() {
    const data = await DB.getWeightHistory();
    const entries = data.entries;
    const noW = document.getElementById('no-weight');
    const list = document.getElementById('weight-list');
    list.innerHTML = '';

    if (!entries.length) { noW.style.display = 'block'; return; }
    noW.style.display = 'none';

    document.getElementById('w-current').textContent = entries[0].weight_kg.toFixed(1);
    document.getElementById('w-start').textContent = entries[entries.length - 1].weight_kg.toFixed(1);
    const changeEl = document.getElementById('w-change');
    changeEl.textContent = (data.change_kg >= 0 ? '+' : '') + data.change_kg.toFixed(1) + ' kg';
    changeEl.className = 'val ' + (data.change_kg < 0 ? 'trend-down' : data.change_kg > 0 ? 'trend-up' : '');

    // Target weight display
    const targetEl = document.getElementById('w-target');
    const bannerEl = document.getElementById('w-goal-banner');
    const target = _settings.target_weight;
    if (targetEl) targetEl.textContent = target > 0 ? target.toFixed(1) : '--';
    if (bannerEl && target > 0) {
        const current = entries[0].weight_kg;
        const diff = (current - target).toFixed(1);
        const reached = Math.abs(current - target) < 0.5;
        if (reached) {
            bannerEl.innerHTML = `🎉 You've reached your goal weight of ${target} kg!`;
            bannerEl.className = 'w-goal-banner w-goal-reached';
        } else {
            const dir = current > target ? 'lose' : 'gain';
            bannerEl.innerHTML = `${dir === 'lose' ? '📉' : '📈'} ${Math.abs(diff)} kg to ${dir} to reach your ${target} kg goal`;
            bannerEl.className = 'w-goal-banner w-goal-active';
        }
        bannerEl.style.display = 'block';
    } else if (bannerEl) {
        bannerEl.style.display = 'none';
    }

    const chart = document.getElementById('weight-chart');
    chart.innerHTML = '';
    const chartData = [...entries].reverse().slice(-14);
    const minW = Math.min(...chartData.map(e => e.weight_kg)) - 1;
    const maxW = Math.max(...chartData.map(e => e.weight_kg)) + 1;
    chartData.forEach(e => {
        const wrap = document.createElement('div');
        wrap.className = 'weight-bar-wrap';
        const barH = Math.max(4, ((e.weight_kg - minW) / (maxW - minW)) * 90);
        wrap.innerHTML = `<div class="weight-bar" style="height:${barH}px" title="${e.weight_kg} kg on ${e.date}"></div>
            <div class="weight-bar-label">${e.date.slice(5)}</div>`;
        chart.appendChild(wrap);
    });

    entries.forEach((e, i) => {
        const prev = entries[i + 1];
        const diff = prev ? (e.weight_kg - prev.weight_kg) : 0;
        const diffStr = diff !== 0 ? ` <span class="${diff < 0 ? 'trend-down' : 'trend-up'}">(${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>` : '';
        const li = document.createElement('li');
        li.className = 'weight-item';
        li.innerHTML = `
            <div>
                <span style="font-weight:500">${e.weight_kg.toFixed(1)} kg</span>${diffStr}
                ${e.note ? `<div style="font-size:0.75rem;color:var(--muted)">${e.note}</div>` : ''}
            </div>
            <div style="display:flex;gap:10px;align-items:center">
                <span style="color:var(--muted);font-size:0.8rem">${e.date}</span>
                <button class="btn-danger" onclick="deleteWeight('${e.date}')">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>`;
        list.appendChild(li);
    });
    ri();
}

async function deleteWeight(dt) {
    const ok = await showConfirm('scale', 'Delete weight entry?', `Entry for ${dt} will be removed.`, 'Delete');
    if (!ok) return;
    await DB.deleteWeight(dt);
    showToast('info', 'Entry deleted', `Weight for ${dt} removed.`);
    loadWeightHistory();
}

renderWater(0);

// ── Streak ────────────────────────────────────────────────
async function loadStreak() {
    try {
        const data = await DB.getStreak();
        const sv = document.getElementById('streak-val');
        if (sv) sv.textContent = data.streak + (data.streak === 1 ? ' day' : ' days');
        const sc = document.getElementById('streak-current');
        const sl = document.getElementById('streak-longest');
        if (sc) sc.textContent = data.streak + ' days';
        if (sl) sl.textContent = (data.longest || data.streak) + ' days';
    } catch (e) {}
}

// ── Settings Tab ──────────────────────────────────────────
let _settingsDiet = 'veg';

function setSettingsDiet(val, save = true) {
    _settingsDiet = val;
    document.querySelectorAll('[data-settings-diet]').forEach(b => {
        b.classList.toggle('selected', b.dataset.settingsDiet === val);
    });
}

async function loadSettingsTab() {
    await fetchSettings();
    // Profile display
    const pname = document.getElementById('profile-name-display');
    const pmeta = document.getElementById('profile-meta-display');
    if (pname) pname.textContent = _settings.name || 'Not set';
    if (pmeta) {
        const parts = [];
        if (_settings.age) parts.push(_settings.age + ' yrs');
        if (_settings.gender) parts.push(_settings.gender);
        if (_settings.height_cm) parts.push(_settings.height_cm + ' cm');
        pmeta.textContent = parts.join(' · ') || 'Complete onboarding to set profile';
    }
    // Goal inputs
    document.getElementById('set-cal').value = _settings.calorie_goal;
    document.getElementById('set-protein').value = _settings.protein_goal;
    document.getElementById('set-carbs').value = _settings.carbs_goal || 250;
    document.getElementById('set-fat').value = _settings.fat_goal || 65;
    document.getElementById('set-target-weight').value = _settings.target_weight || '';
    document.getElementById('set-water').value = _settings.water_goal;
    document.getElementById('set-height').value = _settings.height_cm;
    // Groq API key
    const groqKeyEl = document.getElementById('set-groq-key');
    if (groqKeyEl) groqKeyEl.value = _settings.groq_api_key || '';
    // Highlight diet chip
    setSettingsDiet(_settings.diet_type || 'veg', false);
    loadBMI();
    loadStreak();
}

async function saveSettings() {
    const payload = {
        calorie_goal: parseInt(document.getElementById('set-cal').value) || 2100,
        protein_goal: parseInt(document.getElementById('set-protein').value) || 90,
        carbs_goal: parseInt(document.getElementById('set-carbs').value) || 250,
        fat_goal: parseInt(document.getElementById('set-fat').value) || 65,
        target_weight: parseFloat(document.getElementById('set-target-weight').value) || 0,
        water_goal: parseInt(document.getElementById('set-water').value) || 10,
        height_cm: parseFloat(document.getElementById('set-height').value) || 170,
        diet_type: _settingsDiet || 'veg',
    };
    // Also update groq_api_key field
    const groqKeyEl = document.getElementById('set-groq-key');
    if (groqKeyEl) payload.groq_api_key = groqKeyEl.value.trim();

    await DB.saveSettings(payload);
    await fetchSettings();
    loadBMI();
    showToast('success', 'Goals saved', `Calories: ${payload.calorie_goal} kcal · Protein: ${payload.protein_goal}g`);
}

// ── BMI ───────────────────────────────────────────────────
async function loadBMI() {
    try {
        const weightData = await DB.getWeightHistory();
        const valEl = document.getElementById('bmi-value');
        const catEl = document.getElementById('bmi-category');
        const detEl = document.getElementById('bmi-detail');
        if (!valEl) return;
        const height_cm = _settings.height_cm;
        const latestWeight = weightData.entries && weightData.entries[0];
        if (!latestWeight || !height_cm) {
            valEl.textContent = '--';
            catEl.textContent = 'Log weight to calculate BMI';
            detEl.textContent = '';
            return;
        }
        const weight_kg = latestWeight.weight_kg;
        const h = height_cm / 100;
        const bmi = Math.round((weight_kg / (h * h)) * 10) / 10;
        const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
        valEl.textContent = bmi;
        const colors = { Normal: 'var(--success)', Underweight: 'var(--warning)', Overweight: 'var(--warning)', Obese: 'var(--danger)' };
        valEl.style.color = colors[cat] || 'var(--primary)';
        catEl.textContent = cat;
        detEl.textContent = `${weight_kg} kg · ${height_cm} cm`;
    } catch (e) {}
}

// ── Meal Planner ──────────────────────────────────────────
// ── Meal Plan Tab init ────────────────────────────────────
function initPlanTab() {
    // Set date input to today
    const dateEl = document.getElementById('plan-date');
    if (dateEl && !dateEl.value) dateEl.value = toLocalDateStr(new Date());
    // Highlight current diet chip
    const diet = _settings ? (_settings.diet_type || 'veg') : 'veg';
    document.querySelectorAll('[data-plan-diet]').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.planDiet === diet);
    });
}

function setPlanDiet(val) {
    if (!_settings) return;
    _settings.diet_type = val;
    // Highlight plan chips
    document.querySelectorAll('[data-plan-diet]').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.planDiet === val);
    });
    // Sync settings tab chips
    setSettingsDiet(val, false);
    // Save to DB
    DB.saveSettings({ diet_type: val }).catch(() => {});
    // Clear suggestions so next load uses new diet
    clearSuggestions();
    document.getElementById('more-suggest-wrap').style.display = 'none';
}

function clearSuggestions() {
    document.getElementById('food-suggest-grid').innerHTML = '';
    document.getElementById('portion-picker').style.display = 'none';
}

let _suggestFoods = [];
let _selectedSuggestIdx = -1;

async function loadFoodSuggestions() {
    const mealType = document.getElementById('plan-meal-type').value;
    const grid = document.getElementById('food-suggest-grid');
    const loading = document.getElementById('food-suggest-loading');
    const picker = document.getElementById('portion-picker');
    grid.innerHTML = '';
    picker.style.display = 'none';
    document.getElementById('more-suggest-wrap').style.display = 'none';
    loading.style.display = 'flex';
    _selectedSuggestIdx = -1;

    try {
        const apiKey = _settings.groq_api_key || '';
        const foods = await Groq.suggestFoods(apiKey, _settings, mealType);
        loading.style.display = 'none';

        _suggestFoods = Array.isArray(foods) ? foods : [];
        if (!_suggestFoods.length) { grid.innerHTML = '<div class="sug-single">No suggestions returned.</div>'; return; }

        _suggestFoods.forEach((food, idx) => {
            const card = document.createElement('div');
            card.className = 'suggest-food-card';
            card.dataset.idx = idx;
            const tags = (food.tags || []).slice(0, 2).map(t =>
                `<span class="suggest-tag">${t}</span>`).join('');
            card.innerHTML = `
                <div class="suggest-food-emoji">${food.emoji || '🍽️'}</div>
                <div class="suggest-food-name">${food.name}</div>
                <div class="suggest-food-meta">${food.kcal_default} kcal · ${food.protein_g}g prot</div>
                <div class="suggest-food-qty">${food.default_qty}</div>
                <div class="suggest-food-tags">${tags}</div>
                <button class="suggest-add-btn" onclick="selectSuggestFood(${idx})">
                    <i data-lucide="plus"></i> Add
                </button>`;
            grid.appendChild(card);
        });
        document.getElementById('more-suggest-wrap').style.display = 'block';
        ri();
    } catch (e) {
        loading.style.display = 'none';
        grid.innerHTML = `<div class="sug-single" style="color:var(--danger)">Error: ${e.message}</div>`;
    }
}

function selectSuggestFood(idx) {
    _selectedSuggestIdx = idx;
    const food = _suggestFoods[idx];
    if (!food) return;

    // Highlight selected card
    document.querySelectorAll('.suggest-food-card').forEach((c, i) => {
        c.classList.toggle('selected', i === idx);
    });

    const picker = document.getElementById('portion-picker');
    const portions = food.portions || [];
    picker.innerHTML = `
        <div class="portion-picker-title">
            <i data-lucide="scale"></i> Choose portion for <strong>${food.name}</strong>
        </div>
        <div class="portion-chips">
            ${portions.map((p, pi) => `
                <button class="portion-chip" onclick="confirmSuggestPortion(${idx}, ${pi})">
                    <span class="portion-chip-label">${p.label}</span>
                    <span class="portion-chip-qty">${p.qty}</span>
                    <span class="portion-chip-kcal">${p.kcal} kcal</span>
                </button>`).join('')}
            <button class="portion-chip portion-chip-custom" onclick="useCustomPortion(${idx})">
                <span class="portion-chip-label">Custom</span>
                <span class="portion-chip-qty">Enter manually below</span>
            </button>
        </div>`;
    picker.style.display = 'block';
    ri();
    picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function confirmSuggestPortion(foodIdx, portionIdx) {
    const food = _suggestFoods[foodIdx];
    const portion = food.portions[portionIdx];
    const planDate = document.getElementById('plan-date').value;
    const mealType = document.getElementById('plan-meal-type').value;

    const entry = await DB.addMealPlan({
        date: planDate, meal_type: mealType,
        description: food.name, quantity: portion.qty,
        planned_calories: portion.kcal
    });
    if (entry) {
        showToast('success', 'Added to plan', `${food.name} · ${portion.qty} · ${portion.kcal} kcal`);
        // Remove card from grid
        const card = document.querySelector(`.suggest-food-card[data-idx="${foodIdx}"]`);
        if (card) { card.classList.add('suggest-card-done'); card.querySelector('.suggest-add-btn').disabled = true; }
        document.getElementById('portion-picker').style.display = 'none';
        loadMealPlan();
    }
}

function useCustomPortion(foodIdx) {
    const food = _suggestFoods[foodIdx];
    document.getElementById('portion-picker').style.display = 'none';
    // Pre-fill manual form
    document.getElementById('plan-desc').value = food.name;
    document.getElementById('plan-cal').value = food.kcal_default;
    if (document.getElementById('plan-qty')) document.getElementById('plan-qty').value = food.default_qty;
    // Open manual section
    const details = document.querySelector('.plan-manual-details');
    if (details) details.open = true;
    document.getElementById('plan-desc').focus();
}

let _planWeekOffset = 0;

function getPlanWeekStart(offset) {
    const today = new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(),
        today.getDate() - ((today.getDay() + 6) % 7) + offset * 7);
    return toLocalDateStr(monday);
}

function shiftPlanWeek(delta) {
    _planWeekOffset += delta;
    loadMealPlan();
}

async function loadMealPlan() {
    const weekStart = getPlanWeekStart(_planWeekOffset);
    const data = await DB.getMealPlan(weekStart);
    const calendar = document.getElementById('plan-calendar');
    const weekLabel = document.getElementById('plan-week-label');
    calendar.innerHTML = '';
    weekLabel.textContent = 'Week of ' + (data.week_start || weekStart);

    const days = {};
    (data.plans || []).forEach(p => { if (!days[p.date]) days[p.date] = []; days[p.date].push(p); });

    const today = toLocalDateStr(new Date());

    for (let i = 0; i < 7; i++) {
        const [y, m, d] = data.week_start.split('-').map(Number);
        const dt = new Date(y, m - 1, d + i);
        const dStr = toLocalDateStr(dt);
        const dayName = dt.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
        const items = days[dStr] || [];
        const count = items.length;
        const isToday = dStr === today;
        const totalCal = items.reduce((s, p) => s + (p.planned_calories || 0), 0);

        const details = document.createElement('details');
        if (isToday || count > 0) details.open = true;
        details.style.cssText = `border:1px solid ${isToday ? 'var(--primary)' : 'var(--item-border)'};border-radius:8px;overflow:hidden`;

        const summary = document.createElement('summary');
        summary.style.cssText = 'list-style:none;padding:10px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;background:var(--card)';
        summary.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:0.82rem;font-weight:600;color:${isToday ? 'var(--primary)' : 'var(--text)'}">
                    ${dayName}${isToday ? ' <span style="font-size:0.68rem;background:var(--primary);color:#fff;padding:1px 6px;border-radius:4px;margin-left:4px">Today</span>' : ''}
                </span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
                ${count > 0
                    ? `<span style="font-size:0.73rem;color:var(--muted)">${count} meal${count > 1 ? 's' : ''}${totalCal ? ' · ' + totalCal + ' kcal' : ''}</span>`
                    : `<span style="font-size:0.7rem;color:var(--muted)">Nothing planned</span>`}
                <i data-lucide="${count > 0 ? 'chevron-down' : 'chevron-right'}" style="width:14px;height:14px;stroke:var(--muted)"></i>
            </div>`;

        const body = document.createElement('div');
        body.style.cssText = 'padding:4px 12px 10px;display:flex;flex-direction:column;gap:6px;background:var(--macro-bg)';

        if (!count) {
            body.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);padding:6px 0">No meals planned. Use the form above.</div>';
        } else {
            items.forEach(p => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--card);border-radius:7px;border:1px solid var(--item-border)';
                row.innerHTML = `
                    <div>
                        <div style="font-size:0.83rem;font-weight:500">${p.description}</div>
                        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;display:flex;align-items:center;gap:4px">
                            <i data-lucide="clock" style="width:11px;height:11px;stroke:var(--muted)"></i>
                            ${p.meal_type}${p.quantity ? ' · <i data-lucide="scale" style="width:10px;height:10px;stroke:var(--muted)"></i> ' + p.quantity : ''}${p.planned_calories ? ' · ' + p.planned_calories + ' kcal' : ''}
                        </div>
                    </div>
                    <button onclick="deleteMealPlan(${p.id})" style="background:none;border:none;cursor:pointer;color:var(--danger);padding:4px;display:flex;align-items:center" title="Remove">
                        <i data-lucide="x" style="width:15px;height:15px;stroke:var(--danger)"></i>
                    </button>`;
                body.appendChild(row);
            });
        }

        details.appendChild(summary);
        details.appendChild(body);
        calendar.appendChild(details);
    }
    ri();
}

async function addMealPlan() {
    const planDate = document.getElementById('plan-date').value;
    const mealType = document.getElementById('plan-meal-type').value;
    const desc = document.getElementById('plan-desc').value.trim();
    const qty = (document.getElementById('plan-qty') || {}).value || '';
    const cal = parseInt(document.getElementById('plan-cal').value) || 0;
    if (!desc) { showToast('warn', 'Empty', 'Enter a meal description.'); return; }
    await DB.addMealPlan({ date: planDate, meal_type: mealType, description: desc, quantity: qty, planned_calories: cal });
    document.getElementById('plan-desc').value = '';
    document.getElementById('plan-cal').value = '';
    if (document.getElementById('plan-qty')) document.getElementById('plan-qty').value = '';
    showToast('success', 'Planned!', `${mealType}: ${desc}${qty ? ' (' + qty + ')' : ''}`);
    loadMealPlan();
}

async function deleteMealPlan(id) {
    const ok = await showConfirm('trash-2', 'Remove plan?', 'This planned meal will be deleted.', 'Remove');
    if (!ok) return;
    await DB.deleteMealPlan(id);
    loadMealPlan();
}

// ── PWA Service Worker ────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered, scope:', reg.scope))
            .catch(err => console.warn('SW registration failed:', err));
    });
}
