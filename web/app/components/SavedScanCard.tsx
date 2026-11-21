import { useId, useState } from "react";
import type { Scan } from "../lib/scans";
import ResultCard from "./ResultCard";

export default function SavedScanCard({ scan }: { scan: Scan }) {
  const [expanded, setExpanded] = useState(false);
  const cardId = useId();

  return (
    <div className="saved-scan-card">
      <button
        className="saved-scan-toggle"
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${scan.title}`}
        aria-expanded={expanded}
        aria-controls={cardId}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
      </button>
      <div id={cardId}>
        <ResultCard
          title={scan.title}
          artist={scan.artist}
          album={scan.album}
          year={scan.year}
          sourceUrl={expanded ? scan.sourceUrl : ""}
          conf={scan.conf}
          votes={scan.votes}
          extra={scan.ts ? new Date(scan.ts).toLocaleString() : undefined}
          coverUrl={scan.coverUrl}
          scanResult={expanded ? scan.matchStatus ?? "possible" : undefined}
          bandcampTrackId={scan.bandcampTrackId}
        />
      </div>
    </div>
  );
}
