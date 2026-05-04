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

function doGet(e) {
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
    // 最新レコードのfieldDatetimeを取得して7日分のカットオフを計算
    let queryFilter = '';
    const latestUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
      + '&query=' + encodeURIComponent('order by ' + fieldDatetime + ' desc limit 1')
      + '&fields[0]=' + encodeURIComponent(fieldDatetime);
    const latestData = JSON.parse(UrlFetchApp.fetch(latestUrl, {
      method: 'get',
      headers: { 'X-Cybozu-API-Token': apiToken },
      muteHttpExceptions: true
    }).getContentText());
    if (latestData.records && latestData.records.length > 0) {
      const latestDatetime = latestData.records[0][fieldDatetime] && latestData.records[0][fieldDatetime].value;
      if (latestDatetime) {
        const cutoff = new Date(new Date(latestDatetime).getTime() - 7 * 24 * 60 * 60 * 1000);
        const cutoffStr = Utilities.formatDate(cutoff, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
        queryFilter = fieldDatetime + ' >= "' + cutoffStr + '" and ';
      }
    }

    // Step1: GPSレコード取得（最新レコードから7日分）
    const query = encodeURIComponent(queryFilter + 'order by ' + fieldDatetime + ' asc limit 500');
    const url = 'https://' + domain + '/k/v1/records.json?app=' + appId + '&query=' + query;

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'X-Cybozu-API-Token': apiToken },
      muteHttpExceptions: true
    });

    const data = JSON.parse(response.getContentText());

    if (data.records) {
      data.records.forEach(function(record) {
        const latVal = record[fieldLat] && record[fieldLat].value;
        const lngVal = record[fieldLng] && record[fieldLng].value;
        const datetimeVal = record[fieldDatetime] && record[fieldDatetime].value;
        const keyVal = record[FIELD_KEY] && record[FIELD_KEY].value;

        if (latVal === '' || latVal == null || lngVal === '' || lngVal == null) return;

        const lat = parseFloat(latVal);
        const lng = parseFloat(lngVal);
        if (isNaN(lat) || isNaN(lng)) return;

        points.push({ lat: lat, lng: lng, datetime: datetimeVal || '', key: keyVal || '', name: '' });
      });
    }

    // Step2: 道の駅訪問履歴から施設名を取得
    const keys = Array.from(new Set(points.map(function(p) { return p.key; }).filter(function(k) { return k !== ''; })));
    if (keys.length > 0 && apiTokenRekishi) {
      const inValues = keys.map(function(k) { return '"' + k + '"'; }).join(',');
      const rekishiQuery = encodeURIComponent(
        FIELD_KEY + ' in (' + inValues + ') order by ' + FIELD_KEY + ' asc limit 500'
      );
      const rekishiUrl = 'https://' + domain + '/k/v1/records.json'
        + '?app=17'
        + '&query=' + rekishiQuery
        + '&fields[0]=' + encodeURIComponent(FIELD_KEY)
        + '&fields[1]=name';

      const rekishiResponse = UrlFetchApp.fetch(rekishiUrl, {
        method: 'get',
        headers: { 'X-Cybozu-API-Token': apiTokenRekishi },
        muteHttpExceptions: true
      });

      const rekishiData = JSON.parse(rekishiResponse.getContentText());
      const nameMap = {};
      if (rekishiData.records) {
        rekishiData.records.forEach(function(record) {
          const k = record[FIELD_KEY] && record[FIELD_KEY].value;
          const n = record['name'] && record['name'].value;
          if (k) nameMap[k] = n || '';
        });
      }

      // Step3: GPSレコードにname付加
      points.forEach(function(p) {
        p.name = nameMap[p.key] || '';
      });
    }
  } catch (err) {
    Logger.log(err);
  }

  const tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.pointsJson = JSON.stringify(points);

  return tmpl.evaluate()
    .setTitle('GPS Map')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
