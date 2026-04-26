import os
import io
import csv
import json
from datetime import datetime, date, timedelta
from flask import Flask, request, jsonify, render_template, Response
from werkzeug.utils import secure_filename
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Text,
    func, desc
)
from sqlalchemy.orm import DeclarativeBase, Session
from groq import Groq
import base64

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

# DATA_DIR: persistent storage root.
# - Locally: same folder as app.py
# - Render with disk mounted at /data: set DATA_DIR=/data in env vars
DATA_DIR = os.environ.get("DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOADS_DIR

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}

# --- Database ---
# Uses DATABASE_URL env var (PostgreSQL on Supabase/Render).
# Falls back to local SQLite for development.
_db_url = os.environ.get("DATABASE_URL", "")
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)
if not _db_url:
    _db_url = "sqlite:///" + os.path.join(DATA_DIR, "diet_tracker.db")

engine = create_engine(_db_url, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


class FoodLog(Base):
    __tablename__ = "food_log"
    id = Column(Integer, primary_key=True)
    date = Column(String(10), nullable=False, index=True)
    time = Column(String(5), nullable=False)
    meal_type = Column(String(20), nullable=False)
    description = Column(Text, nullable=False)
    calories = Column(Integer, default=0)
    protein_g = Column(Float, default=0)
    carbs_g = Column(Float, default=0)
    fat_g = Column(Float, default=0)
    ai_analysis = Column(Text)
    image_path = Column(String(200))


class WaterLog(Base):
    __tablename__ = "water_log"
    id = Column(Integer, primary_key=True)
    date = Column(String(10), nullable=False, unique=True, index=True)
    glasses = Column(Integer, default=0)


class WeightLog(Base):
    __tablename__ = "weight_log"
    id = Column(Integer, primary_key=True)
    date = Column(String(10), nullable=False, unique=True, index=True)
    weight_kg = Column(Float, nullable=False)
    note = Column(String(200))


class UserSettings(Base):
    __tablename__ = "user_settings"
    id = Column(Integer, primary_key=True)
    # Profile
    name = Column(String(100), default="")
    age = Column(Integer, default=0)
    gender = Column(String(10), default="")
    activity_level = Column(String(20), default="moderate")
    goal_type = Column(String(10), default="maintain")
    onboarding_done = Column(Integer, default=0)
    diet_type = Column(String(10), default="veg")   # veg | egg | nonveg
    # Goals
    calorie_goal = Column(Integer, default=2100)
    protein_goal = Column(Integer, default=90)
    carbs_goal = Column(Integer, default=250)
    fat_goal = Column(Integer, default=65)
    water_goal = Column(Integer, default=10)
    height_cm = Column(Float, default=170)
    target_weight = Column(Float, default=0)


class MealPlan(Base):
    __tablename__ = "meal_plan"
    id = Column(Integer, primary_key=True)
    date = Column(String(10), nullable=False, index=True)
    meal_type = Column(String(20), nullable=False)
    description = Column(Text, nullable=False)
    planned_calories = Column(Integer, default=0)
    quantity = Column(String(50), default="")  # e.g. "1 medium bowl", "250g"


class ShoppingItem(Base):
    __tablename__ = "shopping_item"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    category = Column(String(50), default="Other")
    quantity = Column(String(100), default="")
    checked = Column(Integer, default=0)
    created_at = Column(String(30), default="")


class Expense(Base):
    __tablename__ = "expense"
    id = Column(Integer, primary_key=True)
    date = Column(String(10), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(50), default="Food")
    type = Column(String(10), default="debit")       # debit | credit
    payment_method = Column(String(30), default="UPI")
    note = Column(Text, default="")
    created_at = Column(String(30), default="")


Base.metadata.create_all(engine)


def get_settings():
    with Session(engine) as s:
        row = s.query(UserSettings).first()
        if not row:
            row = UserSettings()
            s.add(row)
            s.commit()
            s.refresh(row)
        return {
            "name": row.name or "",
            "age": row.age or 0,
            "gender": row.gender or "",
            "activity_level": row.activity_level or "moderate",
            "goal_type": row.goal_type or "maintain",
            "onboarding_done": row.onboarding_done or 0,
            "diet_type": row.diet_type or "veg",
            "calorie_goal": row.calorie_goal,
            "protein_goal": row.protein_goal,
            "carbs_goal": row.carbs_goal,
            "fat_goal": row.fat_goal,
            "water_goal": row.water_goal,
            "height_cm": row.height_cm,
            "target_weight": row.target_weight or 0,
        }


# --- Groq AI ---
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

FOOD_PROMPT = """Analyze this food and estimate nutrition for the described portion.
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
Assume realistic Indian home-cooked portions. If multiple items, sum them."""

SUGGEST_FOODS_PROMPT = """Suggest 6 Indian foods suitable for a {meal_type} meal.
Diet preference: {diet_label}. Calorie budget for this meal: ~{budget} kcal. Goal: {goal}.
Return ONLY a valid JSON array (no markdown, no code blocks):
[
  {{
    "name": "Food Name",
    "emoji": "emoji",
    "kcal_default": number,
    "protein_g": number,
    "default_qty": "e.g. 1 medium bowl",
    "portions": [
      {{"label": "Small",  "qty": "description + grams", "kcal": number}},
      {{"label": "Medium", "qty": "description + grams", "kcal": number}},
      {{"label": "Large",  "qty": "description + grams", "kcal": number}}
    ],
    "tags": ["high-protein"|"low-fat"|"fibre-rich"|"low-carb"|"quick"]
  }}
]
Mix variety: include at least 1 high-protein option. Vary the calorie ranges. Be specific with quantities (use grams or pieces, not vague)."""


SUGGESTION_PROMPT = """Today's food intake for an Indian person (vegetarian, occasional eggs):
{intake}
Totals: {calories} kcal, {protein}g protein, {carbs}g carbs, {fat}g fat. Water: {water}/{water_goal} glasses.
Goals: ~{calorie_goal} kcal/day, ~{protein_goal}g protein/day. Budget: rupees 3-4k/month.
Give 2-3 short actionable suggestions. Return ONLY valid JSON: {{"suggestion": "..."}}"""

NUTRITION_GAP_PROMPT = """Analyze today's meals for an Indian person and estimate their micronutrient gaps.
Meals eaten: {intake}
Totals: {calories} kcal, {protein}g protein, {carbs}g carbs, {fat}g fat.
Diet type: {diet_type}. Goal: {goal}.

Return ONLY valid JSON (no markdown):
{{
  "score": 1-10,
  "summary": "one sentence overall assessment",
  "gaps": [
    {{"nutrient": "Fiber", "emoji": "🌾", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}},
    {{"nutrient": "Iron", "emoji": "🩸", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}},
    {{"nutrient": "Calcium", "emoji": "🦴", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}},
    {{"nutrient": "Vitamin C", "emoji": "🍋", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}},
    {{"nutrient": "Vitamin B12", "emoji": "💊", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}},
    {{"nutrient": "Healthy Fats", "emoji": "🥑", "status": "low|ok|good", "tip": "short fix tip", "foods": ["food1","food2"]}}
  ]
}}
Be realistic based on the food eaten."""

MEAL_SWAP_PROMPT = """Today's meals for an Indian person:
{intake}
Totals so far: {calories} kcal ({calorie_pct}% of {calorie_goal} kcal goal), {protein}g protein ({protein_pct}% of {protein_goal}g goal).
Diet type: {diet_type}. Remaining budget: {remaining_cal} kcal.
Time of day: {time_of_day} (so suggest what to eat next).

Identify 2 issues (e.g. too many carbs, low protein, missing vegetables) and for each suggest a specific swap or addition.
Return ONLY valid JSON (no markdown):
{{
  "issues": [
    {{
      "icon": "lucide-icon-name",
      "problem": "short problem description",
      "swap": "concrete suggestion with specific food and portion",
      "kcal_impact": "+50 kcal" or "-100 kcal",
      "benefit": "brief benefit"
    }}
  ]
}}"""

SHOPPING_LIST_PROMPT = """Generate a shopping list for the following Indian weekly meal plan:
{meal_plan}
Diet type: {diet_type}. Number of people: 1.

Group items by category. For each item, estimate a realistic quantity for the week and approximate Indian market price in rupees.
Return ONLY valid JSON (no markdown):
{{
  "categories": [
    {{
      "name": "Vegetables & Fruits",
      "emoji": "🥬",
      "items": [
        {{"name": "item", "qty": "500g", "approx_price": "₹30", "tip": "optional storage tip"}}
      ]
    }}
  ],
  "estimated_total": "₹XXX",
  "tips": ["budget tip 1", "budget tip 2"]
}}"""


def _parse_ai_json(text):
    text = text.strip()
    # Strip markdown fences
    if text.startswith("```"):
        text = "\n".join(text.split("\n")[1:])
    if "```" in text:
        text = text.rsplit("```", 1)[0]
    text = text.strip()
    # Find the first valid JSON object or array, ignoring any surrounding prose
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch in ('{', '['):
            try:
                obj, _ = decoder.raw_decode(text, i)
                return obj
            except json.JSONDecodeError:
                continue
    raise json.JSONDecodeError("No valid JSON found", text, 0)


def analyze_food(description=None, image_bytes=None):
    if not _client:
        return {
            "food_name": description or "Unknown",
            "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0,
            "health_score": 5,
            "suggestion": "Set GROQ_API_KEY to enable AI analysis.",
        }
    try:
        messages = [{"role": "user", "content": []}]
        text_content = FOOD_PROMPT
        if description:
            text_content += f"\nFood: {description}"
        if image_bytes:
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            messages[0]["content"] = [
                {"type": "text", "text": text_content},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]
        else:
            messages[0]["content"] = text_content
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=messages,
            max_tokens=512,
        )
        return _parse_ai_json(resp.choices[0].message.content)
    except Exception as e:
        app.logger.error(f"AI food error: {e}")
        return {
            "food_name": description or "Unknown",
            "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0,
            "health_score": 5, "suggestion": str(e)[:120],
        }


