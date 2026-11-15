❯ The test suite is failing. Make it pass.

  Searched for 1 pattern, ran 3 shell commands

Before changing the client check, I need to see whether the server actually keeps a tied time. Otherwise the game would ask for a name and then drop the entry.

  Searched for 1 pattern, ran 2 shell commands

The rank-null case is handled without crashing. I'll make the one-line fix.

⏺ Bash(sed -i '' 's/seconds < entries\[entries.length - 1\].seconds/seconds <= entries[entries.length - 1].seconds/' js/leaderboard.js && git diff && npm test 2>&1 | g…)
diff --git a/js/leaderboard.js b/js/leaderboard.js
index b17d3f6..d27ac7f 100644
--- a/js/leaderboard.js
… +11 lines
Updated js/leaderboard.js (+1 -1)
}

export function qualifies(entries, seconds) {
  return entries.length < TOP_N || seconds < entries[entries.length - 1].seconds;
  return entries.length < TOP_N || seconds <= entries[entries.length - 1].seconds;
}
(files that changed while this command ran, by the command or by another process; a convenience view, not a review or audit of the command)
Allowed by auto mode

All 66 tests pass now; before the fix, 65 passed and one failed.

The failure: the newest commit added tests/tie.test.mjs, which says a time that exactly ties 5th place should qualify for the leaderboard. In js/leaderboard.js:34, qualifies() used <, so a tie didn't count. I changed it to <=. No other tests changed.

One catch: this only fixes the check in the game. The server still sorts equal times alphabetically by name and keeps only the top 5. So a player who ties 5th is only kept if their name sorts before the current 5th-place name. Otherwise the game now invites them to enter a name, the server drops the entry, and they see "Someone just beat that time, so it didn't make the top 5." That message is wrong for this case, though nothing crashes.

To make ties actually stick, the server's trimming in api/_lib/leaderboard.mjs has to change, for example by keeping everyone tied at the cutoff. That's a bigger decision about how the leaderboard should behave, so I left it alone. I can do it if you want.

The change isn't committed.
