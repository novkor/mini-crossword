#!/usr/bin/env bash
# Update the server to the latest code on GitHub. Run it on the server:
#   bash ~/mini-crossword/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull
npm ci
npm run validate   # refuse to deploy broken puzzles
npm run build
sudo systemctl restart mini-crossword
echo "Updated and restarted. Status:"
systemctl --no-pager --lines=5 status mini-crossword
