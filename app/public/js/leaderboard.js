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
  lb.style.display = state.history.length ? "block" : "none";
  if (!state.history.length) return;
  var list = document.getElementById("lbList");
  if (!list) return;
  list.textContent = "";
  state.history.slice(0, 10).forEach(function(entry, index) {
    list.appendChild(buildLeaderboardRow(entry, index + 1));
  });
}
