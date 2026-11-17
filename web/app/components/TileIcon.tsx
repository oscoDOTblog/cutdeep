type Props = { name: "link" | "files" };

// Original angular glyphs approximating the SAO sheet: the door-arrow
// (portal/enter) for link fetch, the inventory bag for file upload.
export default function TileIcon({ name }: Props) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {name === "link" ? (
        <>
          <path d="M6 21V6l3-3h6l3 3v15Z" />
          <path d="M9 12h6" />
          <path d="M13 9l3 3-3 3" />
        </>
      ) : (
        <>
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
          <path d="M5 8h14l-1 12H6L5 8Z" />
          <path d="M5 8l7 4.5L19 8" />
        </>
      )}
    </svg>
  );
}
