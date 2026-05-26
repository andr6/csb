const { MODEL_MAP } = require("./config");
const { getPack, buildCharacterVoice, DEFAULT_PACK } = require("./packs");

var VOICE_CACHE = {};

function getVoice(modelId, packId) {
  var resolvedPackId = packId || DEFAULT_PACK;
  var cacheKey = modelId + "\x00" + resolvedPackId;
  if (!VOICE_CACHE[cacheKey]) {
    var pack = getPack(resolvedPackId);
    VOICE_CACHE[cacheKey] = buildCharacterVoice(pack, modelId, MODEL_MAP[modelId] || modelId);
  }
  return VOICE_CACHE[cacheKey];
}

module.exports = {
  getVoice: getVoice,
};
