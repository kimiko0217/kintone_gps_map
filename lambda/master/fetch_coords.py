"""
diff_michinoeki.csv の各駅ページから緯度経度を取得してCSVを更新する
"""

import csv
import re
import time
import urllib.request

DIFF_CSV = "diff_michinoeki.csv"
FIELDNAMES = [
    "id", "p35_id", "site_id", "name", "prefecture", "city",
    "administrative_area_code", "latitude", "longitude",
    "address", "source", "source_url",
]


def fetch_coords(url: str) -> tuple[str, str] | tuple[None, None]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8")
        m = re.search(r"[?&]q=([0-9]{2,3}\.[0-9]+),([0-9]{2,3}\.[0-9]+)", html)
        if m:
            return m.group(1), m.group(2)
    except Exception as e:
        print(f"    エラー: {e}")
    return None, None


def main():
    with open(DIFF_CSV, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    print(f"対象: {len(rows)} 件")
    updated = 0
    for i, row in enumerate(rows, 1):
        if row["latitude"] and row["longitude"]:
            print(f"  [{i}/{len(rows)}] {row['name']} → スキップ（取得済み）")
            continue

        print(f"  [{i}/{len(rows)}] {row['name']}", end=" ", flush=True)
        lat, lon = fetch_coords(row["source_url"])
        if lat and lon:
            row["latitude"] = lat
            row["longitude"] = lon
            print(f"→ {lat}, {lon}")
            updated += 1
        else:
            print("→ 取得できず")
        time.sleep(0.5)

    with open(DIFF_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n完了: {updated}/{len(rows)} 件の座標を取得しました")
    missing = [r["name"] for r in rows if not r["latitude"]]
    if missing:
        print(f"取得できなかった駅: {missing}")


if __name__ == "__main__":
    main()
