/* ── groq.js — NutriTrack direct Groq API calls ── */
'use strict';

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function _parseAIJson(text) {
    text = text.trim();
    if (text.startsWith('```')) text = text.split('\n').slice(1).join('\n');
    if (text.includes('```')) text = text.split('```')[0];
    text = text.trim();
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{' || text[i] === '[') {
            try { return JSON.parse(text.slice(i)); } catch (e) {}
        }
    }
    throw new Error('No valid JSON in AI response');
}

async function groqChat(apiKey, prompt, maxTokens = 512) {
    if (!apiKey) throw new Error('No Groq API key set. Add it in Settings → AI API Key.');
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Groq error ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
}

async function groqChatVision(apiKey, prompt, imageBase64, maxTokens = 512) {
    if (!apiKey) throw new Error('No Groq API key set. Add it in Settings → AI API Key.');
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                ]
            }],
            max_tokens: maxTokens,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Groq error ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
}

const FOOD_PROMPT = `Analyze this food and estimate nutrition for the described portion.
Return ONLY valid JSON (no markdown, no code blocks):
{
    "food_name": "name of food",
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "health_score": 1-10,
    "suggestion": "brief suggestion"
}
Assume realistic Indian home-cooked portions. If multiple items, sum them.`;

const Groq = {
    async analyzeFood(apiKey, description, imageBase64 = null) {
        try {
            const prompt = FOOD_PROMPT + (description ? `\nFood: ${description}` : '');
            const text = imageBase64
                ? await groqChatVision(apiKey, prompt, imageBase64, 512)
                : await groqChat(apiKey, prompt, 512);
            return _parseAIJson(text);
        } catch (e) {
            return {
                food_name: description || 'Unknown',
                calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
                health_score: 5, suggestion: e.message,
            };
        }
    },

    async getSuggestion(apiKey, settings, foods, waterGlasses) {
        if (!foods.length) return 'No meals logged yet today — start tracking!';
        const intake = foods.map(f => `- ${f.description} (${f.calories} kcal)`).join('\n');
        const cal = foods.reduce((s, f) => s + f.calories, 0);
        const prot = foods.reduce((s, f) => s + f.protein_g, 0).toFixed(1);
        const carbs = foods.reduce((s, f) => s + f.carbs_g, 0).toFixed(1);
        const fat = foods.reduce((s, f) => s + f.fat_g, 0).toFixed(1);
        const prompt = `Today's food intake for an Indian person:
${intake}
Totals: ${cal} kcal, ${prot}g protein, ${carbs}g carbs, ${fat}g fat. Water: ${waterGlasses}/${settings.water_goal || 10} glasses.
Goals: ~${settings.calorie_goal} kcal/day, ~${settings.protein_goal}g protein/day.
Give 2-3 short actionable suggestions. Return ONLY valid JSON: {"suggestion": "..."}`;
        try {
            const text = await groqChat(apiKey, prompt, 300);
            const parsed = _parseAIJson(text);
            return parsed.suggestion || text;
        } catch (e) {
            return e.message;
        }
    },

    async generateRecipe(apiKey, dish) {
        const prompt = `Generate a detailed recipe for: ${dish}
Provide for Indian cooking style with common ingredients. Include nutrition per serving.
Return ONLY valid JSON:
{
  "title": "recipe title",
  "servings": number,
  "prep_time": "X mins",
  "cook_time": "X mins",
  "ingredients": ["item 1", "item 2"],
  "instructions": ["step 1", "step 2"],
  "nutrition_per_serving": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number},
  "tips": "optional tip"
}`;
        const text = await groqChat(apiKey, prompt, 1000);
        return _parseAIJson(text);
    },

    async suggestFoods(apiKey, settings, mealType) {
        const dietLabels = { veg: 'vegetarian (no meat/eggs)', egg: 'vegetarian + eggs', nonveg: 'non-vegetarian' };
        const budgets = { morning: 0.10, breakfast: 0.25, lunch: 0.35, snack: 0.10, dinner: 0.30 };
        const budget = Math.round((settings.calorie_goal || 2100) * (budgets[mealType] || 0.25));
        const dietLabel = dietLabels[settings.diet_type || 'veg'];
        const prompt = `Suggest 6 Indian foods suitable for a ${mealType} meal.
Diet preference: ${dietLabel}. Calorie budget for this meal: ~${budget} kcal. Goal: ${settings.goal_type || 'maintain'}.
Return ONLY a valid JSON array (no markdown, no code blocks):
[
  {
    "name": "Food Name",
    "emoji": "emoji",
    "kcal_default": number,
    "protein_g": number,
    "default_qty": "e.g. 1 medium bowl",
    "portions": [
      {"label": "Small",  "qty": "description + grams", "kcal": number},
      {"label": "Medium", "qty": "description + grams", "kcal": number},
      {"label": "Large",  "qty": "description + grams", "kcal": number}
    ],
    "tags": ["high-protein","low-fat","fibre-rich","low-carb","quick"]
  }
]
Mix variety: include at least 1 high-protein option.`;
        const text = await groqChat(apiKey, prompt, 1200);
        return _parseAIJson(text);
    },

    async nutritionGaps(apiKey, settings, foods) {
        if (!foods.length) throw new Error('No meals logged yet today');
        const intake = foods.map(f => `- ${f.description} (${f.calories} kcal)`).join('\n');
        const cal = foods.reduce((s, f) => s + f.calories, 0);
        const prot = foods.reduce((s, f) => s + f.protein_g, 0).toFixed(1);
        const carbs = foods.reduce((s, f) => s + f.carbs_g, 0).toFixed(1);
        const fat = foods.reduce((s, f) => s + f.fat_g, 0).toFixed(1);
        const prompt = `Analyze today's meals for an Indian person and estimate their micronutrient gaps.
Meals eaten: ${intake}
Totals: ${cal} kcal, ${prot}g protein, ${carbs}g carbs, ${fat}g fat.
Diet type: ${settings.diet_type || 'veg'}. Goal: ${settings.goal_type || 'maintain'}.
Return ONLY valid JSON:
{"score":1-10,"summary":"one sentence","gaps":[{"nutrient":"Fiber","emoji":"🌾","status":"low|ok|good","tip":"short tip","foods":["food1"]}]}`;
        const text = await groqChat(apiKey, prompt, 800);
        return _parseAIJson(text);
    },

    async mealSwap(apiKey, settings, foods) {
        if (!foods.length) throw new Error('No meals logged yet today');
        const intake = foods.map(f => `- ${f.description} at ${f.time} (${f.calories} kcal, ${f.protein_g.toFixed(1)}g P)`).join('\n');
        const calGoal = settings.calorie_goal || 2100;
        const protGoal = settings.protein_goal || 90;
        const totalCal = foods.reduce((s, f) => s + f.calories, 0);
        const totalProt = foods.reduce((s, f) => s + f.protein_g, 0).toFixed(1);
        const hour = new Date().getHours();
        const timeOfDay = hour < 10 ? 'morning' : hour < 16 ? 'afternoon' : 'evening';
        const prompt = `Today's meals:
${intake}
Totals: ${totalCal} kcal (${Math.round(totalCal/calGoal*100)}% of ${calGoal}), ${totalProt}g protein (${Math.round(totalProt/protGoal*100)}% of ${protGoal}g).
Diet: ${settings.diet_type || 'veg'}. Remaining: ${Math.max(0, calGoal-totalCal)} kcal. Time: ${timeOfDay}.
Identify 2 issues and suggest swaps. Return ONLY valid JSON:
{"issues":[{"icon":"lucide-icon","problem":"short","swap":"specific food+portion","kcal_impact":"+50 kcal","benefit":"brief"}]}`;
        const text = await groqChat(apiKey, prompt, 600);
        return _parseAIJson(text);
    },

    async shoppingList(apiKey, settings, mealPlans) {
        const planText = mealPlans.map(p => `- ${p.date} ${p.meal_type}: ${p.description}`).join('\n');
        const prompt = `Generate a shopping list for this Indian weekly meal plan:
${planText || 'No specific plan, generate a balanced weekly list'}
Diet type: ${settings.diet_type || 'veg'}. 1 person.
Return ONLY valid JSON:
{"categories":[{"name":"Vegetables","emoji":"🥬","items":[{"name":"item","qty":"500g","approx_price":"₹30","tip":"tip"}]}],"estimated_total":"₹XXX","tips":["tip1"]}`;
        const text = await groqChat(apiKey, prompt, 1200);
        return _parseAIJson(text);
    },
};
