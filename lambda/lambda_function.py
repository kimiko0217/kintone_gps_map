"""
道の駅訪問検出 Lambda関数

kintone GPS履歴アプリのWebhook（レコード追加）を受け取り、
道の駅から VISIT_RADIUS_M 以内であれば道の駅訪問履歴アプリに登録する

Lambda環境変数:
  KINTONE_DOMAIN          例: yourcompany.cybozu.com
  KINTONE_MASTER_APP_ID   道の駅マスタアプリID
  KINTONE_MASTER_API_TOKEN
  KINTONE_VISIT_APP_ID    道の駅訪問履歴アプリID
  KINTONE_VISIT_API_TOKEN
  KINTONE_WEBHOOK_TOKEN   kintone Webhook設定のトークン（改ざん防止）
  VISIT_RADIUS_M          判定半径メートル（デフォルト250）
"""

import http.client
import json
import math
import os
import socket
import ssl
import time
import urllib.parse

# ── 環境変数 ───────────────────────────────────────────
DOMAIN        = os.environ["KINTONE_DOMAIN"].strip()
MASTER_APP    = os.environ["KINTONE_MASTER_APP_ID"]
MASTER_TOKEN  = os.environ["KINTONE_MASTER_API_TOKEN"]
VISIT_APP     = os.environ["KINTONE_VISIT_APP_ID"]
VISIT_TOKEN   = os.environ["KINTONE_VISIT_API_TOKEN"]
WEBHOOK_TOKEN = os.environ.get("KINTONE_WEBHOOK_TOKEN", "")
RADIUS_M      = float(os.environ.get("VISIT_RADIUS_M", "250"))

# GPS履歴フィールドコード（Webhookペイロード内）
GPS_DATETIME = "送信日時"
GPS_LAT      = "lat"
GPS_LON      = "lon"

# 道の駅訪問履歴フィールドコード
VISIT_DATETIME = "送信日時"
VISIT_ID       = "michinoeki_id"
VISIT_NAME     = "name"
VISIT_PREF     = "prefecture"
VISIT_CITY     = "city"


# ── グローバルキャッシュ（ウォームインスタンス間で再利用） ──
_station_cache: list[dict] | None = None
_cache_loaded_at: float = 0.0
CACHE_TTL_SEC = 3600  # 1時間


# ── HTTP ──────────────────────────────────────────────
def https_request(method: str, path: str, token: str, body: dict = None) -> dict:
    payload = json.dumps(body).encode() if body else None
    headers = {"X-Cybozu-API-Token": token}
    if payload:
        headers["Content-Type"] = "application/json"
    # IPv4 に固定して接続（Lambda 環境で IPv6 が EBUSY になるため）
    addrs = socket.getaddrinfo(DOMAIN, 443, socket.AF_INET, socket.SOCK_STREAM)
    ip = addrs[0][4][0]
    raw = socket.create_connection((ip, 443), timeout=15)
    ctx = ssl.create_default_context()
    ssl_sock = ctx.wrap_socket(raw, server_hostname=DOMAIN)

    conn = http.client.HTTPSConnection(DOMAIN, timeout=15)
    conn.sock = ssl_sock
    try:
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        if resp.status >= 400:
            raise RuntimeError(f"{method} {path}: {resp.status} {data.decode()}")
        return json.loads(data)
    finally:
        conn.close()


# ── kintone API ────────────────────────────────────────
def kintone_get(token: str, endpoint: str, params: dict) -> dict:
    path = f"/k/v1/{endpoint}?" + urllib.parse.urlencode(params)
    return https_request("GET", path, token)


def kintone_post(token: str, endpoint: str, body: dict) -> dict:
    path = f"/k/v1/{endpoint}"
    return https_request("POST", path, token, body)


def fetch_all_stations() -> list[dict]:
    """道の駅マスタから座標付き全駅を取得"""
    results = []
    limit, offset = 500, 0
    while True:
        data = kintone_get(MASTER_TOKEN, "records.json", {
            "app": MASTER_APP,
            "query": f"limit {limit} offset {offset}",
        })
        batch = data["records"]
        for r in batch:
            lat = r["latitude"]["value"]
            lon = r["longitude"]["value"]
            if lat and lon:
                results.append({
                    "id":         r["id"]["value"],
                    "lat":        float(lat),
                    "lon":        float(lon),
                    "name":       r["name"]["value"],
                    "prefecture": r["prefecture"]["value"],
                    "city":       r["city"]["value"],
                })
        if len(batch) < limit:
            break
        offset += limit
    return results