def get_daily_suggestion(target_date):
    if not _client:
        return "Set GROQ_API_KEY for personalized suggestions."
    settings = get_settings()
    with Session(engine) as s:
        rows = s.query(FoodLog).filter(FoodLog.date == target_date).all()
        water = s.query(WaterLog).filter(WaterLog.date == target_date).first()
    if not rows:
        return "No meals logged yet today — start tracking!"
    intake = "\n".join(f"- {r.description} ({r.calories} kcal)" for r in rows)
    totals = {
        "calories": sum(r.calories for r in rows),
        "protein": round(sum(r.protein_g for r in rows), 1),
        "carbs": round(sum(r.carbs_g for r in rows), 1),
        "fat": round(sum(r.fat_g for r in rows), 1),
        "water": water.glasses if water else 0,
        "water_goal": settings["water_goal"],
        "calorie_goal": settings["calorie_goal"],
        "protein_goal": settings["protein_goal"],
    }
    try:
        resp = _client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": SUGGESTION_PROMPT.format(intake=intake, **totals)}],
            max_tokens=256,
        )
        return _parse_ai_json(resp.choices[0].message.content).get("suggestion", "Keep it up!")
    except Exception as e:
        app.logger.error(f"Suggestion error: {e}")
        return "Keep tracking — you're doing great!"


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/sw.js")
def service_worker():
    return app.send_static_file("sw.js"), 200, {
        "Content-Type": "application/javascript",
        "Service-Worker-Allowed": "/"
    }

