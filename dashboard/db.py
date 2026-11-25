"""
Neuro Monitor: SQLite Database Layer
Stores patient profiles, band associations, telemetry logs, alert events, and calendar appointments.
Strictly: No emdashes, no emojis.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "neuro_monitor.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(clean_slate=False):
    conn = get_db()
    cur = conn.cursor()

    if clean_slate:
        cur.execute("DROP TABLE IF EXISTS calendar_events")
        cur.execute("DROP TABLE IF EXISTS alert_events")
        cur.execute("DROP TABLE IF EXISTS telemetry_logs")
        cur.execute("DROP TABLE IF EXISTS patients")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age TEXT NOT NULL,
        gender TEXT NOT NULL,
        band_id INTEGER DEFAULT 0,
        condition TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'REGISTERED',
        symptoms TEXT,
        observation TEXT,
        prescription TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS telemetry_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        band_id INTEGER,
        timestamp TEXT NOT NULL,
        acc_x REAL,
        acc_y REAL,
        acc_z REAL,
        acc_mag REAL,
        freq_hz REAL,
        p_norm REAL,
        p_pd REAL,
        p_et REAL,
        p_seiz REAL,
        classification TEXT,
        alert_code INTEGER,
        FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        band_id INTEGER,
        timestamp TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        severity INTEGER,
        source TEXT,
        resolved INTEGER DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        event_date TEXT NOT NULL,
        event_time TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    """)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db(clean_slate=True)
    print("Database wiped clean and schema initialized at:", DB_PATH)
