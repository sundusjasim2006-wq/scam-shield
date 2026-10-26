import os, sys, json, time, getpass, datetime
import jaydebeapi

JAR = os.path.expanduser(
    r"~\Downloads\zetaris-platform\zetaris-platform\jdbc"
    r"\ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar"
)
USER = os.environ.get("ZETARIS_USER", "admin@zetaris.com")
URL = "jdbc:zetaris:lightning@localhost:10000"
TABLES = [
    "vendors",
    "payments",
    "purchase_orders",
    "bank_change_log",
    "domain_registry",
    "company_registry",
]
OUT = "zetaris_snapshot"
LOG = os.path.join("logs", "zetaris_trace.jsonl")

os.makedirs(OUT, exist_ok=True)
os.makedirs("logs", exist_ok=True)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log(action, input_summary, output_summary, status):
    entry = {
        "timestamp": now(),
        "agent_name": "ZetarisConnector",
        "action": action,
        "input_summary": input_summary,
        "output_summary": output_summary,
        "target_agent": "EvidenceTools",
        "confidence": None,
        "retry_count": 0,
        "status": status,
    }
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    print(json.dumps(entry))


if not os.path.exists(JAR):
    sys.exit("Driver jar not found: " + JAR)

password = os.environ.get("ZETARIS_PASSWORD")
if not password:
    password = getpass.getpass("Zetaris password (hidden): ")

driver = "com.zetaris.lightning.jdbc.LightningDriver"
try:
    conn = jaydebeapi.connect(driver, URL, [USER, password], JAR)
except Exception as e:
    log("connect", URL, "login failed: " + str(e)[-150:], "error")
    sys.exit(1)

failed = 0
try:
    for t in TABLES:
        sql = "SELECT * FROM SCAMSHIELD." + t
        started = time.time()
        try:
            cur = conn.cursor()
            cur.execute(sql)
            cols = [d[0] for d in cur.description]
            rows = []
            for r in cur.fetchall():
                values = [None if v is None else str(v) for v in r]
                rows.append(dict(zip(cols, values)))
            cur.close()
            payload = {
                "source": "zetaris",
                "query": sql,
                "fetched_at": now(),
                "columns": cols,
                "rows": rows,
            }
            path = os.path.join(OUT, t + ".json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            secs = round(time.time() - started, 2)
            summary = str(len(rows)) + " rows in " + str(secs) + "s"
            log("query", sql, summary, "ok")
        except Exception as e:
            failed += 1
            log("query", sql, str(e)[:200], "error")
finally:
    conn.close()

done = len(TABLES) - failed
print("Done. Tables exported:", done, "of", len(TABLES))