@app.route("/manifest.json")
def manifest():
    return app.send_static_file("manifest.json"), 200, {
        "Content-Type": "application/manifest+json"
    }


@app.route("/api/search-food", methods=["GET"])
def search_food():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "No query provided"})
    result = analyze_food(description=query)
    return jsonify(result)


@app.route("/api/log-food", methods=["POST"])
def log_food():
    description = request.form.get("description", "").strip()
    meal_type = request.form.get("meal_type", "snack")
    image_bytes = None
    image_path = None

    f = request.files.get("image")
    if f and f.filename and allowed_file(f.filename):
        filename = secure_filename(f.filename)
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{filename}"
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        f.save(filepath)
        image_path = filename
        with open(filepath, "rb") as fp:
            image_bytes = fp.read()

    if not description and not image_bytes:
        return jsonify({"error": "Provide a description or image"}), 400

    analysis = analyze_food(description, image_bytes)

    # Delete image after analysis (no need to store permanently)
    if image_path:
        try:
            os.remove(os.path.join(app.config["UPLOAD_FOLDER"], image_path))
        except OSError:
            pass
        image_path = None

    with Session(engine) as s:
        log_date = request.form.get("log_date") or date.today().isoformat()
        s.add(FoodLog(
            date=log_date,
            time=datetime.now().strftime("%H:%M"),
            meal_type=meal_type,
            description=analysis.get("food_name", description),
            calories=analysis.get("calories", 0),
            protein_g=analysis.get("protein_g", 0),
            carbs_g=analysis.get("carbs_g", 0),
            fat_g=analysis.get("fat_g", 0),
            ai_analysis=json.dumps(analysis),
            image_path=image_path,
        ))
        s.commit()

    return jsonify({"success": True, "analysis": analysis})


@app.route("/api/daily-summary")
def daily_summary():
    target = request.args.get("date", date.today().isoformat())
    with Session(engine) as s:
        foods = s.query(FoodLog).filter(FoodLog.date == target).order_by(FoodLog.time).all()
        water = s.query(WaterLog).filter(WaterLog.date == target).first()

    food_list = [
        {
            "id": f.id, "time": f.time, "meal_type": f.meal_type,
            "description": f.description, "calories": f.calories,
            "protein_g": round(f.protein_g, 1), "carbs_g": round(f.carbs_g, 1),
            "fat_g": round(f.fat_g, 1),
        }
        for f in foods
    ]
    totals = {
        "calories": sum(f["calories"] for f in food_list),
        "protein_g": round(sum(f["protein_g"] for f in food_list), 1),
        "carbs_g": round(sum(f["carbs_g"] for f in food_list), 1),
        "fat_g": round(sum(f["fat_g"] for f in food_list), 1),
        "water_glasses": water.glasses if water else 0,
    }
    return jsonify({"date": target, "foods": food_list, "totals": totals})


@app.route("/api/suggestion")
def suggestion():
    target = request.args.get("date", date.today().isoformat())
    return jsonify({"suggestion": get_daily_suggestion(target)})


@app.route("/api/water", methods=["POST"])
def log_water():
    today = date.today().isoformat()
    with Session(engine) as s:
        row = s.query(WaterLog).filter(WaterLog.date == today).first()
        if row:
            row.glasses += 1
            count = row.glasses
        else:
            s.add(WaterLog(date=today, glasses=1))
            count = 1
        s.commit()
    return jsonify({"glasses": count, "target": 10})


@app.route("/api/water/reset", methods=["POST"])
def reset_water():
    today = date.today().isoformat()
    with Session(engine) as s:
        row = s.query(WaterLog).filter(WaterLog.date == today).first()
        if row:
            row.glasses = 0
            s.commit()
    return jsonify({"glasses": 0, "target": 10})


@app.route("/api/water/set", methods=["POST"])
def set_water():
    data = request.get_json() or {}
    glasses = max(0, int(data.get("glasses", 0)))
    today = date.today().isoformat()
    with Session(engine) as s:
        row = s.query(WaterLog).filter(WaterLog.date == today).first()
        if row:
            row.glasses = glasses
        else:
            s.add(WaterLog(date=today, glasses=glasses))
        s.commit()
    return jsonify({"glasses": glasses})


