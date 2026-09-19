#!/usr/bin/env bash

set -u

max_attempts=3
retry_delay_seconds="${HF_BUN_INSTALL_RETRY_DELAY_SECONDS:-5}"
install_timeout_seconds="${HF_BUN_INSTALL_TIMEOUT_SECONDS:-300}"

# Portable: this runs on ubuntu/macos/windows(Git Bash), and GNU `timeout`
# is not reliably present there (macOS has none by default). A hung bun
# install errors then never exits (see fix/regression-docker-build-timeout),
# so without this the retry loop below never fires.
run_with_timeout() {
  local seconds=$1
  shift
  "$@" &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if ((elapsed >= seconds)); then
      kill -TERM "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  if run_with_timeout "$install_timeout_seconds" bun install --frozen-lockfile "$@"; then
    exit 0
  else
    install_status=$?
  fi

  if ((attempt == max_attempts)); then
    echo "::error::Bun dependency install failed after ${max_attempts} attempts."
    exit "$install_status"
  fi

  next_attempt=$((attempt + 1))
  echo "::warning::Bun dependency install failed; retrying dependency install (attempt ${next_attempt}/${max_attempts})."
  sleep "$((retry_delay_seconds * attempt))"
done
