#!/usr/bin/env bash
# Kept for compatibility: the AI setup now lives in setup-ai.sh (cloud or local models).
exec bash "$(dirname "$0")/setup-ai.sh" "$@"
