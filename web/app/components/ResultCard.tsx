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
  /** Replaces the default "N% · M landmark votes" line (e.g. for ingests). */
  stats?: string;
};

export default function ResultCard({ title, artist, sourceUrl, conf, votes, year, album, extra, coverUrl, stats }: Props) {
  const pct = Math.round(conf * 100);
  const band = conf >= 0.75 ? "high" : conf >= 0.4 ? "mid" : "low";
  return (
    <div className="card row">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="tile-img" />
      ) : (
        <div className="tile" aria-hidden="true">
          ◆
        </div>
      )}
      <div className="rowbody">
        <div className="t">
          <span className="dia">◆</span> {title}
        </div>
        {artist && <div className="a">{artist}</div>}
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
      </div>
    </div>
  );
}
