"""
国土数値情報（P35: 道の駅）から名前・都道府県・緯度・経度をCSVに出力するスクリプト
データURL: https://nlftp.mlit.go.jp/ksj/gml/data/P35/P35-18/P35-18_GML.zip
"""

import csv
import io
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

URL = "https://nlftp.mlit.go.jp/ksj/gml/data/P35/P35-18/P35-18_GML.zip"
OUTPUT_CSV = "michinoeki.csv"

KSJ_NS = "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app"


def download_zip(url: str) -> bytes:
    print(f"ダウンロード中: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    print(f"  -> {len(data):,} bytes")
    return data


def find_xml_bytes_in_zip(zip_data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        xml_files = [n for n in zf.namelist() if n.endswith(".xml") and "META" not in n]
        if not xml_files:
            raise FileNotFoundError("XMLファイルが見つかりません")
        print(f"解析対象: {xml_files[0]}")
        return zf.read(xml_files[0])


def parse_gml(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    ns = KSJ_NS
    gml_ns = "http://www.opengis.net/gml/3.2"
    xlink_ns = "http://www.w3.org/1999/xlink"

    # gml:Point の id -> (lat, lon) マップを構築
    point_coords: dict[str, tuple[float, float]] = {}
    for pt in root.iter(f"{{{gml_ns}}}Point"):
        pt_id = pt.get(f"{{{gml_ns}}}id")
        pos = pt.find(f"{{{gml_ns}}}pos")
        if pt_id and pos is not None and pos.text:
            parts = pos.text.strip().split()
            if len(parts) >= 2:
                point_coords[pt_id] = (float(parts[0]), float(parts[1]))

    records = []
    for station in root.iter(f"{{{ns}}}RoadsideStation"):
        def text(tag):
            el = station.find(f"{{{ns}}}{tag}")
            return el.text.strip() if el is not None and el.text else ""

        name = text("NameOfRoadsideStation")
        prefecture = text("PrefectureName")
        city = text("LocalGovernmentName")
        area_code = text("AdministrativeAreaCode")
        url1 = text("URL1")

        # URL1 末尾の数字を p35_id として抽出
        import re
        m = re.search(r"/(\d+)$", url1)
        p35_id = m.group(1) if m else ""

        # gml:Point 参照から高精度座標を取得
        pt_ref = station.find(f"{{{ns}}}PointofRoadsideStation")
        href = pt_ref.get(f"{{{xlink_ns}}}href", "").lstrip("#") if pt_ref is not None else ""
        coords = point_coords.get(href)
        if coords is None:
            continue

        records.append({
            "id": p35_id,
            "p35_id": p35_id,
            "name": name,
            "prefecture": prefecture,
            "city": city,
            "administrative_area_code": area_code,
            "latitude": coords[0],
            "longitude": coords[1],
            "source": "国土数値情報P35-18",
        })

    return records


def save_csv(records: list[dict], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "p35_id", "name", "prefecture", "city", "administrative_area_code", "latitude", "longitude", "source"])
        writer.writeheader()
        writer.writerows(records)
    print(f"CSVを保存しました: {path}  ({len(records)} 件)")


def main():
    zip_data = download_zip(URL)
    xml_bytes = find_xml_bytes_in_zip(zip_data)
    records = parse_gml(xml_bytes)

    print(f"取得件数: {len(records)}")
    if records:
        for r in records[:3]:
            print(f"  {r}")

    save_csv(records, OUTPUT_CSV)


if __name__ == "__main__":
    main()
