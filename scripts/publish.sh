#!/usr/bin/env bash
# 发布到自己的 git：bash scripts/publish.sh <git-remote-url>
# 例：bash scripts/publish.sh git@github.com:USER/dsh-reqable-mcp.git
set -euo pipefail

REMOTE="${1:-${GIT_REMOTE:-}}"
BRANCH="${BRANCH:-main}"
if [ -z "$REMOTE" ]; then
  echo "用法: bash scripts/publish.sh <git-remote-url>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  git init -q
  echo "已初始化 git 仓库"
fi

if [ -z "$(git config user.name || true)" ]; then
  git config user.name "${GIT_USER:-${USER:-dsh}}"
fi
if [ -z "$(git config user.email || true)" ]; then
  git config user.email "${GIT_EMAIL:-${USER:-dsh}@localhost}"
fi

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的改动"
else
  git commit -q -m "${COMMIT_MESSAGE:-chore: publish $(date +%F)}"
  echo "已提交"
fi

git branch -M "$BRANCH"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

git push -u origin "$BRANCH"
echo "已推送到 $REMOTE ($BRANCH)"
