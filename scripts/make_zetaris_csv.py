import csv, json, os, shutil

OUT = "zetaris_data"
SOURCES = {
    "vendors": "data/erp/vendors.json",
    "purchase_orders": "data/erp/purchase_orders.json",
    "bank_change_log": "data/erp/bank_change_log.json",
    "domain_registry": "data/security/domain_registry.json",
    "email_threads": "data/email_archive/threads.json",
    "company_registry": "data/external/company_registry.json",
}

def flat(value, prefix=""):
    row = {}
    if isinstance(value, dict):
        for k, v in value.items():
            row.update(flat(v, prefix + str(k) + "_"))
    elif isinstance(value, list):
        row[prefix.rstrip("_") or "value"] = ";".join(str(x) for x in value)
    else:
        row[prefix.rstrip("_") or "value"] = "" if value is None else value
    return row

def to_rows(obj):
    if isinstance(obj, list):
        return [flat(x) if isinstance(x, dict) else {"value": x} for x in obj]
    if isinstance(obj, dict):
        lists = [v for v in obj.values() if isinstance(v, list) and v and isinstance(v[0], dict)]
        if len(lists) == 1:
            return to_rows(lists[0])
        rows = []
        for k, v in obj.items():
            r = {"key": k}
            r.update(flat(v) if isinstance(v, dict) else {"value": v})
            rows.append(r)
        return rows
    return [{"value": obj}]

os.makedirs(OUT, exist_ok=True)
for name, path in SOURCES.items():
    if not os.path.exists(path):
        print("SKIP (missing):", path)
        continue
    with open(path, encoding="utf-8") as f:
        rows = to_rows(json.load(f))
    cols = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    with open(os.path.join(OUT, name + ".csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(name + ".csv:", len(rows), "rows | columns:", cols)

pay = "data/accounting/payments.csv"
if os.path.exists(pay):
    shutil.copy(pay, os.path.join(OUT, "payments.csv"))
    with open(pay, encoding="utf-8") as f:
        print("payments.csv: copied | header:", f.readline().strip())
