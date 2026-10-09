#!/usr/bin/env bash
# Report as code: rerun the analysis, keep the presentation edits, export HTML and PDF, and
# publish to the hub. GitHub Actions and GitLab CI run this script on a schedule.
#
#   DATAWALK_HUB        https://hub.example.internal (empty: export only, no publish)
#   DATAWALK_HUB_TOKEN  API token of the publishing account (a CI secret)
#   REPORT_ID            the report on the hub (empty on the first run; then set it)
#   ANALYSIS             the analysis script (default: analysis.py); it takes --save PATH
#   WATERMARK            optional recipient watermark for the exports
set -euo pipefail
ARCHIVE="${ARCHIVE:-report.dwk}"

# 1. The latest revision has the presentation edits (names, rooms, tour, notes).
if [ -n "${REPORT_ID:-}" ] && [ -n "${DATAWALK_HUB:-}" ]; then
  datawalk pull "$REPORT_ID" -o "$ARCHIVE"
fi

# 2. Rerun the analysis. Report.save() merges: new data, and the edits stay.
python "${ANALYSIS:-analysis.py}" --save "$ARCHIVE"

# 3. Export. The review prints to the job log; the classification policy applies.
datawalk export "$ARCHIVE" --html report.html --pdf report.pdf --yes ${WATERMARK:+--watermark "$WATERMARK"}

# 4. Publish a new revision. The hub records what changed, with the KPI deltas.
if [ -n "${DATAWALK_HUB:-}" ]; then
  datawalk publish "$ARCHIVE"
else
  echo "DATAWALK_HUB is not set: the report is not published."
fi
