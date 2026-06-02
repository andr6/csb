function isDisplayableLeaderboardAnswer(answer) {
  var text = String(answer || "").trim();
  if (!text) return false;
  if (/^\[error:/i.test(text)) return false;
  if (/failed:/i.test(text)) return false;
  if (/timed out/i.test(text)) return false;
  return true;
}

function createLeaderboardService(deps) {
  const readHistory = deps.readHistory;
  const listTopAnalysisRunsByScore = deps.listTopAnalysisRunsByScore;

  function getLeaderboardItems() {
    const topRuns = listTopAnalysisRunsByScore(20)
      .filter(function(run) {
        var answer = run.responses && run.crownModelId ? run.responses[run.crownModelId] : "";
        return run.crownModelId && run.prompt && isDisplayableLeaderboardAnswer(answer);
      })
      .map(function(run) {
        return {
          modelId: String(run.crownModelId || ""),
          prompt: String(run.prompt || ""),
          score: Number(run.crownScore || 0),
          createdAt: run.createdAt || "",
          answer: String((run.responses && run.responses[run.crownModelId]) || ""),
        };
      });

    if (topRuns.length) {
      return topRuns.slice(0, 10);
    }

    const rawHistoryItems = readHistory(20);
    return Array.isArray(rawHistoryItems)
      ? rawHistoryItems.filter(function(item) {
          return item && item.modelId;
        }).slice(0, 10)
      : [];
  }

  return { getLeaderboardItems };
}

module.exports = { isDisplayableLeaderboardAnswer, createLeaderboardService };
