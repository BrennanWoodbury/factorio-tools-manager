/**
 * jsdom implements no layout engine, so scroll APIs are missing entirely. The log
 * viewer follows its tail with scrollTo; stub it rather than guarding in product
 * code for a browser gap that doesn't exist in browsers.
 */
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