@app.route("/api/delete-food/<int:food_id>", methods=["DELETE"])
def delete_food(food_id):
    with Session(engine) as s:
        row = s.query(FoodLog).filter(FoodLog.id == food_id).first()
        if row:
            s.delete(row)
            s.commit()
    return jsonify({"success": True})


@app.route("/api/history")
def history():
    with Session(engine) as s:
        rows = (
            s.query(
                FoodLog.date,
                func.sum(FoodLog.calories).label("total_calories"),
                func.round(func.sum(FoodLog.protein_g), 1).label("total_protein"),
                func.round(func.sum(FoodLog.carbs_g), 1).label("total_carbs"),
                func.round(func.sum(FoodLog.fat_g), 1).label("total_fat"),
                func.count(FoodLog.id).label("meal_count"),
            )
            .group_by(FoodLog.date)
            .order_by(desc(FoodLog.date))
            .limit(30)
            .all()
        )
    return jsonify({
        "history": [
            {
                "date": r.date, "total_calories": r.total_calories,
                "total_protein": r.total_protein, "total_carbs": r.total_carbs,
                "total_fat": r.total_fat, "meal_count": r.meal_count,
            }
            for r in rows
        ]
    })


# --- Weight tracking ---
@app.route("/api/log-weight", methods=["POST"])
def log_weight():
    data = request.get_json()
    weight_kg = data.get("weight_kg")
    log_date = data.get("date", date.today().isoformat())
    note = data.get("note", "")

    if not weight_kg or float(weight_kg) <= 0:
        return jsonify({"error": "Invalid weight"}), 400

    with Session(engine) as s:
        existing = s.query(WeightLog).filter(WeightLog.date == log_date).first()
        if existing:
            existing.weight_kg = float(weight_kg)
            existing.note = note
        else:
            s.add(WeightLog(date=log_date, weight_kg=float(weight_kg), note=note))
        s.commit()

    return jsonify({"success": True, "weight_kg": float(weight_kg), "date": log_date})


@app.route("/api/weight-history")
def weight_history():
    with Session(engine) as s:
        rows = (
            s.query(WeightLog)
            .order_by(desc(WeightLog.date))
            .limit(60)
            .all()
        )
    entries = [
        {"date": r.date, "weight_kg": r.weight_kg, "note": r.note or ""}
        for r in rows
    ]
    change_kg = 0
    if len(entries) >= 2:
        change_kg = round(entries[0]["weight_kg"] - entries[-1]["weight_kg"], 1)
    return jsonify({"entries": entries, "change_kg": change_kg})


@app.route("/api/delete-weight/<string:log_date>", methods=["DELETE"])
def delete_weight(log_date):
    with Session(engine) as s:
        row = s.query(WeightLog).filter(WeightLog.date == log_date).first()
        if row:
            s.delete(row)
            s.commit()
    return jsonify({"success": True})


# --- Settings ---
@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    return jsonify(get_settings())


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    data = request.get_json() or {}
    with Session(engine) as s:
        row = s.query(UserSettings).first()
        if not row:
            row = UserSettings()
            s.add(row)
        if "calorie_goal" in data:
            row.calorie_goal = max(500, int(data["calorie_goal"]))
        if "protein_goal" in data:
            row.protein_goal = max(10, int(data["protein_goal"]))
        if "carbs_goal" in data:
            row.carbs_goal = max(10, int(data["carbs_goal"]))
        if "fat_goal" in data:
            row.fat_goal = max(5, int(data["fat_goal"]))
        if "water_goal" in data:
            row.water_goal = max(1, int(data["water_goal"]))
        if "height_cm" in data:
            row.height_cm = max(50.0, float(data["height_cm"]))
        if "target_weight" in data:
            row.target_weight = max(0.0, float(data["target_weight"]))
        if "name" in data:
            row.name = str(data["name"])[:100]
        if "age" in data:
            row.age = max(0, int(data["age"]))
        if "gender" in data:
            row.gender = str(data["gender"])[:10]
        if "activity_level" in data:
            row.activity_level = str(data["activity_level"])[:20]
        if "goal_type" in data:
            row.goal_type = str(data["goal_type"])[:10]
        if "onboarding_done" in data:
            row.onboarding_done = 1 if data["onboarding_done"] else 0
        if "diet_type" in data and data["diet_type"] in ("veg", "egg", "nonveg"):
            row.diet_type = data["diet_type"]
        s.commit()
    return jsonify({"success": True})


# --- Streak ---
@app.route("/api/streak")
def streak():
    with Session(engine) as s:
        dates = {r[0] for r in s.query(FoodLog.date).distinct().all()}
    if not dates:
        return jsonify({"streak": 0, "longest": 0})
    current = 0
    check = date.today()
    while check.isoformat() in dates:
        current += 1
        check -= timedelta(days=1)
    # Longest streak
    sorted_dates = sorted(datetime.strptime(d, "%Y-%m-%d").date() for d in dates)
    longest = 1
    run = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1
    return jsonify({"streak": current, "longest": longest})


