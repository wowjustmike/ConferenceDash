export function Skeleton() {
  return (
    <div data-testid="skeleton" className="skeleton" aria-busy="true" aria-label="Loading conferences">
      <div className="sk sk-title" />
      <div className="sk sk-sub" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="sk-row">
          <div className="sk sk-a" /><div className="sk sk-b" /><div className="sk sk-b" /><div className="sk sk-c" />
        </div>
      ))}
    </div>
  )
}
