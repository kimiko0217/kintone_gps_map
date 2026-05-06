function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// HTMLのみ即返却する。データ取得を getPoints() に分離することで、
// ブラウザがHTMLを受け取った直後にスピナーを表示できる。
// データはクライアントが google.script.run.getPoints() で非同期取得する。
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('GPS Map')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPoints() {
  const CACHE_KEY = 'gps_map_points_v14';
  const CACHE_TTL = 300; // 5分

  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const apiTokenMichinoekiRireki = props.getProperty('KINTONE_API_TOKEN_MICHINOEKI_RIREKI');
  const appIdMichinoekiRireki = props.getProperty('KINTONE_APP_ID_MICHINOEKI_RIREKI');
  const appIdExclude = props.getProperty('KINTONE_APP_ID_EXCLUDE');
  const apiTokenExclude = props.getProperty('KINTONE_API_TOKEN_EXCLUDE');
  const fieldLat = props.getProperty('FIELD_LAT');
  const fieldLng = props.getProperty('FIELD_LNG');
  const fieldDatetime = props.getProperty('FIELD_DATETIME');
  const fieldKey             = props.getProperty('FIELD_KEY');
  const fieldType            = props.getProperty('FIELD_TYPE');
  const fieldExcludeLat      = props.getProperty('FIELD_EXCLUDE_LAT');
  const fieldExcludeLng      = props.getProperty('FIELD_EXCLUDE_LON');
  const fieldExcludeRadius   = props.getProperty('FIELD_EXCLUDE_RADIUS');
  const fieldExcludeName     = props.getProperty('FIELD_EXCLUDE_NAME');
  const fieldMichinoekiName  = props.getProperty('FIELD_MICHINOEKI_NAME');
  const fieldTemp            = props.getProperty('FIELD_TEMP');

  let points = [];

  try {
    // 送信日時が入っている最新レコードを取得
    const latestUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
      + '&query=' + encodeURIComponent(fieldDatetime + ' != "" order by ' + fieldDatetime + ' desc limit 1')
      + '&fields[0]=' + encodeURIComponent(fieldDatetime);
    const latestData = JSON.parse(UrlFetchApp.fetch(latestUrl, {
      method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true
    }).getContentText());

    if (!latestData.records || latestData.records.length === 0) throw new Error('No records');
    const latestDatetime = latestData.records[0][fieldDatetime].value;

    // JST日付から各カットオフを計算
    const latestJSTDate = Utilities.formatDate(new Date(latestDatetime), 'Asia/Tokyo', 'yyyy-MM-dd');
    const p = latestJSTDate.split('-');
    const y = parseInt(p[0]), mo = parseInt(p[1]) - 1, d = parseInt(p[2]);

    function jstMidnight(daysBack) {
      return new Date(Date.UTC(y, mo, d - daysBack) - 9 * 60 * 60 * 1000);
    }

    const cutoff6 = jstMidnight(9);
    const cutoff6Str = Utilities.formatDate(cutoff6, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
    const latestDateMs = new Date(latestJSTDate).getTime();

    // Step1: GPSレコード取得（送信日時あり・27日前0時以降、最大4ページを並列取得）
    const gpsFilter = fieldDatetime + ' >= "' + cutoff6Str + '" and ' + fieldDatetime + ' != "" order by ' + fieldDatetime + ' asc limit 500';
    const gpsFields = [fieldLat, fieldLng, fieldDatetime, fieldKey, fieldType, fieldTemp]
      .map(function(f, i) { return 'fields[' + i + ']=' + encodeURIComponent(f); }).join('&');
    const gpsApiBase = 'https://' + domain + '/k/v1/records.json?app=' + appId + '&' + gpsFields;
    const fetchOptions = { method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true };

    const requests = [0, 500, 1000, 1500].map(function(offset) {
      return Object.assign({
        url: gpsApiBase + '&query=' + encodeURIComponent(gpsFilter + ' offset ' + offset)
      }, fetchOptions);
    });
    const allGpsRecords = [];
    UrlFetchApp.fetchAll(requests).forEach(function(response) {
      const data = JSON.parse(response.getContentText());
      (data.records || []).forEach(function(r) { allGpsRecords.push(r); });
    });

    allGpsRecords.forEach(function(record) {
      const latVal = record[fieldLat] && record[fieldLat].value;
      const lngVal = record[fieldLng] && record[fieldLng].value;
      if (latVal === '' || latVal == null || lngVal === '' || lngVal == null) return;
      const lat = parseFloat(latVal);
      const lng = parseFloat(lngVal);
      if (isNaN(lat) || isNaN(lng)) return;

      const datetimeVal = record[fieldDatetime] && record[fieldDatetime].value;
      const keyVal = record[fieldKey] && record[fieldKey].value;
      const typeVal = record[fieldType] && record[fieldType].value;
      const tempRaw = record[fieldTemp] && record[fieldTemp].value;
      const tempVal = (tempRaw !== '' && tempRaw != null) ? parseFloat(tempRaw) : null;
      let daysAgo = 27;
      if (datetimeVal) {
        const dtJSTDate = Utilities.formatDate(new Date(datetimeVal), 'Asia/Tokyo', 'yyyy-MM-dd');
        daysAgo = Math.round((latestDateMs - new Date(dtJSTDate).getTime()) / 86400000);
      }

      points.push({ lat: lat, lng: lng, datetime: datetimeVal || '', key: keyVal || '', name: '', daysAgo: daysAgo, star: typeVal === '1', temp: tempVal });
    });

    // Step2: 除外エリアによるフィルタリング
    if (appIdExclude && apiTokenExclude) {
      const excludeUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=' + appIdExclude
        + '&fields[0]=' + encodeURIComponent(fieldExcludeLat)
        + '&fields[1]=' + encodeURIComponent(fieldExcludeLng)
        + '&fields[2]=' + encodeURIComponent(fieldExcludeRadius)
        + '&fields[3]=' + encodeURIComponent(fieldExcludeName);
      const excludeData = JSON.parse(UrlFetchApp.fetch(excludeUrl, {
        method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenExclude }, muteHttpExceptions: true
      }).getContentText());

      if (excludeData.records && excludeData.records.length > 0) {
        const excludeZones = excludeData.records.map(function(r) {
          return {
            lat: parseFloat(r[fieldExcludeLat] && r[fieldExcludeLat].value),
            lon: parseFloat(r[fieldExcludeLng] && r[fieldExcludeLng].value),
            radius_m: parseFloat(r[fieldExcludeRadius] && r[fieldExcludeRadius].value)
          };
        }).filter(function(z) {
          return !isNaN(z.lat) && !isNaN(z.lon) && !isNaN(z.radius_m);
        });

        points = points.filter(function(pt) {
          return !excludeZones.some(function(z) {
            return haversine(pt.lat, pt.lng, z.lat, z.lon) <= z.radius_m;
          });
        });
      }
    }

    // Step3: 道の駅訪問履歴（27日前以降）を取得してメモリ上でマッチング
    if (apiTokenMichinoekiRireki) {
      const rekishiUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=' + appIdMichinoekiRireki
        + '&query=' + encodeURIComponent('作成日時 >= "' + cutoff6Str + '" order by ' + fieldKey + ' asc limit 500')
        + '&fields[0]=' + encodeURIComponent(fieldKey)
        + '&fields[1]=' + encodeURIComponent(fieldMichinoekiName);

      const rekishiData = JSON.parse(UrlFetchApp.fetch(rekishiUrl, {
        method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenMichinoekiRireki }, muteHttpExceptions: true
      }).getContentText());

      const nameMap = {};
      if (rekishiData.records) {
        rekishiData.records.forEach(function(record) {
          const k = record[fieldKey] && record[fieldKey].value;
          const n = record[fieldMichinoekiName] && record[fieldMichinoekiName].value;
          if (k) nameMap[k] = n || '';
        });
      }

      // Step4: GPSレコードにname付加
      points.forEach(function(pt) { pt.name = nameMap[pt.key] || ''; });
    }

    // クライアントに不要なkeyを除去
    points.forEach(function(pt) { delete pt.key; });
  } catch (err) {
    Logger.log(err);
  }

  const pointsJson = JSON.stringify(points);

  // キャッシュに保存（100KB上限を超える場合は保存しない）
  try {
    if (pointsJson.length <= 100000) cache.put(CACHE_KEY, pointsJson, CACHE_TTL);
  } catch (err) {
    Logger.log('Cache put failed: ' + err);
  }

  return points;
}

