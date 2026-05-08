"""
国交省Excelをベースに、P35・michi-no-eki.jpのデータを統合してマスタCSVを生成する

出力列:
  name          駅名（国交省）
  prefecture    都道府県（国交省）
  reg_num       登録回（国交省）
  reg_date      登録年月（国交省）
  city          市区町村（P35優先、なければ国交省所在地）
  administrative_area_code  全国地方公共団体コード（P35）
  latitude      緯度（P35優先、なければ公式サイト）
  longitude     経度（P35優先、なければ公式サイト）
  address       住所・番地（公式サイト）
  p35_id        国土数値情報P35 ID
  site_id       michi-no-eki.jp 内部ID
  hp            ホームページ（国交省）
  source_latlon 緯度経度のソース
"""

import csv
import re
import unicodedata
import xlrd

MLIT_XLS    = "mlit_list.xls"
P35_CSV     = "michinoeki.csv"
DIFF_CSV    = "diff_michinoeki.csv"
OUTPUT_CSV  = "michinoeki_master.csv"

FIELDNAMES = [
    "name", "prefecture", "reg_num", "reg_date",
    "city", "administrative_area_code",
    "latitude", "longitude",
    "address", "p35_id", "site_id", "hp", "source_latlon",
]


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    return re.sub(r"\s+", "", s).lower()


def load_mlit(path: str) -> list[dict]:
    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_index(0)
    rows = []
    for r in range(1, ws.nrows):
        rows.append({
            "name":     ws.cell_value(r, 1),
            "pref":     ws.cell_value(r, 0),
            "reg_num":  ws.cell_value(r, 2),
            "reg_date": ws.cell_value(r, 3),
            "location": ws.cell_value(r, 4),
            "hp":       ws.cell_value(r, 5),
        })
    return rows


def load_p35(path: str) -> dict[tuple, dict]:
    """(正規化名, 正規化都道府県) をキーにしたインデックスを返す"""
    result = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            result[(normalize(row["name"]), normalize(row["prefecture"]))] = row
    return result


def load_diff(path: str) -> dict[tuple, dict]:
    result = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            result[(normalize(row["name"]), normalize(row["prefecture"]))] = row
    return result


# 国交省名 → データ側の正規化名（表記ゆれの個別対応）
MANUAL_NAME_MAP = {
    normalize("ほうじょう"): normalize("ほうじょう　【4/25(金)リニューアルオープン】"),
    normalize("きたごう"):   normalize("道の駅きたごう"),
}


def find_match(norm_name: str, norm_pref: str, index: dict[tuple, dict]) -> dict | None:
    """名称＋都道府県で完全一致。既知の表記ゆれはMANUAL_NAME_MAPで対応"""
    name_key = MANUAL_NAME_MAP.get(norm_name, norm_name)
    return index.get((name_key, norm_pref))


def build_record(mlit: dict, p35: dict | None, diff: dict | None) -> dict:
    rec = {
        "name":       mlit["name"],
        "prefecture": mlit["pref"],
        "reg_num":    mlit["reg_num"],
        "reg_date":   mlit["reg_date"],
        "city":       "",
        "administrative_area_code": "",
        "latitude":   "",
        "longitude":  "",
        "address":    "",
        "p35_id":     "",
        "site_id":    "",
        "hp":         mlit["hp"],
        "source_latlon": "",
    }

    if p35:
        rec["p35_id"]     = p35["p35_id"]
        rec["city"]       = p35["city"] or mlit["location"]
        rec["administrative_area_code"] = p35["administrative_area_code"]
        rec["latitude"]   = p35["latitude"]
        rec["longitude"]  = p35["longitude"]
        rec["source_latlon"] = "国土数値情報P35-18"

    if diff:
        rec["site_id"] = diff.get("site_id", diff.get("id", ""))
        rec["address"] = diff.get("address", "")
        if not rec["latitude"] and diff.get("latitude"):
            rec["latitude"]  = diff["latitude"]
            rec["longitude"] = diff["longitude"]
            rec["source_latlon"] = "michi-no-eki.jp"
        if not rec["city"]:
            rec["city"] = diff.get("city", "") or mlit["location"]

    if not rec["city"]:
        rec["city"] = mlit["location"]

    return rec


def main():
    print("データ読み込み中...")
    mlit_rows = load_mlit(MLIT_XLS)
    p35_index = load_p35(P35_CSV)
    diff_index = load_diff(DIFF_CSV)
    print(f"  国交省: {len(mlit_rows)} 件 / P35: {len(p35_index)} 件 / 差分: {len(diff_index)} 件")

    records = []
    stats = {"p35": 0, "diff": 0, "none": 0}

    for mlit in mlit_rows:
        norm      = normalize(mlit["name"])
        norm_pref = normalize(mlit["pref"])
        p35  = find_match(norm, norm_pref, p35_index)
        diff = find_match(norm, norm_pref, diff_index)

        rec = build_record(mlit, p35, diff)
        records.append(rec)

        if p35:   stats["p35"] += 1
        elif diff: stats["diff"] += 1
        else:      stats["none"] += 1

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(records)

    print(f"\n統合結果:")
    print(f"  P35から緯度経度取得:          {stats['p35']:4d} 件")
    print(f"  公式サイトから緯度経度取得:    {stats['diff']:4d} 件")
    print(f"  緯度経度なし:                  {stats['none']:4d} 件")
    print(f"\nCSVを保存しました: {OUTPUT_CSV}  ({len(records)} 件)")

    no_latlon = [r for r in records if not r["latitude"]]
    if no_latlon:
        print(f"\n緯度経度が取得できなかった駅:")
        for r in no_latlon:
            print(f"  {r['prefecture']} / {r['name']}")


if __name__ == "__main__":
    main()
