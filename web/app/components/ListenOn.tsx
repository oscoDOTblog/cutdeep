type Props = {
  artist: string;
  title: string;
  sourceUrl: string;
  className?: string;
};

const searchHosts = new Set([
  "music.amazon.com",
  "music.apple.com",
  "itunes.apple.com",
  "open.spotify.com",
  "spotify.link",
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
]);

export default function ListenOn({ artist, title, sourceUrl, className = "scan-result-source" }: Props) {
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (source.protocol !== "https:" && source.protocol !== "http:") return null;

  const parts = [artist.trim(), title.trim()].filter(Boolean);
  if (!searchHosts.has(source.hostname) || !parts.length) {
    return (
      <a className={className} href={sourceUrl} target="_blank" rel="noreferrer">
        Open track <span aria-hidden="true">↗</span>
      </a>
    );
  }

  const query = parts.join(" ");
  const encodedQuery = encodeURIComponent(query);
  const platforms = [
    { name: "Amazon Music", url: `https://music.amazon.com/search/${encodeURIComponent(parts.join(" - "))}` },
    { name: "Apple Music", url: `https://music.apple.com/us/search?term=${encodedQuery}` },
    { name: "Spotify", url: `https://open.spotify.com/search/${encodedQuery}` },
    { name: "YouTube Music", url: `https://music.youtube.com/search?${new URLSearchParams({ q: query })}` },
  ];

  return (
    <details className="listen-on">
      <summary className={className}>
        Open track <span className="listen-on-chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="listen-on-panel">
        <p>Listen On:</p>
        <ul>
          {platforms.map(({ name, url }) => (
            <li key={name}>
              <a href={url} target="_blank" rel="noreferrer">
                {name} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
