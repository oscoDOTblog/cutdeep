type Props = {
  title: string;
  artist: string;
  sourceUrl: string;
  conf: number;
  votes: number;
  extra?: string;
  coverUrl?: string;
};

export default function ResultCard({ title, artist, sourceUrl, conf, votes, extra, coverUrl }: Props) {
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
        <div className={`hp ${band}`} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="meta">
          {pct}% · {votes} landmark votes
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
