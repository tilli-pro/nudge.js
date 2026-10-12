#!/usr/bin/env bash
# Proves the packed tarball, not the source tree, works for a consumer:
# the exports map, ESM loading, and type resolution under NodeNext.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
command -v npm >/dev/null || { echo "pack-smoke: npm is required"; exit 1; }

(cd "$ROOT" && pnpm build)
(cd "$ROOT" && pnpm pack --pack-destination "$TMP" >/dev/null)
TGZ="$(ls "$TMP"/*.tgz)"

# Listed once into a file: `grep -q` on a pipe from GNU tar fails under pipefail.
ENTRIES="$TMP/entries.txt"
tar -tzf "$TGZ" > "$ENTRIES"

echo "- the tarball holds the published files"
for path in package/package.json package/README.md package/LICENSE package/dist/index.js package/dist/index.d.ts; do
  grep -Fqx "$path" "$ENTRIES" || { echo "missing from tarball: $path"; exit 1; }
done

echo "- the tarball holds nothing else"
if grep -Ev '^package/(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist/.+)$' "$ENTRIES"; then
  echo "unexpected file in tarball"; exit 1
fi

echo "- a consumer installs, imports and typechecks it"
mkdir -p "$TMP/consumer" && cd "$TMP/consumer"
printf '{ "name": "nudge-pack-smoke", "private": true, "type": "module" }\n' > package.json
npm i --no-audit --no-fund --silent "$TGZ" typescript@6.0.3 @types/node@22.18.0
node --input-type=module -e "await import('@tilli.dev/nudge.js'); console.log('consumer import ok')"
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2023",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "files": ["consumer.ts"]
}
EOF
cat > consumer.ts <<'EOF'
import * as nudge from "@tilli.dev/nudge.js";

export const exported: readonly string[] = Object.keys(nudge);
EOF
npx --no-install tsc -p tsconfig.json
echo "pack-smoke: ok"
