const { createLeaderboardRepository } = require("./repositories/leaderboardRepository");
const { createJsonLeaderboardRepository } = require("./repositories/jsonLeaderboardRepository");

function createHistoryRepository() {
  try {
    return createLeaderboardRepository();
  } catch (error) {
    console.warn("[history] sqlite unavailable, falling back to json:", error.message);
    return createJsonLeaderboardRepository();
  }
}

const leaderboardRepository = createHistoryRepository();

function readHistory(limit) {
  return leaderboardRepository.listTop(limit);
}

function addHistoryEntry(entry) {
  leaderboardRepository.insertEntry(entry);
  return readHistory();
}

function getHistoryStats() {
  return leaderboardRepository.stats();
}

module.exports = {
  readHistory: readHistory,
  addHistoryEntry: addHistoryEntry,
  getHistoryStats: getHistoryStats,
  leaderboardRepository: leaderboardRepository,
  storageType: leaderboardRepository.type,
  dbPath: leaderboardRepository.dbPath,
  legacyHistoryFile: leaderboardRepository.legacyHistoryFile || leaderboardRepository.filePath,
};
