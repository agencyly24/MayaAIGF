import React from 'react';
import { AudioVisualizerProps } from '../types';

export const Visualizer: React.FC<AudioVisualizerProps> = ({ isSpeaking, volume }) => {
  // Normalize volume for visualization (0 to 1)
  const normalizedVolume = Math.min(Math.max(volume * 5, 0), 1);
  const scale = 1 + normalizedVolume * 0.5;

  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Outer pulsing rings - active when speaking or high volume */}
      {(isSpeaking || normalizedVolume > 0.1) && (
        <>
          <div 
            className="absolute border-2 border-rose-500 rounded-full w-full h-full opacity-0 animate-pulse-ring"
            style={{ animationDelay: '0s' }}
          />
          <div 
            className="absolute border-2 border-fuchsia-600 rounded-full w-full h-full opacity-0 animate-pulse-ring"
            style={{ animationDelay: '1s' }}
          />
        </>
      )}

      {/* Core Circle */}
      <div 
        className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-100 ease-out shadow-[0_0_30px_rgba(225,29,72,0.5)]`}
        style={{
            transform: `scale(${scale})`,
            background: isSpeaking 
              ? 'linear-gradient(135deg, #e11d48 0%, #c026d3 100%)' // Rose to Fuchsia when AI speaks
              : 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)'  // Blue to Cyan when listening
        }}
      >
        <div className="text-white text-4xl">
          {isSpeaking ? '💋' : '🎙️'}
        </div>
      </div>
    </div>
  );
};