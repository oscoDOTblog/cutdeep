export default function LinkStart() {
  return (
    <div className="linkstart" role="status" aria-label="Linking to catalog">
      <div className="diamonds" aria-hidden="true">
        <span>◆</span>
        <span>◆</span>
        <span>◆</span>
      </div>
      <div className="words">Link start</div>
      <div className="groove" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
