import os, sys, getpass
import jaydebeapi

jar = os.environ.get(
    "ZETARIS_JAR",
    os.path.expanduser(r"~\Downloads\zetaris-platform\zetaris-platform\jdbc\ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar"),
)
user = os.environ.get("ZETARIS_USER", "admin@zetaris.com")
password = os.environ.get("ZETARIS_PASSWORD") or getpass.getpass("Zetaris password (hidden): ")
url = "jdbc:zetaris:lightning@localhost:10000"

if not os.path.exists(jar):
    sys.exit("Driver jar not found: " + jar)

print("Connecting to", url, "as", user, "...")
conn = jaydebeapi.connect("com.zetaris.lightning.jdbc.LightningDriver", url, [user, password], jar)
try:
    cur = conn.cursor()
    cur.execute("SELECT 1")
    print("SELECT 1 ->", cur.fetchall())
    cur.close()
    print("ZETARIS CONNECTION OK")
finally:
    conn.close()
