#!/usr/bin/env bash
# Create the GitHub repo, push, and turn on Pages.
#
#   ./deploy.sh              -> repo named "brewlog"
#   ./deploy.sh my-name      -> repo named "my-name"
#
# Needs the GitHub CLI: brew install gh && gh auth login

set -euo pipefail
cd "$(dirname "$0")"

REPO="${1:-brewlog}"

if ! command -v gh >/dev/null 2>&1; then
  cat <<'EOF'
GitHub CLI not found. Either:

  brew install gh && gh auth login && ./deploy.sh

or do it by hand:

  1. Create an empty PUBLIC repo at https://github.com/new (no README, no .gitignore)
  2. git remote add origin https://github.com/<you>/brewlog.git
  3. git push -u origin main
  4. Repo Settings -> Pages -> Source: Deploy from a branch -> main -> / (root)
EOF
  exit 1
fi

[ -d .git ] || { git init -q -b main; git add -A; git commit -qm "Brewlog"; }
git branch -M main

USER="$(gh api user --jq .login)"

if gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  echo "Repo $USER/$REPO already exists — pushing to it."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO.git"
else
  gh repo create "$USER/$REPO" --public \
    --description "Personal coffee tasting journal — a local-first PWA." \
    --source=. --remote=origin
fi

git push -u origin main

echo "Enabling GitHub Pages…"
gh api -X POST "repos/$USER/$REPO/pages" \
  -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$USER/$REPO/pages" \
       -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "  (couldn't set it via API — turn it on in Settings -> Pages)"

echo
echo "Done. In a minute or two:"
echo "  https://$USER.github.io/$REPO/"
echo
echo "On your iPhone: open that URL in Safari -> Share -> Add to Home Screen."
