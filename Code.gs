function debugKintone() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const fieldLat = props.getProperty('FIELD_LAT');
  const fieldLng = props.getProperty('FIELD_LNG');
  const fieldDatetime = props.getProperty('FIELD_DATETIME');

  const allKeys = props.getKeys();
  Logger.log('設定済みプロパティキー一覧: %s', allKeys.join(', '));
  Logger.log('domain=%s appId=%s apiToken=%s fieldLat=%s fieldLng=%s fieldDatetime=%s',
    domain, appId, apiToken ? '(set)' : 'NULL', fieldLat, fieldLng, fieldDatetime);

  if (!apiToken) {
    Logger.log('エラー: API_TOKEN が取得できません。プロパティキー名を確認してください。');
    return;
  }

  const query = encodeURIComponent('order by ' + fieldDatetime + ' asc limit 5');
  const url = 'https://' + domain + '/k/v1/records.json?app=' + appId + '&query=' + query;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiToken },
    muteHttpExceptions: true
  });

  Logger.log('HTTP status: %s', response.getResponseCode());
  const data = JSON.parse(response.getContentText());

  if (data.message) {
    Logger.log('API error: %s', data.message);
    return;
  }

  Logger.log('totalCount=%s', data.totalCount);

  if (data.records && data.records.length > 0) {
    const first = data.records[0];
    Logger.log('first record keys: %s', Object.keys(first).join(', '));
    Logger.log('fieldLat value: %s', JSON.stringify(first[fieldLat]));
    Logger.log('fieldLng value: %s', JSON.stringify(first[fieldLng]));
    Logger.log('fieldDatetime value: %s', JSON.stringify(first[fieldDatetime]));
  }
}

function debugDoGet() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const apiTokenRekishi = props.getProperty('KINTONE_API_TOKEN_REKISHI');
  const fieldLat = props.getProperty('FIELD_LAT');
  const fieldLng = props.getProperty('FIELD_LNG');
  const FIELD_KEY = '送信日時YYYYMMddHHmm';

  // 最新作成日時を確認
  const latestUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
    + '&query=' + encodeURIComponent('order by 作成日時 desc limit 1')
    + '&fields[0]=作成日時';
  const latestData = JSON.parse(UrlFetchApp.fetch(latestUrl, {
    method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true
  }).getContentText());
  const latestCreated = latestData.records && latestData.records[0] && latestData.records[0]['作成日時'].value;
  Logger.log('最新作成日時: %s', latestCreated);

  const cutoff = new Date(new Date(latestCreated).getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoffStr = Utilities.formatDate(cutoff, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  Logger.log('カットオフ: %s', cutoffStr);

  // GPS取得
  const query = encodeURIComponent('作成日時 >= "' + cutoffStr + '" order by 作成日時 desc limit 500');
  const gpsData = JSON.parse(UrlFetchApp.fetch(
    'https://' + domain + '/k/v1/records.json?app=' + appId + '&query=' + query,
    { method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true }
  ).getContentText());

  const records = gpsData.records || [];
  Logger.log('取得GPS件数: %s', records.length);

  const keys = Array.from(new Set(records.map(function(r) {
    return r[FIELD_KEY] && r[FIELD_KEY].value;
  }).filter(function(k) { return k; })));
  Logger.log('有効FIELD_KEY数: %s', keys.length);
  Logger.log('FIELD_KEY一覧(先頭10件=最新): %s', keys.slice(0, 10).join(', '));
  Logger.log('FIELD_KEY一覧(末尾10件=最古): %s', keys.slice(-10).join(', '));

  // app17全件取得してメモリでマッチング
  const rekishiData = JSON.parse(UrlFetchApp.fetch(
    'https://' + domain + '/k/v1/records.json?app=17'
      + '&query=' + encodeURIComponent('order by ' + FIELD_KEY + ' asc limit 500')
      + '&fields[0]=' + encodeURIComponent(FIELD_KEY) + '&fields[1]=name',
    { method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenRekishi }, muteHttpExceptions: true }
  ).getContentText());
  if (rekishiData.message) { Logger.log('app17エラー: %s', rekishiData.message); return; }

  const nameMap = {};
  (rekishiData.records || []).forEach(function(r) {
    const k = r[FIELD_KEY] && r[FIELD_KEY].value;
    if (k) nameMap[k] = r['name'] && r['name'].value;
  });
  Logger.log('app17 nameMap件数: %s', Object.keys(nameMap).length);

  const keySet = new Set(keys);
  const matched = Object.keys(nameMap).filter(function(k) { return keySet.has(k); });
  Logger.log('GPS×app17 一致件数: %s', matched.length);
  Logger.log('一致キー(先頭5件): %s', matched.slice(0, 5).join(', '));
}