# --- BMI ---
@app.route("/api/bmi")
def bmi():
    settings = get_settings()
    height_cm = settings["height_cm"]
    with Session(engine) as s:
        latest = s.query(WeightLog).order_by(desc(WeightLog.date)).first()
    if not latest or height_cm <= 0:
        return jsonify({"bmi": None, "category": "No data", "weight_kg": None, "height_cm": height_cm})
    h = height_cm / 100.0
    bmi_val = round(latest.weight_kg / (h * h), 1)
    if bmi_val < 18.5:
        category = "Underweight"
    elif bmi_val < 25:
        category = "Normal"
    elif bmi_val < 30:
        category = "Overweight"
    else:
        category = "Obese"
    return jsonify({"bmi": bmi_val, "category": category, "weight_kg": latest.weight_kg, "height_cm": height_cm})


# --- Export CSV ---
@app.route("/api/export/csv")
def export_csv():
    with Session(engine) as s:
        rows = s.query(FoodLog).order_by(FoodLog.date, FoodLog.time).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Time", "Meal Type", "Food", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)"])
    for r in rows:
        writer.writerow([r.date, r.time, r.meal_type, r.description, r.calories,
                         round(r.protein_g, 1), round(r.carbs_g, 1), round(r.fat_g, 1)])
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=nutritrack_export.csv"},
    )


@app.route("/api/meal-plan/today", methods=["GET"])
def get_today_meal_plan():
    today = date.today().isoformat()
    with Session(engine) as s:
        plans = s.query(MealPlan).filter(
            MealPlan.date == today
        ).order_by(MealPlan.meal_type).all()
    return jsonify({
        "date": today,
        "plans": [
            {"id": p.id, "date": p.date, "meal_type": p.meal_type,
             "description": p.description, "planned_calories": p.planned_calories,
             "quantity": p.quantity or ""}
            for p in plans
        ]
    })


# --- Food Suggestions for Meal Planning ---
@app.route("/api/suggest-foods")
def suggest_foods():
    meal_type = request.args.get("meal_type", "lunch")
    settings = get_settings()
    diet_type = settings.get("diet_type", "veg")
    goal = settings.get("goal_type", "maintain")
    calorie_goal = settings.get("calorie_goal", 2100)
    # Rough per-meal budget
    meal_budgets = {"morning": 0.10, "breakfast": 0.25, "lunch": 0.35, "snack": 0.10, "dinner": 0.30}
    budget = int(calorie_goal * meal_budgets.get(meal_type, 0.25))
    diet_labels = {"veg": "vegetarian (no meat/eggs)", "egg": "vegetarian + eggs", "nonveg": "non-vegetarian (includes meat, fish, chicken)"}
    diet_label = diet_labels.get(diet_type, "vegetarian")

    if not _client:
        return jsonify({"error": "Set GROQ_API_KEY to enable AI suggestions"}), 400
    try:
        prompt = SUGGEST_FOODS_PROMPT.format(
            meal_type=meal_type, diet_label=diet_label, budget=budget, goal=goal
        )
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
        )
        foods = _parse_ai_json(resp.choices[0].message.content)
        if not isinstance(foods, list):
            raise ValueError("Expected array")
        return jsonify({"foods": foods, "diet_type": diet_type, "meal_type": meal_type, "budget": budget})
    except Exception as e:
        app.logger.error(f"suggest-foods error: {e}")
        return jsonify({"error": str(e)[:120]}), 500


# --- Meal Planning ---
@app.route("/api/meal-plan", methods=["GET"])
def get_meal_plan():
    week_start = request.args.get("week", date.today().isoformat())
    try:
        start = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        start = date.today()
    # Align to Monday
    start = start - timedelta(days=start.weekday())
    end = start + timedelta(days=6)
    with Session(engine) as s:
        plans = s.query(MealPlan).filter(
            MealPlan.date >= start.isoformat(),
            MealPlan.date <= end.isoformat()
        ).order_by(MealPlan.date, MealPlan.meal_type).all()
    return jsonify({
        "week_start": start.isoformat(),
        "plans": [
            {"id": p.id, "date": p.date, "meal_type": p.meal_type,
             "description": p.description, "planned_calories": p.planned_calories,
             "quantity": p.quantity or ""}
            for p in plans
        ]
    })


@app.route("/api/meal-plan", methods=["POST"])
def add_meal_plan():
    data = request.get_json() or {}
    plan_date = data.get("date", date.today().isoformat())
    meal_type = data.get("meal_type", "lunch")
    description = (data.get("description") or "").strip()
    planned_calories = int(data.get("planned_calories", 0))
    quantity = (data.get("quantity") or "").strip()[:50]
    if not description:
        return jsonify({"error": "Description required"}), 400
    with Session(engine) as s:
        mp = MealPlan(date=plan_date, meal_type=meal_type,
                      description=description, planned_calories=planned_calories,
                      quantity=quantity)
        s.add(mp)
        s.commit()
        result = {"id": mp.id, "date": mp.date, "meal_type": mp.meal_type,
                  "description": mp.description, "planned_calories": mp.planned_calories,
                  "quantity": mp.quantity or ""}
    return jsonify({"success": True, "plan": result})


@app.route("/api/meal-plan/<int:plan_id>", methods=["DELETE"])
def delete_meal_plan(plan_id):
    with Session(engine) as s:
        row = s.query(MealPlan).filter(MealPlan.id == plan_id).first()
        if row:
            s.delete(row)
            s.commit()
    return jsonify({"success": True})


