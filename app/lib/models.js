const { MODEL_MAP } = require("./config");
const { getPack, buildCharacterVoice, DEFAULT_PACK } = require("./packs");
const { createTtlCache } = require("./cache");

var VOICE_CACHE = createTtlCache(24 * 60 * 60 * 1000); // 24h TTL

function getVoice(modelId, packId) {
  var resolvedPackId = packId || DEFAULT_PACK;
  var cacheKey = modelId + "\x00" + resolvedPackId;
  var cached = VOICE_CACHE.get(cacheKey);
  if (cached === undefined) {
    var pack = getPack(resolvedPackId);
    var voice = buildCharacterVoice(pack, modelId, MODEL_MAP[modelId] || modelId);
    VOICE_CACHE.set(cacheKey, voice);
    return voice;
  }
  return cached;
}

module.exports = {
  getVoice: getVoice,
};
