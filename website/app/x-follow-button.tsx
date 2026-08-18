export function XFollowButton({ className = "" }: { className?: string }) {
  return (
    <div className={`x-follow-widget ${className}`.trim()}>
      <a
        className="twitter-follow-button"
        href="https://x.com/zachtratar"
        data-analytics-id="follow_zachtratar_x"
        aria-label="Follow Zach Tratar on X"
      >
        Follow @zachtratar
      </a>
    </div>
  );
}
