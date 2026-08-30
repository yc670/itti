import sqlite3

con = sqlite3.connect("app.db")
cur = con.cursor()

tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("TABLES:", tables)
print()

print("reports columns:", [r[1] for r in cur.execute("PRAGMA table_info(reports)").fetchall()])
print("reports indexes:", [r[1] for r in cur.execute("PRAGMA index_list(reports)").fetchall()])
print()

print("users columns:", [r[1] for r in cur.execute("PRAGMA table_info(users)").fetchall()])
print()

if "notifications" in tables:
    print("notifications indexes:", [r[1] for r in cur.execute("PRAGMA index_list(notifications)").fetchall()])
else:
    print("notifications table does not exist")