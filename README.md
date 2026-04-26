# Diet Tracker 🥗

AI-powered diet tracking app — calorie tracking, weight tracking, water reminders, personalized suggestions. Fully persistent data.

## Features
- **AI Food Analysis** — Upload a photo or type what you ate; Gemini AI estimates calories & macros
- **Daily Tracking** — Calories, protein, carbs, fat with progress bars
- **Weight Tracking** — Log daily weight, bar chart trend, gain/loss tracking
- **Water Reminders** — Browser notifications every 45 min + 10-glass visual tracker
- **AI Suggestions** — Personalized tips based on your daily intake vs. goals
- **History** — 30-day food & weight history, all persisted in PostgreSQL

## Setup

### 1. Get Free API Keys

**Gemini API (AI food analysis)** — Free, 15 req/min:
1. Go to https://aistudio.google.com/apikey
2. Click "Create API key" — copy it

**Supabase (Free PostgreSQL database, data persists forever)**:
1. Go to https://supabase.com → New Project (free tier)
2. After creation: Settings → Database → Connection string → copy the URI
3. It looks like: `postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres`

### 2. Run Locally
```bash
cd diet-tracker
pip install -r requirements.txt
export GEMINI_API_KEY="your-gemini-key"
# For local dev, SQLite is used automatically (no DATABASE_URL needed)
python app.py
```
Open http://localhost:5000

### 3. Deploy to Render (Free, Persistent)
1. Push the `diet-tracker/` folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Set:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
5. Add Environment Variables:
   - `GEMINI_API_KEY` = your Gemini key
   - `DATABASE_URL` = your Supabase connection string
6. Deploy — you get a free URL like `https://diet-tracker-xxxx.onrender.com`

> Data is stored in Supabase PostgreSQL — persists across all deploys permanently.

## Monthly Cost: ₹0
- Gemini API: Free (15 RPM)
- Supabase: Free (500MB PostgreSQL)
- Render: Free (750 hrs/month)
