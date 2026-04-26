"""
One-time database migration script — NutriTrack
================================================
Adds the onboarding profile columns to user_settings if they don't already
exist.  Safe to re-run: existing columns are silently skipped.

Usage
-----
    cd diet-tracker
    python3 scripts/migrate.py
"""

import os
import sys

# Allow running from any directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

# ── Resolve database URL (matches app.py logic) ──────────────────────────────
_db_url = os.environ.get("DATABASE_URL", "")
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)
if not _db_url:
    _db_url = "sqlite:///" + os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "diet_tracker.db",
    )

engine = create_engine(_db_url, pool_pre_ping=True)

# ── Columns to add ────────────────────────────────────────────────────────────
NEW_COLS = [
    ("user_settings", "name",             "VARCHAR(100) DEFAULT ''"),
    ("user_settings", "age",              "INTEGER DEFAULT 0"),
    ("user_settings", "gender",           "VARCHAR(10) DEFAULT ''"),
    ("user_settings", "activity_level",   "VARCHAR(20) DEFAULT 'moderate'"),
    ("user_settings", "goal_type",        "VARCHAR(10) DEFAULT 'maintain'"),
    ("user_settings", "onboarding_done",  "INTEGER DEFAULT 0"),
    ("user_settings", "diet_type",        "VARCHAR(10) DEFAULT 'veg'"),
    ("meal_plan",     "quantity",         "VARCHAR(50) DEFAULT ''"),
]

# ── Run migration ─────────────────────────────────────────────────────────────
print("Running NutriTrack migration …")
with engine.connect() as conn:
    for table, col, typedef in NEW_COLS:
        try:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}"))
            conn.commit()
            print(f"  + Added   {table}.{col}")
        except Exception:
            print(f"  · Skipped {table}.{col}  (already exists)")

print("Done.")
