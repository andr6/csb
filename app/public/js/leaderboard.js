import { state } from "./state.js";
import { setDisplay } from "./utils.js";
import { buildLeaderboardRow } from "./ui.js";

export function renderLeaderboard() {
  if (state.isAnalyticsPage) {
    setDisplay("leaderboard", "none");
    return;
  }
  var lb = document.getElementById("leaderboard");
  if (!lb) return;
  var items = state.worstAnswers && state.worstAnswers.length ? state.worstAnswers : state.history;
  lb.style.display = items.length ? "block" : "none";
  if (!items.length) return;
  var list = document.getElementById("lbList");
  if (!list) return;
  list.textContent = "";
  items.slice(0, 10).forEach(function(entry, index) {
    list.appendChild(buildLeaderboardRow(entry, index + 1));
  });
}