function debugRekishi3() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const apiTokenRekishi = props.getProperty('KINTONE_API_TOKEN_REKISHI');
  const FIELD_KEY = '送信日時YYYYMMddHHmm';

  // app17の全FIELD_KEY値を取得
  const rekishiUrl = 'https://' + domain + '/k/v1/records.json?app=17'
    + '&query=' + encodeURIComponent('order by ' + FIELD_KEY + ' asc limit 500')
    + '&fields[0]=' + encodeURIComponent(FIELD_KEY);
  const rekishiData = JSON.parse(UrlFetchApp.fetch(rekishiUrl, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiTokenRekishi },
    muteHttpExceptions: true
  }).getContentText());
  const rekishiKeys = (rekishiData.records || []).map(function(r) { return r[FIELD_KEY].value; });
  Logger.log('app17の全FIELD_KEY値: %s', rekishiKeys.join(', '));

  // GPSアプリからapp17のキーで逆引き
  if (rekishiKeys.length === 0) { Logger.log('app17にレコードなし'); return; }
  const inValues = rekishiKeys.map(function(k) { return '"' + k + '"'; }).join(',');
  const gpsUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
    + '&query=' + encodeURIComponent(FIELD_KEY + ' in (' + inValues + ') limit 500')
    + '&fields[0]=' + encodeURIComponent(FIELD_KEY);
  const gpsData = JSON.parse(UrlFetchApp.fetch(gpsUrl, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiToken },
    muteHttpExceptions: true
  }).getContentText());
  Logger.log('GPSアプリ内でapp17のキーに一致したレコード数: %s', (gpsData.records || []).length);
  Logger.log('一致したキー: %s', (gpsData.records || []).map(function(r) { return r[FIELD_KEY].value; }).join(', '));
}

function debugRekishi2() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const apiTokenRekishi = props.getProperty('KINTONE_API_TOKEN_REKISHI');

  // app17の最新5件をフィールド指定なしで取得してフィールド構造を確認
  const url = 'https://' + domain + '/k/v1/records.json?app=17'
    + '&query=' + encodeURIComponent('limit 5');
  const data = JSON.parse(UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiTokenRekishi },
    muteHttpExceptions: true
  }).getContentText());

  if (data.message) { Logger.log('API error: %s', data.message); return; }
  Logger.log('app17 レコード数: %s', (data.records || []).length);
  if (data.records && data.records.length > 0) {
    const first = data.records[0];
    Logger.log('app17 フィールド一覧: %s', Object.keys(first).join(', '));
    Logger.log('app17 最初のレコード全体: %s', JSON.stringify(first));
  }
}

