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
    // 作成日時で最新レコードを取得して7日分のカットオフを計算
    let queryFilter = '';
    const latestUrl = 'https://' + domain + '/k/v1/records.json?app=' + appId
      + '&query=' + encodeURIComponent('order by 作成日時 desc limit 1')
      + '&fields[0]=作成日時';
    const latestData = JSON.parse(UrlFetchApp.fetch(latestUrl, {
      method: 'get',
      headers: { 'X-Cybozu-API-Token': apiToken },
      muteHttpExceptions: true
    }).getContentText());
    if (latestData.records && latestData.records.length > 0) {
      const latestCreated = latestData.records[0]['作成日時'] && latestData.records[0]['作成日時'].value;
      if (latestCreated) {
        const cutoff = new Date(new Date(latestCreated).getTime() - 7 * 24 * 60 * 60 * 1000);
        const cutoffStr = Utilities.formatDate(cutoff, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
        queryFilter = '作成日時 >= "' + cutoffStr + '"';
      }
    }

    // Step1: GPSレコード取得（最新レコードから7日分、作成日時順）
    const condition = queryFilter ? queryFilter + ' ' : '';
    const query = encodeURIComponent(condition + 'order by 作成日時 asc limit 500');
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
