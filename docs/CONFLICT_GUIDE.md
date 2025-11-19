# Merge Conflict Guide

The repository currently has no merge markers, but if GitHub shows a conflict while
trying to merge this branch (for example, `client.js` vs `public/client.js`), keep the
version that lives inside the `public/` folder. That option is usually labeled **Use
incoming changes** or **Use theirs** in the GitHub UI. After selecting it, delete the
stale `client.js` entry and keep `public/client.js` so the client bundle matches the
server's static directory.

Steps:
1. In the conflict editor, choose the option that keeps `public/client.js`.
2. Remove any leftover conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
3. Commit the resolved file and push.
4. GitHub will mark the conflict as resolved and you can complete the merge.

If you run into another conflict and need help, capture the file list that GitHub shows
and we can walk through the best option for each file.