function debugRekishi() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const apiTokenRekishi = props.getProperty('KINTONE_API_TOKEN_REKISHI');
  const FIELD_KEY = '送信日時YYYYMMddHHmm';

  Logger.log('apiTokenRekishi=%s', apiTokenRekishi ? '(set)' : 'NULL');

  // GPS側から最新5件のFIELD_KEY値を取得
  const gpsUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
    + '&query=' + encodeURIComponent('order by ' + FIELD_KEY + ' desc limit 5')
    + '&fields[0]=' + encodeURIComponent(FIELD_KEY);
  const gpsData = JSON.parse(UrlFetchApp.fetch(gpsUrl, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiToken },
    muteHttpExceptions: true
  }).getContentText());

  if (gpsData.message) { Logger.log('GPS API error: %s', gpsData.message); return; }

  const keys = (gpsData.records || []).map(function(r) {
    return r[FIELD_KEY] && r[FIELD_KEY].value;
  }).filter(function(k) { return k; });
  Logger.log('GPS側のFIELD_KEY値: %s', keys.join(', '));

  if (keys.length === 0) { Logger.log('FIELD_KEYが空のため道の駅検索をスキップ'); return; }

  // 道の駅履歴アプリにINクエリ
  const inValues = keys.map(function(k) { return '"' + k + '"'; }).join(',');
  const rekishiQuery = encodeURIComponent(
    FIELD_KEY + ' in (' + inValues + ') order by ' + FIELD_KEY + ' asc limit 500'
  );
  const rekishiUrl = 'https://' + domain + '/k/v1/records.json'
    + '?app=17'
    + '&query=' + rekishiQuery
    + '&fields[0]=' + encodeURIComponent(FIELD_KEY)
    + '&fields[1]=name';
  Logger.log('rekishiUrl: %s', rekishiUrl);

  const rekishiData = JSON.parse(UrlFetchApp.fetch(rekishiUrl, {
    method: 'get',
    headers: { 'X-Cybozu-API-Token': apiTokenRekishi },
    muteHttpExceptions: true
  }).getContentText());

  Logger.log('HTTP status rekishi: %s', rekishiData.message ? 'error' : 'ok');
  if (rekishiData.message) { Logger.log('Rekishi API error: %s', rekishiData.message); return; }
  Logger.log('取得レコード数: %s', (rekishiData.records || []).length);
  if (rekishiData.records && rekishiData.records.length > 0) {
    Logger.log('最初のレコード: %s', JSON.stringify(rekishiData.records[0]));
  }
}

function debugCount() {
  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');

  const latestData = JSON.parse(UrlFetchApp.fetch(
    'https://' + domain + '/k/v1/records.json?app=' + appId
      + '&query=' + encodeURIComponent('order by 作成日時 desc limit 1')
      + '&fields[0]=作成日時',
    { method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true }
  ).getContentText());

  const latestCreated = latestData.records[0]['作成日時'].value;
  const latestJSTDate = Utilities.formatDate(new Date(latestCreated), 'Asia/Tokyo', 'yyyy-MM-dd');
  const parts = latestJSTDate.split('-');
  const cutoff27 = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]) - 27) - 9 * 60 * 60 * 1000);
  const cutoff27Str = Utilities.formatDate(cutoff27, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");

  Logger.log('最新作成日時: %s', latestCreated);
  Logger.log('カットオフ(27日前): %s', cutoff27Str);

  const countData = JSON.parse(UrlFetchApp.fetch(
    'https://' + domain + '/k/v1/records.json?app=' + appId
      + '&query=' + encodeURIComponent('作成日時 >= "' + cutoff27Str + '" order by 作成日時 asc limit 1')
      + '&totalCount=true',
    { method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true }
  ).getContentText());

  Logger.log('27日間のGPS件数: %s', countData.totalCount);

  // offsetをクエリ文字列に含める方式で各ページの件数を確認
  const gpsFilter = '作成日時 >= "' + cutoff27Str + '" order by 作成日時 asc limit 500';
  const gpsFields = 'fields[0]=' + encodeURIComponent('作成日時');
  const gpsApiBase = 'https://' + domain + '/k/v1/records.json?app=' + appId + '&' + gpsFields;
  const requests = [0, 500, 1000].map(function(offset) {
    return { url: gpsApiBase + '&query=' + encodeURIComponent(gpsFilter + ' offset ' + offset),
      method: 'get', headers: { 'X-Cybozu-API-Token': apiToken }, muteHttpExceptions: true };
  });
  UrlFetchApp.fetchAll(requests).forEach(function(response, i) {
    const data = JSON.parse(response.getContentText());
    const records = data.records || [];
    Logger.log('offset=%s: %s件', i * 500, records.length);
    if (records.length > 0) {
      Logger.log('  最古: %s', records[0]['作成日時'].value);
      Logger.log('  最新: %s', records[records.length - 1]['作成日時'].value);
    }
    if (data.message) Logger.log('エラー: %s', data.message);
  });
}

