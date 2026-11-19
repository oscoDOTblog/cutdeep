export default function LinkStart() {
  return (
    <div className="linkstart" role="status">
      <div className="diamonds" aria-hidden="true">
        <span>◆</span>
        <span>◆</span>
        <span>◆</span>
      </div>
      <div className="words">Matching recording…</div>
      <div className="groove" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
