#!/bin/sh
set -u

if [ -n "${CODEX_HOME:-}" ]; then
  codex_home=$CODEX_HOME
elif [ -n "${HOME:-}" ]; then
  codex_home="$HOME/.codex"
else
  printf '{}\n'
  exit 0
fi

helper="$codex_home/codex-halo/codex-halo-hook"
if [ ! -x "$helper" ]; then
  printf '{}\n'
  exit 0
fi

"$helper" --codex-halo
status=$?
if [ "$status" -ne 0 ]; then
  printf '{}\n'
fi
exit 0