# --- Nutrition Gaps Analysis ---
@app.route("/api/nutrition-gaps")
def nutrition_gaps():
    target = request.args.get("date", date.today().isoformat())
    settings = get_settings()
    with Session(engine) as s:
        rows = s.query(FoodLog).filter(FoodLog.date == target).all()
    if not rows:
        return jsonify({"error": "No meals logged yet today"}), 400
    if not _client:
        return jsonify({"error": "Set GROQ_API_KEY to enable analysis"}), 400
    intake = "\n".join(f"- {r.description} ({r.calories} kcal)" for r in rows)
    totals = {
        "calories": sum(r.calories for r in rows),
        "protein": round(sum(r.protein_g for r in rows), 1),
        "carbs": round(sum(r.carbs_g for r in rows), 1),
        "fat": round(sum(r.fat_g for r in rows), 1),
    }
    try:
        prompt = NUTRITION_GAP_PROMPT.format(
            intake=intake, diet_type=settings.get("diet_type", "veg"),
            goal=settings.get("goal_type", "maintain"), **totals
        )
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
        )
        result = _parse_ai_json(resp.choices[0].message.content)
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"nutrition-gaps error: {e}")
        return jsonify({"error": str(e)[:120]}), 500


# --- Meal Swap Suggestions ---
@app.route("/api/meal-swap")
def meal_swap():
    target = request.args.get("date", date.today().isoformat())
    settings = get_settings()
    with Session(engine) as s:
        rows = s.query(FoodLog).filter(FoodLog.date == target).all()
    if not rows:
        return jsonify({"error": "No meals logged yet today"}), 400
    if not _client:
        return jsonify({"error": "Set GROQ_API_KEY to enable suggestions"}), 400
    intake = "\n".join(f"- {r.description} at {r.time} ({r.calories} kcal, {round(r.protein_g,1)}g P)" for r in rows)
    cal_goal = settings.get("calorie_goal", 2100)
    prot_goal = settings.get("protein_goal", 90)
    total_cal = sum(r.calories for r in rows)
    total_prot = round(sum(r.protein_g for r in rows), 1)
    hour = datetime.now().hour
    time_of_day = "morning" if hour < 10 else "afternoon" if hour < 16 else "evening"
    try:
        prompt = MEAL_SWAP_PROMPT.format(
            intake=intake, calories=total_cal, calorie_goal=cal_goal,
            calorie_pct=round(total_cal / cal_goal * 100),
            protein=total_prot, protein_goal=prot_goal,
            protein_pct=round(total_prot / prot_goal * 100),
            diet_type=settings.get("diet_type", "veg"),
            remaining_cal=max(0, cal_goal - total_cal),
            time_of_day=time_of_day
        )
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
        )
        result = _parse_ai_json(resp.choices[0].message.content)
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"meal-swap error: {e}")
        return jsonify({"error": str(e)[:120]}), 500


# --- Shopping List Generator ---
@app.route("/api/shopping-list")
def shopping_list():
    week_start_str = request.args.get("week", date.today().isoformat())
    settings = get_settings()
    try:
        start = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    except ValueError:
        start = date.today()
    start = start - timedelta(days=start.weekday())
    end = start + timedelta(days=6)
    with Session(engine) as s:
        plans = s.query(MealPlan).filter(
            MealPlan.date >= start.isoformat(),
            MealPlan.date <= end.isoformat()
        ).order_by(MealPlan.date, MealPlan.meal_type).all()
    if not plans:
        return jsonify({"error": "No meal plan for this week. Add meals to your plan first."}), 400
    if not _client:
        return jsonify({"error": "Set GROQ_API_KEY to enable shopping list"}), 400
    meal_plan_text = "\n".join(
        f"- {p.date} {p.meal_type}: {p.description}{' (' + p.quantity + ')' if p.quantity else ''}"
        for p in plans
    )
    try:
        prompt = SHOPPING_LIST_PROMPT.format(
            meal_plan=meal_plan_text, diet_type=settings.get("diet_type", "veg")
        )
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
        )
        result = _parse_ai_json(resp.choices[0].message.content)
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"shopping-list error: {e}")
        return jsonify({"error": str(e)[:120]}), 500


# --- Shop Items (manual buy list) ---
SHOP_CATEGORIES = ["Grocery", "Snacks", "Supplements", "Dairy", "Produce", "Other"]

@app.route("/api/shop-items", methods=["GET"])
def get_shop_items():
    with Session(engine) as s:
        items = s.query(ShoppingItem).order_by(ShoppingItem.category, ShoppingItem.created_at).all()
        grouped = {}
        for item in items:
            cat = item.category or "Other"
            grouped.setdefault(cat, []).append({
                "id": item.id, "name": item.name,
                "category": cat, "quantity": item.quantity,
                "checked": bool(item.checked)
            })
    return jsonify({"grouped": grouped, "categories": SHOP_CATEGORIES})

@app.route("/api/shop-items", methods=["POST"])
def add_shop_item():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    category = data.get("category", "Other")
    if category not in SHOP_CATEGORIES:
        category = "Other"
    qty = (data.get("quantity") or "").strip()
    with Session(engine) as s:
        item = ShoppingItem(
            name=name, category=category, quantity=qty,
            checked=0, created_at=datetime.utcnow().isoformat()
        )
        s.add(item)
        s.commit()
        return jsonify({"id": item.id, "name": item.name, "category": item.category,
                        "quantity": item.quantity, "checked": False})