function doGet(e) {
  const CACHE_KEY = 'gps_map_points_v9';
  const CACHE_TTL = 300; // 5分

  // キャッシュヒット時は即返す
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    const tmpl = HtmlService.createTemplateFromFile('index');
    tmpl.pointsJson = cached;
    return tmpl.evaluate().setTitle('GPS Map').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const props = PropertiesService.getScriptProperties();
  const domain = props.getProperty('KINTONE_DOMAIN');
  const appId = props.getProperty('APP_ID');
  const apiToken = props.getProperty('API_TOKEN');
  const apiTokenRekishi = props.getProperty('KINTONE_API_TOKEN_REKISHI');
  const fieldLat = props.getProperty('FIELD_LAT');
  const fieldLng = props.getProperty('FIELD_LNG');
  const fieldDatetime = props.getProperty('FIELD_DATETIME');
  const FIELD_KEY = '送信日時YYYYMMddHHmm';

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

    const cutoff27 = jstMidnight(27);
    const cutoff27Str = Utilities.formatDate(cutoff27, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
    // 最新日のJST日付（daysAgo計算の基準）
    const latestDateMs = new Date(latestJSTDate).getTime();

    // Step1: GPSレコード取得（送信日時あり・27日前0時以降、最大4ページを並列取得）
    // offsetはkintoneクエリ文字列に含める必要がある（URLパラメータ不可）
    const gpsFilter = fieldDatetime + ' >= "' + cutoff27Str + '" and ' + fieldDatetime + ' != "" order by ' + fieldDatetime + ' asc limit 500';
    const gpsFields = [fieldLat, fieldLng, fieldDatetime, FIELD_KEY]
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
    // ページは昇順で返るため追加ソート不要

    allGpsRecords.forEach(function(record) {
      const latVal = record[fieldLat] && record[fieldLat].value;
      const lngVal = record[fieldLng] && record[fieldLng].value;
      if (latVal === '' || latVal == null || lngVal === '' || lngVal == null) return;
      const lat = parseFloat(latVal);
      const lng = parseFloat(lngVal);
      if (isNaN(lat) || isNaN(lng)) return;

      const datetimeVal = record[fieldDatetime] && record[fieldDatetime].value;
      const keyVal = record[FIELD_KEY] && record[FIELD_KEY].value;
      let daysAgo = 27;
      if (datetimeVal) {
        const dtJSTDate = Utilities.formatDate(new Date(datetimeVal), 'Asia/Tokyo', 'yyyy-MM-dd');
        daysAgo = Math.round((latestDateMs - new Date(dtJSTDate).getTime()) / 86400000);
      }

      points.push({ lat: lat, lng: lng, datetime: datetimeVal || '', key: keyVal || '', name: '', daysAgo: daysAgo });
    });

    // Step2: 道の駅訪問履歴（27日前以降）を取得してメモリ上でマッチング
    if (apiTokenRekishi) {
      const rekishiUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=17'
        + '&query=' + encodeURIComponent('作成日時 >= "' + cutoff27Str + '" order by ' + FIELD_KEY + ' asc limit 500')
        + '&fields[0]=' + encodeURIComponent(FIELD_KEY)
        + '&fields[1]=name';

      const rekishiData = JSON.parse(UrlFetchApp.fetch(rekishiUrl, {
        method: 'get', headers: { 'X-Cybozu-API-Token': apiTokenRekishi }, muteHttpExceptions: true
      }).getContentText());

      const nameMap = {};
      if (rekishiData.records) {
        rekishiData.records.forEach(function(record) {
          const k = record[FIELD_KEY] && record[FIELD_KEY].value;
          const n = record['name'] && record['name'].value;
          if (k) nameMap[k] = n || '';
        });
      }

      // Step3: GPSレコードにname付加
      points.forEach(function(p) { p.name = nameMap[p.key] || ''; });
    }

    // クライアントに不要なkeyを除去
    points.forEach(function(p) { delete p.key; });
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

  const tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.pointsJson = pointsJson;

  return tmpl.evaluate()
    .setTitle('GPS Map')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
