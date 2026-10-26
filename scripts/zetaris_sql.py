import os, sys, getpass
import jaydebeapi

if len(sys.argv) < 2:
    sys.exit('Usage: py -3.12 scripts\\zetaris_sql.py "SQL statement"')

jar = os.path.expanduser(r"~\Downloads\zetaris-platform\zetaris-platform\jdbc\ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar")
user = os.environ.get("ZETARIS_USER", "admin@zetaris.com")
password = os.environ.get("ZETARIS_PASSWORD") or getpass.getpass("Zetaris password (hidden): ")
url = "jdbc:zetaris:lightning@localhost:10000"

conn = jaydebeapi.connect("com.zetaris.lightning.jdbc.LightningDriver", url, [user, password], jar)
try:
    sql = sys.argv[1]
    print(">>", sql)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        if cur.description:
            print("columns:", [d[0] for d in cur.description])
            rows = cur.fetchall()
            for r in rows[:80]:
                print("  ", r)
            print("(", len(rows), "rows )")
        else:
            print("OK (no rows returned)")
    except Exception as e:
        print("FAILED:", str(e))
    cur.close()
finally:
    conn.close()
