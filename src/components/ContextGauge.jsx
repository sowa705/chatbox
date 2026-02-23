function ContextGauge({ usedTokens, totalTokens }) {
  const percentage = totalTokens > 0 ? Math.min((usedTokens / totalTokens) * 100, 100) : 0
  const radius = 54
  const strokeWidth = 10
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  // Color based on usage
  let strokeColor = '#3b82f6' // blue
  if (percentage > 75) strokeColor = '#f59e0b' // amber
  if (percentage > 90) strokeColor = '#ef4444' // red

  const formatTokens = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toString()
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* SVG Gauge */}
      <div className="relative w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          {/* Background circle */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            className="stroke-gray-200 dark:stroke-gray-700"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-gray-800 dark:text-gray-200">
            {percentage.toFixed(0)}%
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">CONTEXT</span>
        </div>
      </div>

      {/* Token details */}
      <div className="text-center space-y-1 w-full">
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-2">
          <span>Used</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{formatTokens(usedTokens)}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-2">
          <span>Total</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">{totalTokens > 0 ? formatTokens(totalTokens) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

export default ContextGauge
