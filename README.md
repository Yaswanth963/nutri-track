# nutri-track


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

### 1. Run Locally
```bash
cd diet-tracker
pip install -r requirements.txt
export GEMINI_API_KEY="your-gemini-key"
# For local dev, SQLite is used automatically (no DATABASE_URL needed)
python app.py
```
Open http://localhost:5000


<img width="479" height="856" alt="image" src="https://github.com/user-attachments/assets/7b6d2b0a-6edb-436a-8003-df074b755671" />
<img width="459" height="736" alt="image" src="https://github.com/user-attachments/assets/7868d194-b4f1-462e-86cb-b9ca6ffad1c0" />
<img width="464" height="829" alt="image" src="https://github.com/user-attachments/assets/2e32f434-fe9e-43a8-a055-502b34b2cf2f" />
<img width="465" height="888" alt="image" src="https://github.com/user-attachments/assets/cbc1269a-173a-435d-88a5-dcea7013c9a1" />



