"""
www.michi-no-eki.jp から全駅を取得し、michinoeki.csv にない駅を diff_michinoeki.csv に出力する
緯度・経度はサイトに掲載されていないため空欄とする
"""

import csv
import re
import time
import unicodedata
import urllib.request
from html.parser import HTMLParser

BASE_URL = "https://www.michi-no-eki.jp"
EXISTING_CSV = "michinoeki.csv"
OUTPUT_CSV = "diff_michinoeki.csv"

PREF_SEARCH_IDS = {
    10: "北海道", 11: "青森県", 12: "秋田県", 13: "岩手県",
    14: "宮城県", 15: "山形県", 16: "福島県",
    17: "茨城県", 18: "栃木県", 19: "群馬県", 20: "埼玉県",
    21: "千葉県", 22: "東京都", 23: "神奈川県", 24: "新潟県",
    25: "富山県", 26: "石川県", 27: "福井県", 28: "山梨県",
    29: "長野県", 30: "岐阜県", 31: "静岡県", 32: "愛知県",
    33: "三重県", 34: "滋賀県", 35: "京都府", 36: "大阪府",
    37: "兵庫県", 38: "奈良県", 39: "和歌山県", 40: "鳥取県",
    41: "島根県", 42: "岡山県", 43: "広島県", 44: "山口県",
    45: "徳島県", 46: "香川県", 47: "愛媛県", 48: "高知県",
    49: "福岡県", 50: "佐賀県", 51: "長崎県", 52: "熊本県",
    53: "大分県", 54: "宮崎県", 55: "鹿児島県", 56: "沖縄県",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def normalize(s: str) -> str:
    """比較用に全角→半角・空白除去・小文字化"""
    s = unicodedata.normalize("NFKC", s)
    return re.sub(r"\s+", "", s).lower()


class StationListParser(HTMLParser):
    """一覧ページから駅ID・駅名を抽出"""
    def __init__(self):
        super().__init__()
        self.stations: list[tuple[str, str]] = []  # (id, name)
        self._in_h3 = False
        self._current_id = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "href" in attrs:
            m = re.match(r"/stations/views/(\d+)", attrs["href"])
            if m:
                self._current_id = m.group(1)
        if tag == "h3" and self._current_id:
            self._in_h3 = True

    def handle_data(self, data):
        if self._in_h3:
            name = data.strip()
            if name:
                self.stations.append((self._current_id, name))
            self._in_h3 = False
            self._current_id = None


def get_last_page(html: str) -> int:
    """ページネーションから最終ページ番号を取得"""
    nums = re.findall(r'\?page=(\d+)', html)
    return max((int(n) for n in nums), default=0)


def scrape_pref_stations(search_id: int) -> list[tuple[str, str]]:
    """都道府県の全ページから (station_id, name) を収集"""
    url = f"{BASE_URL}/stations/search/{search_id}/all/all"
    html = fetch(url)
    last = get_last_page(html)

    parser = StationListParser()
    parser.feed(html)
    stations = parser.stations[:]

    for page in range(1, last + 1):
        time.sleep(0.5)
        html = fetch(f"{url}?page={page}")
        p = StationListParser()
        p.feed(html)
        stations.extend(p.stations)

    return stations


class StationDetailParser(HTMLParser):
    """駅詳細ページから住所を抽出（<dt>所在地</dt><dd>住所</dd> 構造）"""
    def __init__(self):
        super().__init__()
        self.address = ""
        self._in_dt = False
        self._next_dd_is_address = False
        self._in_dd = False

    def handle_starttag(self, tag, attrs):
        if tag == "dt":
            self._in_dt = True
        if tag == "dd" and self._next_dd_is_address:
            self._in_dd = True
            self._next_dd_is_address = False

    def handle_data(self, data):
        if self._in_dt and "所在地" in data:
            self._next_dd_is_address = True
        if self._in_dd:
            self.address += data.strip()

    def handle_endtag(self, tag):
        if tag == "dt":
            self._in_dt = False
        if tag == "dd" and self._in_dd:
            self._in_dd = False


def scrape_station_detail(station_id: str) -> dict:
    url = f"{BASE_URL}/stations/views/{station_id}"
    try:
        html = fetch(url)
    except Exception:
        return {"address": "", "city": "", "url": url}

    p = StationDetailParser()
    p.feed(html)
    address = p.address

    # 住所から市区町村を推定（郡がある場合は郡+町村、ない場合は市区町村まで）
    city = ""
    m = re.search(r"(?:都|道|府|県)([\S]+?郡[\S]+?[町村]|[\S]+?[市区])", address)
    if m:
        city = m.group(1)

    return {"address": address, "city": city, "url": url}


def load_existing_names(csv_path: str) -> set[str]:
    names = set()
    try:
        with open(csv_path, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                names.add(normalize(row["name"]))
    except FileNotFoundError:
        pass
    return names


def main():
    print("既存CSVを読み込み中...")
    existing = load_existing_names(EXISTING_CSV)
    print(f"  既存: {len(existing)} 件")

    all_web: list[dict] = []
    for search_id, pref_name in PREF_SEARCH_IDS.items():
        print(f"  {pref_name} を取得中...", end=" ", flush=True)
        stations = scrape_pref_stations(search_id)
        for sid, name in stations:
            all_web.append({"id": sid, "name": name, "prefecture": pref_name})
        print(f"{len(stations)} 件")
        time.sleep(0.3)

    print(f"\nWeb合計: {len(all_web)} 件")

    # 重複IDを除去（同じ駅が複数ページに出る場合）
    seen_ids: set[str] = set()
    unique_web = []
    for s in all_web:
        if s["id"] not in seen_ids:
            seen_ids.add(s["id"])
            unique_web.append(s)
    print(f"重複除去後: {len(unique_web)} 件")

    # 差分を抽出
    diff = [s for s in unique_web if normalize(s["name"]) not in existing]
    print(f"差分（新規）: {len(diff)} 件")

    if not diff:
        print("新規駅はありませんでした。")
        return

    # 各新規駅の詳細を取得
    print("\n新規駅の詳細を取得中...")
    records = []
    for i, s in enumerate(diff, 1):
        print(f"  [{i}/{len(diff)}] {s['name']}", flush=True)
        detail = scrape_station_detail(s["id"])
        time.sleep(0.5)
        site_id = s["id"]
        records.append({
            "id": site_id,
            "p35_id": "",
            "site_id": site_id,
            "name": s["name"],
            "prefecture": s["prefecture"],
            "city": detail["city"],
            "administrative_area_code": "",
            "latitude": "",
            "longitude": "",
            "address": detail["address"],
            "source": "michi-no-eki.jp",
            "source_url": detail["url"],
        })

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "id", "p35_id", "site_id", "name", "prefecture", "city", "administrative_area_code",
            "latitude", "longitude", "address", "source", "source_url"
        ])
        writer.writeheader()
        writer.writerows(records)

    print(f"\nCSVを保存しました: {OUTPUT_CSV}  ({len(records)} 件)")
    for r in records[:5]:
        print(f"  {r['name']} / {r['prefecture']} / {r['address']}")


if __name__ == "__main__":
    main()