@app.route("/api/shop-items/<int:item_id>", methods=["PATCH"])
def update_shop_item(item_id):
    data = request.get_json(force=True)
    with Session(engine) as s:
        item = s.get(ShoppingItem, item_id)
        if not item:
            return jsonify({"error": "Not found"}), 404
        if "checked" in data:
            item.checked = 1 if data["checked"] else 0
        s.commit()
    return jsonify({"ok": True})

@app.route("/api/shop-items/<int:item_id>", methods=["DELETE"])
def delete_shop_item(item_id):
    with Session(engine) as s:
        item = s.get(ShoppingItem, item_id)
        if item:
            s.delete(item)
            s.commit()
    return jsonify({"ok": True})

@app.route("/api/shop-items/checked", methods=["DELETE"])
def delete_checked_shop_items():
    with Session(engine) as s:
        s.query(ShoppingItem).filter(ShoppingItem.checked == 1).delete()
        s.commit()
    return jsonify({"ok": True})


# --- Recipe Generator ---
RECIPE_PROMPT = """You are a helpful Indian cooking assistant.
The user wants to cook: "{dish}"
Servings: {servings}

Return ONLY a JSON object in this exact format:
{{
  "dish": "...",
  "servings": {servings},
  "prep_time": "...",
  "cook_time": "...",
  "total_cost_inr": 0,
  "ingredients": [
    {{"name": "...", "quantity": "...", "cost_inr": 0}}
  ],
  "steps": ["step 1", "step 2"],
  "tips": "..."
}}

Rules:
- Use Indian grocery prices (INR) as of 2024
- List all ingredients with realistic quantities for {servings} serving(s)
- Keep steps clear and numbered naturally
- total_cost_inr should be the sum of all ingredient costs
- tips can be a single helpful cooking tip
- For the "dish" field: keep the exact name the user typed, only fix obvious spelling mistakes (e.g. "biryaani" -> "Biryani"). Do NOT rename or rephrase the dish
- Return ONLY the JSON, no extra text
"""

@app.route("/api/recipe", methods=["POST"])
def generate_recipe():
    if not _client:
        return jsonify({"error": "Set GROQ_API_KEY to enable recipe generation"}), 400
    data = request.get_json(force=True)
    dish = (data.get("dish") or "").strip()
    if not dish:
        return jsonify({"error": "Dish name is required"}), 400
    dish = dish[:100]  # cap length
    servings = max(1, min(int(data.get("servings", 2)), 10))
    try:
        prompt = RECIPE_PROMPT.format(dish=dish, servings=servings)
        resp = _client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
        )
        result = _parse_ai_json(resp.choices[0].message.content)
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"recipe error: {e}")
        return jsonify({"error": str(e)[:120]}), 500


# --- Expenses ---
EXPENSE_CATEGORIES = [
    "Food", "Groceries", "Restaurant", "Snacks", "Supplements",
    "Transport", "Entertainment", "Movies", "Shopping", "Health",
    "Utilities", "Rent", "Education", "Travel", "Fuel",
    "Subscriptions", "Gifts", "Personal Care", "Other"
]
EXPENSE_PAYMENT_METHODS = ["UPI", "Cash", "Card", "NetBanking", "Other"]

def _expense_dict(e):
    return {
        "id": e.id, "date": e.date, "amount": e.amount,
        "description": e.description, "category": e.category,
        "type": e.type, "payment_method": e.payment_method,
        "note": e.note or "", "created_at": e.created_at
    }

@app.route("/api/expenses", methods=["GET"])
def get_expenses():
    month = request.args.get("month", "")      # "2026-04"
    year = request.args.get("year", "")        # "2026"
    exp_type = request.args.get("type", "")    # debit | credit
    category = request.args.get("category", "")
    search = (request.args.get("search") or "").strip().lower()

    with Session(engine) as s:
        q = s.query(Expense)
        if month:
            q = q.filter(Expense.date.like(f"{month}%"))
        elif year:
            q = q.filter(Expense.date.like(f"{year}%"))
        if exp_type in ("debit", "credit"):
            q = q.filter(Expense.type == exp_type)
        if category:
            q = q.filter(Expense.category == category)
        expenses = q.order_by(desc(Expense.date), desc(Expense.id)).all()

    if search:
        expenses = [e for e in expenses if
                    search in e.description.lower() or
                    search in (e.note or '').lower() or
                    search in str(e.amount)]

    items = [_expense_dict(e) for e in expenses]
    total_debit = sum(e["amount"] for e in items if e["type"] == "debit")
    total_credit = sum(e["amount"] for e in items if e["type"] == "credit")

    # Category breakdown (debit only)
    cat_totals = {}
    for e in items:
        if e["type"] == "debit":
            cat_totals[e["category"]] = round(cat_totals.get(e["category"], 0) + e["amount"], 2)

    return jsonify({
        "expenses": items,
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "net": round(total_credit - total_debit, 2),
        "cat_totals": cat_totals,
        "categories": EXPENSE_CATEGORIES,
        "payment_methods": EXPENSE_PAYMENT_METHODS
    })

