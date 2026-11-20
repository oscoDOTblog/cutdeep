import type { MatchStatus } from "../lib/scans";
import MatchPlayer from "./MatchPlayer";

type Props = {
  title: string;
  artist: string;
  sourceUrl: string;
  conf: number;
  votes: number;
  year?: string;
  album?: string;
  extra?: string;
  coverUrl?: string;
  scanResult?: MatchStatus | "alternative";
  previewUrl?: string;
  bandcampTrackId?: string;
  /** Replaces the default "N% · M landmark votes" line (e.g. for ingests). */
  stats?: string;
};

export default function ResultCard({
  title, artist, sourceUrl, conf, votes, year, album, extra, coverUrl, stats,
  scanResult, previewUrl, bandcampTrackId,
}: Props) {
  const pct = Math.round(conf * 100);
  const band = conf >= 0.75 ? "high" : conf >= 0.4 ? "mid" : "low";
  return (
    <div className={scanResult ? "card row scan-result" : "card row"}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="tile-img" />
      ) : (
        <div className="tile" aria-hidden="true">
          ◆
        </div>
      )}
      <div className="rowbody">
        {scanResult && scanResult !== "alternative" && (
          <h2 className={scanResult === "likely" ? "scan-result-status likely" : "scan-result-status"}>
            {scanResult === "likely" ? "Likely match" : "Possible match"}
          </h2>
        )}
        <div className="t">
          <span className="dia">◆</span> {title}
        </div>
        {artist && <div className="a">{artist}</div>}
        {scanResult ? (
          <>
            {(album || year) && <div className="a">{[album, year].filter(Boolean).join(" · ")}</div>}
            {sourceUrl && scanResult !== "likely" && (
              <a className="scan-result-source" href={sourceUrl} target="_blank" rel="noreferrer">
                Open track <span aria-hidden="true">↗</span>
              </a>
            )}
          </>
        ) : (
          <>
            {album && <div className="a">{album}</div>}
            {!stats && (
              <div className={`hp ${band}`} aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="meta">
              {stats ?? <>{pct}% · {votes} landmark votes</>}
              {year && <> · {year}</>}
              {extra && <> · {extra}</>}
              {sourceUrl && (
                <>
                  {" · "}
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {scanResult === "likely" && (
        <MatchPlayer title={title} sourceUrl={sourceUrl} previewUrl={previewUrl} bandcampTrackId={bandcampTrackId} />
      )}
      {scanResult && (
        <details className="scan-result-details">
          <summary>Match details</summary>
          <p>{votes} aligned landmarks · {pct}% landmark overlap</p>
        </details>
      )}
    </div>
  );
}