function getPointsByRange(fromDateStr, toDateStr) {
  const props = PropertiesService.getScriptProperties();
  const domain               = props.getProperty('KINTONE_DOMAIN');
  const appId                = props.getProperty('APP_ID');
  const apiToken             = props.getProperty('API_TOKEN');
  const fieldLat             = props.getProperty('FIELD_LAT');
  const fieldLng             = props.getProperty('FIELD_LNG');
  const fieldDatetime        = props.getProperty('FIELD_DATETIME');
  const fieldKey             = props.getProperty('FIELD_KEY');
  const fieldType            = props.getProperty('FIELD_TYPE');
  const fieldTemp            = props.getProperty('FIELD_TEMP');
  const appIdExclude         = props.getProperty('KINTONE_APP_ID_EXCLUDE');
  const apiTokenExclude      = props.getProperty('KINTONE_API_TOKEN_EXCLUDE');
  const appIdMichinoekiRireki    = props.getProperty('KINTONE_APP_ID_MICHINOEKI_RIREKI');
  const apiTokenMichinoekiRireki = props.getProperty('KINTONE_API_TOKEN_MICHINOEKI_RIREKI');
  const fieldMichinoekiName  = props.getProperty('FIELD_MICHINOEKI_NAME');
  const fieldExcludeLat      = props.getProperty('FIELD_EXCLUDE_LAT');
  const fieldExcludeLng      = props.getProperty('FIELD_EXCLUDE_LON');
  const fieldExcludeRadius   = props.getProperty('FIELD_EXCLUDE_RADIUS');
  const fieldExcludeName     = props.getProperty('FIELD_EXCLUDE_NAME');
  const FIELD_KEY            = fieldKey;

  // JST日付("YYYY-MM-DD")をUTC ISOに変換
  function jstDateToUtc(dateStr, endOfDay) {
    var p = dateStr.split('-');
    var ms = Date.UTC(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])) - 9 * 60 * 60 * 1000;
    if (endOfDay) ms += 24 * 60 * 60 * 1000 - 1000;
    return Utilities.formatDate(new Date(ms), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  }

  const fromUtc = jstDateToUtc(fromDateStr, false);
  const toUtc   = jstDateToUtc(toDateStr,   true);

  let points = [];

  try {
    const filter = fieldDatetime + ' >= "' + fromUtc + '" and ' + fieldDatetime + ' <= "' + toUtc + '" and ' + fieldDatetime + ' != "" order by ' + fieldDatetime + ' asc limit 500';
    const gpsFields = [fieldLat, fieldLng, fieldDatetime, fieldKey, fieldType, fieldTemp]
      .map(function(f, i) { return 'fields[' + i + ']=' + encodeURIComponent(f); }).join('&');
    const gpsApiBase = 'https://' + domain + '/k/v1/records.json?app=' + appId + '&' + gpsFields;
    const fetchOptions = { method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true };

    // 最大5000件（10並列）
    const requests = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500].map(function(offset) {
      return Object.assign({ url: gpsApiBase + '&query=' + encodeURIComponent(filter + ' offset ' + offset) }, fetchOptions);
    });
    const allGpsRecords = [];
    UrlFetchApp.fetchAll(requests).forEach(function(response) {
      const data = JSON.parse(response.getContentText());
      (data.records || []).forEach(function(r) { allGpsRecords.push(r); });
    });

    let latestDateMs = 0;
    allGpsRecords.forEach(function(r) {
      const dt = r[fieldDatetime] && r[fieldDatetime].value;
      if (dt) {
        const ms = new Date(Utilities.formatDate(new Date(dt), 'Asia/Tokyo', 'yyyy-MM-dd')).getTime();
        if (ms > latestDateMs) latestDateMs = ms;
      }
    });

    allGpsRecords.forEach(function(record) {
      const latVal = record[fieldLat] && record[fieldLat].value;
      const lngVal = record[fieldLng] && record[fieldLng].value;
      if (latVal === '' || latVal == null || lngVal === '' || lngVal == null) return;
      const lat = parseFloat(latVal);
      const lng = parseFloat(lngVal);
      if (isNaN(lat) || isNaN(lng)) return;

      const datetimeVal = record[fieldDatetime] && record[fieldDatetime].value;
      const keyVal  = record[fieldKey]  && record[fieldKey].value;
      const typeVal = record[fieldType] && record[fieldType].value;
      const tempRaw = record[fieldTemp] && record[fieldTemp].value;
      const tempVal = (tempRaw !== '' && tempRaw != null) ? parseFloat(tempRaw) : null;
      let daysAgo = 0;
      if (datetimeVal && latestDateMs > 0) {
        const dtJSTDate = Utilities.formatDate(new Date(datetimeVal), 'Asia/Tokyo', 'yyyy-MM-dd');
        daysAgo = Math.round((latestDateMs - new Date(dtJSTDate).getTime()) / 86400000);
      }
      points.push({ lat: lat, lng: lng, datetime: datetimeVal || '', key: keyVal || '', name: '', daysAgo: daysAgo, star: typeVal === '1', temp: tempVal });
    });

    if (appIdExclude && apiTokenExclude) {
      const excludeUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=' + appIdExclude
        + '&fields[0]=' + encodeURIComponent(fieldExcludeLat)
        + '&fields[1]=' + encodeURIComponent(fieldExcludeLng)
        + '&fields[2]=' + encodeURIComponent(fieldExcludeRadius)
        + '&fields[3]=' + encodeURIComponent(fieldExcludeName);
      const excludeData = JSON.parse(UrlFetchApp.fetch(excludeUrl, {
        method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenExclude }, muteHttpExceptions: true
      }).getContentText());
      if (excludeData.records && excludeData.records.length > 0) {
        const excludeZones = excludeData.records.map(function(r) {
          return {
            lat: parseFloat(r[fieldExcludeLat] && r[fieldExcludeLat].value),
            lon: parseFloat(r[fieldExcludeLng] && r[fieldExcludeLng].value),
            radius_m: parseFloat(r[fieldExcludeRadius] && r[fieldExcludeRadius].value)
          };
        }).filter(function(z) { return !isNaN(z.lat) && !isNaN(z.lon) && !isNaN(z.radius_m); });
        points = points.filter(function(pt) {
          return !excludeZones.some(function(z) { return haversine(pt.lat, pt.lng, z.lat, z.lon) <= z.radius_m; });
        });
      }
    }

    if (apiTokenMichinoekiRireki) {
      const rekishiUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=' + appIdMichinoekiRireki
        + '&query=' + encodeURIComponent('作成日時 >= "' + fromUtc + '" and 作成日時 <= "' + toUtc + '" order by ' + FIELD_KEY + ' asc limit 500')
        + '&fields[0]=' + encodeURIComponent(fieldKey)
        + '&fields[1]=' + encodeURIComponent(fieldMichinoekiName);
      const rekishiData = JSON.parse(UrlFetchApp.fetch(rekishiUrl, {
        method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenMichinoekiRireki }, muteHttpExceptions: true
      }).getContentText());
      const nameMap = {};
      if (rekishiData.records) {
        rekishiData.records.forEach(function(record) {
          const k = record[fieldKey]            && record[fieldKey].value;
          const n = record[fieldMichinoekiName] && record[fieldMichinoekiName].value;
          if (k) nameMap[k] = n || '';
        });
      }
      points.forEach(function(pt) { pt.name = nameMap[pt.key] || ''; });
    }

    points.forEach(function(pt) { delete pt.key; });
  } catch (err) {
    Logger.log(err);
  }

  return points;
}
