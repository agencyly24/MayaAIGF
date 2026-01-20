import React, { useState, useEffect } from 'react';

interface CallTimerProps {
  isActive: boolean;
}

export const CallTimer: React.FC<CallTimerProps> = ({ isActive }) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let interval: number;
    if (isActive) {
      interval = window.setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    } else {
      setSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isActive]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isActive) return null;

  return (
    <div className="text-slate-400 text-sm font-mono mt-2 bg-slate-800/50 px-3 py-1 rounded-full">
      {formatTime(seconds)}
    </div>
  );
};