def get_stations() -> list[dict]:
    """キャッシュ付きで道の駅マスタを返す"""
    global _station_cache, _cache_loaded_at
    now = time.time()
    if _station_cache is not None and now - _cache_loaded_at < CACHE_TTL_SEC:
        return _station_cache
    print("道の駅マスタをkintoneから取得中...")
    _station_cache = fetch_all_stations()
    _cache_loaded_at = now
    print(f"  {len(_station_cache)} 駅をキャッシュ")
    return _station_cache


# ── 距離計算（Haversine） ──────────────────────────────
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_station(lat: float, lon: float) -> tuple[dict, float] | tuple[None, None]:
    """最近傍の道の駅を返す。RADIUS_M以内になければ (None, None)"""
    nearest, min_dist = None, float("inf")
    for s in get_stations():
        d = haversine_m(lat, lon, s["lat"], s["lon"])
        if d < min_dist:
            min_dist, nearest = d, s
    if nearest and min_dist <= RADIUS_M:
        return nearest, min_dist
    return None, None


# ── Webhook検証 ────────────────────────────────────────
def verify_webhook(event: dict) -> bool:
    if not WEBHOOK_TOKEN:
        return True
    token = (event.get("headers") or {}).get("X-Cybozu-Webhook-Token", "")
    return token == WEBHOOK_TOKEN


# ── Lambdaハンドラー ───────────────────────────────────
def _diag_network() -> dict:
    """ネットワーク疎通診断"""
    import socket
    results = {}
    for host in [DOMAIN, "www.google.com", "8.8.8.8"]:
        try:
            addrs = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
            results[host] = addrs[0][4][0]
        except Exception as e:
            results[host] = f"ERROR: {e}"
    return results


def lambda_handler(event: dict, context) -> dict:
    # 診断モード: event に {"diag": true} を渡すと疎通チェックのみ実行
    if event.get("diag"):
        result = _diag_network()
        print(f"診断結果: {result}")
        return {"statusCode": 200, "body": json.dumps(result)}

    if not verify_webhook(event):
        print("Webhookトークン不一致")
        return {"statusCode": 401, "body": "Unauthorized"}

    raw = event.get("body") or "{}"
    if isinstance(raw, dict):
        body = raw
    else:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return {"statusCode": 400, "body": "Invalid JSON"}

    if body.get("type") != "ADD_RECORD":
        return {"statusCode": 200, "body": "Skipped"}

    record = body.get("record", {})

    dt  = (record.get(GPS_DATETIME) or {}).get("value", "")
    lat = (record.get(GPS_LAT)      or {}).get("value", "")
    lon = (record.get(GPS_LON)      or {}).get("value", "")

    if not dt or not lat or not lon:
        print(f"必須フィールドが空: dt={dt}, lat={lat}, lon={lon}")
        return {"statusCode": 200, "body": "Skipped: missing fields"}

    lat, lon = float(lat), float(lon)
    print(f"GPS受信: dt={dt}, lat={lat}, lon={lon}")

    station, dist = find_nearest_station(lat, lon)
    if station is None:
        print(f"道の駅なし（最近傍が{RADIUS_M}m超）")
        return {"statusCode": 200, "body": "Not near any station"}

    print(f"道の駅検出: {station['name']} ({dist:.0f}m)")

    kintone_post(VISIT_TOKEN, "record.json", {
        "app": VISIT_APP,
        "record": {
            VISIT_DATETIME: {"value": dt},
            VISIT_ID:       {"value": station["id"]},
            VISIT_NAME:     {"value": station["name"]},
            VISIT_PREF:     {"value": station["prefecture"]},
            VISIT_CITY:     {"value": station["city"]},
        },
    })

    print(f"訪問履歴登録完了: {station['name']}")
    return {
        "statusCode": 200,
        "body": json.dumps({
            "result": "registered",
            "station": station["name"],
            "distance_m": round(dist, 1),
        }, ensure_ascii=False),
    }
