function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('GPS Map')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
