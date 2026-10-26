import os, sys, getpass
import jaydebeapi

jar = os.path.expanduser(r"~\Downloads\zetaris-platform\zetaris-platform\jdbc\ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar")
user = os.environ.get("ZETARIS_USER", "admin@zetaris.com")
url = "jdbc:zetaris:lightning@localhost:10000"

conn = None
for attempt in range(1, 4):
    password = os.environ.get("ZETARIS_PASSWORD") or getpass.getpass("Zetaris password (hidden), attempt %d/3: " % attempt)
    try:
        conn = jaydebeapi.connect("com.zetaris.lightning.jdbc.LightningDriver", url, [user, password], jar)
        break
    except Exception as e:
        print("Login failed:", str(e)[-120:])
        os.environ.pop("ZETARIS_PASSWORD", None)

if conn is None:
    sys.exit("Could not log in after 3 attempts.")

try:
    for sql in ["SHOW DATABASES", "SHOW TABLES"]:
        print("\n>>", sql)
        try:
            cur = conn.cursor()
            cur.execute(sql)
            rows = cur.fetchall()
            for r in rows[:60]:
                print("  ", r)
            print("  (", len(rows), "rows )")
            cur.close()
        except Exception as e:
            print("  failed:", str(e)[:200])
finally:
    conn.close()
