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
  const fieldLat = props.getProperty('FIELD_LAT');
  const fieldLng = props.getProperty('FIELD_LNG');
  const fieldDatetime = props.getProperty('FIELD_DATETIME');

  let points = [];

  try {
    const query = encodeURIComponent('order by ' + fieldDatetime + ' asc limit 500');
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

        if (latVal === '' || latVal == null || lngVal === '' || lngVal == null) return;

        const lat = parseFloat(latVal);
        const lng = parseFloat(lngVal);
        if (isNaN(lat) || isNaN(lng)) return;

        points.push({ lat: lat, lng: lng, datetime: datetimeVal || '' });
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
