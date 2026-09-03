#!/usr/bin/env bash
# Compiles Hearthmoor's pure-logic runtime files + EditMode tests without Unity and runs them.
# Needs the .NET 8 SDK (https://dot.net). Exit code 0 = everything passed.
set -euo pipefail
cd "$(dirname "$0")"
dotnet run -c Release --nologo -v quiet
