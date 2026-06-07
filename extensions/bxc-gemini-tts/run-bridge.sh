#!/usr/bin/env bash
#
# Copyright 2026 aphrody-code
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# run-bridge.sh — Bash script to launch the bxc-bridge HTTP server on Linux/macOS.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
  echo "Error: Bun is not installed or not in PATH." >&2
  echo "Please install Bun: https://bun.sh" >&2
  exit 1
fi

echo "Starting bxc-bridge server on http://127.0.0.1:8765..."
bun run "${SCRIPT_DIR}/bxc-bridge.ts"