@app.route("/api/expenses/summary", methods=["GET"])
def expense_summary():
    today = date.today()
    # Last 6 months
    months = []
    for i in range(5, -1, -1):
        d = date(today.year, today.month, 1) - timedelta(days=1)
        d = date(today.year, today.month, 1)
        # go back i months
        month_val = today.month - i
        year_val = today.year
        while month_val <= 0:
            month_val += 12
            year_val -= 1
        months.append(f"{year_val}-{month_val:02d}")

    with Session(engine) as s:
        data = []
        for m in months:
            rows = s.query(Expense).filter(Expense.date.like(f"{m}%")).all()
            debit = sum(r.amount for r in rows if r.type == "debit")
            credit = sum(r.amount for r in rows if r.type == "credit")
            data.append({"month": m, "debit": round(debit, 2), "credit": round(credit, 2)})
    return jsonify({"monthly": data})

@app.route("/api/expenses", methods=["POST"])
def add_expense():
    data = request.get_json(force=True)
    desc = (data.get("description") or "").strip()
    if not desc:
        return jsonify({"error": "Description required"}), 400
    try:
        amount = round(float(data.get("amount", 0)), 2)
        if amount <= 0:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "Valid amount required"}), 400

    category = data.get("category", "Food")
    if category not in EXPENSE_CATEGORIES:
        category = "Other"
    payment_method = data.get("payment_method", "UPI")
    if payment_method not in EXPENSE_PAYMENT_METHODS:
        payment_method = "Other"
    exp_type = data.get("type", "debit")
    if exp_type not in ("debit", "credit"):
        exp_type = "debit"
    exp_date = (data.get("date") or date.today().isoformat())[:10]

    with Session(engine) as s:
        e = Expense(
            date=exp_date, amount=amount, description=desc,
            category=category, type=exp_type,
            payment_method=payment_method,
            note=(data.get("note") or "").strip(),
            created_at=datetime.utcnow().isoformat()
        )
        s.add(e)
        s.commit()
        return jsonify(_expense_dict(e)), 201

@app.route("/api/expenses/<int:exp_id>", methods=["PATCH"])
def update_expense(exp_id):
    data = request.get_json(force=True)
    with Session(engine) as s:
        e = s.get(Expense, exp_id)
        if not e:
            return jsonify({"error": "Not found"}), 404
        if "description" in data:
            e.description = (data["description"] or "").strip()
        if "amount" in data:
            try:
                e.amount = round(float(data["amount"]), 2)
            except (ValueError, TypeError):
                pass
        if "category" in data and data["category"] in EXPENSE_CATEGORIES:
            e.category = data["category"]
        if "type" in data and data["type"] in ("debit", "credit"):
            e.type = data["type"]
        if "payment_method" in data and data["payment_method"] in EXPENSE_PAYMENT_METHODS:
            e.payment_method = data["payment_method"]
        if "date" in data:
            e.date = (data["date"] or "")[:10]
        if "note" in data:
            e.note = (data["note"] or "").strip()
        s.commit()
        return jsonify(_expense_dict(e))

@app.route("/api/expenses/<int:exp_id>", methods=["DELETE"])
def delete_expense(exp_id):
    with Session(engine) as s:
        e = s.get(Expense, exp_id)
        if e:
            s.delete(e)
            s.commit()
    return jsonify({"ok": True})

@app.route("/api/expenses/export-csv", methods=["GET"])
def export_expenses_csv():
    month = request.args.get("month", "")
    year = request.args.get("year", "")
    with Session(engine) as s:
        q = s.query(Expense)
        if month:
            q = q.filter(Expense.date.like(f"{month}%"))
        elif year:
            q = q.filter(Expense.date.like(f"{year}%"))
        rows = q.order_by(desc(Expense.date)).all()
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["Date", "Description", "Amount", "Type", "Category", "Payment Method", "Note"])
    for r in rows:
        w.writerow([r.date, r.description, r.amount, r.type, r.category, r.payment_method, r.note])
    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=expenses.csv"}
    )


# --- Calorie Trend (30-day) ---
@app.route("/api/calorie-trend")
def calorie_trend():
    days = int(request.args.get("days", 30))
    days = min(max(days, 7), 90)
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)
    settings = get_settings()
    with Session(engine) as s:
        rows = (
            s.query(FoodLog.date, func.sum(FoodLog.calories).label("total_calories"))
            .filter(FoodLog.date >= start_date.isoformat(), FoodLog.date <= end_date.isoformat())
            .group_by(FoodLog.date)
            .order_by(FoodLog.date)
            .all()
        )
    cal_by_date = {r.date: r.total_calories for r in rows}
    trend = []
    for i in range(days):
        d = (start_date + timedelta(days=i)).isoformat()
        trend.append({"date": d, "calories": cal_by_date.get(d, None)})
    # 7-day rolling average (only for days with data)
    logged = [(i, t["calories"]) for i, t in enumerate(trend) if t["calories"] is not None]
    for i, cal in logged:
        window = [c for j, c in logged if abs(j - i) <= 3]
        trend[i]["rolling_avg"] = round(sum(window) / len(window)) if window else None
    return jsonify({
        "trend": trend,
        "calorie_goal": settings.get("calorie_goal", 2100),
        "days": days
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
