import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATABASE = Path(__file__).with_name("githubops.db")


def connection():
    # A small SQLite file is enough for this local interview demo.
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def create_tables():
    # Application history is separate from LangGraph's checkpoint database.
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """)


def now():
    return datetime.now(timezone.utc).isoformat()


def new_conversation(title="New GitHub chat"):
    # Every chat receives an independent thread ID.
    thread_id = str(uuid.uuid4())
    with connection() as db:
        timestamp = now()
        db.execute("INSERT INTO conversations VALUES (NULL, ?, ?, ?, ?)", (thread_id, title, timestamp, timestamp))
    return thread_id


def conversations():
    with connection() as db:
        return db.execute("SELECT * FROM conversations ORDER BY updated_at DESC").fetchall()


def messages(thread_id):
    # Parameterized SQL prevents mixing messages from different conversations.
    with connection() as db:
        return db.execute("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id", (thread_id,)).fetchall()


def save_message(thread_id, role, content):
    # Store readable chat history and update sidebar ordering together.
    with connection() as db:
        timestamp = now()
        db.execute("INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, ?, ?, ?)", (thread_id, role, content, timestamp))
        db.execute("UPDATE conversations SET updated_at = ? WHERE thread_id = ?", (timestamp, thread_id))


def title_from(message):
    words = message.split()
    return " ".join(words[:6]) + ("..." if len(words) > 6 else "")


def update_title(thread_id, title):
    with connection() as db:
        db.execute("UPDATE conversations SET title = ? WHERE thread_id = ?", (title, thread_id))


def delete_conversation(thread_id):
    with connection() as db:
        db.execute("DELETE FROM messages WHERE thread_id = ?", (thread_id,))
        db.execute("DELETE FROM conversations WHERE thread_id = ?", (thread_id,))
