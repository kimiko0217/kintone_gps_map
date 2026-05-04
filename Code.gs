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
