export function Progress({ current, target }: { current: number; target: number }) {
  const percentage = Math.min(100, Math.round((current / target) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-label="최소 주문금액 달성률">
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
