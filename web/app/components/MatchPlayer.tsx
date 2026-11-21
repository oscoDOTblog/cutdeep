"use client";

import { useId, useState } from "react";
import ListenOn from "./ListenOn";

type Props = {
  artist: string;
  title: string;
  sourceUrl: string;
  bandcampTrackId?: string;
};

function getEmbed(sourceUrl: string, bandcampTrackId?: string) {
  if (bandcampTrackId && /^\d+$/.test(bandcampTrackId)) {
    return {
      provider: "Bandcamp",
      src: `https://bandcamp.com/EmbeddedPlayer/track=${bandcampTrackId}/size=small/bgcol=ffffff/linkcol=a86a00/transparent=true/`,
      height: 42,
    };
  }

  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  const host = url.hostname;
  const [page, item] = url.pathname.split("/").filter(Boolean);
  const youtubeHosts = ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"];
  let videoId;
  if (host === "youtu.be") {
    videoId = page;
  } else if (youtubeHosts.includes(host)) {
    videoId = page === "watch" ? url.searchParams.get("v") :
      ["shorts", "live", "embed"].includes(page) ? item : undefined;
  }
  if (videoId && /^[\w-]{11}$/.test(videoId)) {
    return {
      provider: "YouTube",
      src: `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1`,
      height: 200,
    };
  }

  if (["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"].includes(host)) {
    url.protocol = "https:";
    if (host !== "on.soundcloud.com") url.hostname = "soundcloud.com";
    const params = new URLSearchParams({
      url: url.href,
      auto_play: "true",
      show_comments: "false",
      color: "#f5a800",
    });
    return { provider: "SoundCloud", src: `https://w.soundcloud.com/player/?${params}`, height: 166 };
  }
}

export default function MatchPlayer({ artist, title, sourceUrl, bandcampTrackId }: Props) {
  const playerId = useId();
  const [open, setOpen] = useState(false);
  const embed = getEmbed(sourceUrl, bandcampTrackId);
  const sourceLink = (
    <ListenOn artist={artist} title={title} sourceUrl={sourceUrl}
      className={embed ? "match-player-source" : "scan-result-source"} />
  );

  if (!embed) {
    return <div className="match-player">{sourceLink}</div>;
  }

  return (
    <div className="match-player">
      <div className="match-player-actions">
        <button
          className="scan-result-source"
          type="button"
          aria-expanded={open}
          aria-controls={playerId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide player" : (
            <><span aria-hidden="true">▶</span> {embed.provider === "Bandcamp" ? "Open player" : "Play track"}</>
          )}
        </button>
        {sourceLink}
      </div>
      <div id={playerId} hidden={!open}>
        {open && (
          <iframe
            src={embed.src}
            title={`${embed.provider} player for ${title}`}
            height={embed.height}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </div>
  );
}
