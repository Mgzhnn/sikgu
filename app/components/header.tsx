export function Header({
  title,
  subtitle,
  onCreate,
}: {
  title: string;
  subtitle: string;
  onCreate: () => void;
}) {
  return (
    <header className="content-header">
      <div>
        <span className="eyebrow">{subtitle}</span>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <button className="primary-button compact" onClick={onCreate}><span>＋</span> 주문방 만들기</button>
      </div>
    </header>
  );
}
