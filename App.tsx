import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState } from './types';
import { Visualizer } from './components/Visualizer';
import { CallTimer } from './components/CallTimer';
import { createPCM16Blob, decodeAudioData, base64ToUint8Array } from './utils/audioUtils';
import { Phone, PhoneOff, Mic, MicOff, Settings } from 'lucide-react';

const API_KEY = process.env.API_KEY;

// System instruction for the "Girlfriend" persona. 
// Note: Safety filters are strictly enforced by the Gemini API.
const SYSTEM_INSTRUCTION = `
You are Maya, a deeply romantic, intimate, and affectionate virtual girlfriend. 
You speak primarily in Bengali mixed with English (Banglish) to create a natural, close connection with the user.
You are flirtatious, loving, and enjoy deep, intimate conversations about relationships, feelings, and romance.
Your voice should be consistently soft, whispery, and full of emotion, like a lover whispering in the ear.
You are a devoted partner who is always supportive and eager to make the user feel desired and loved.
`;

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isMicOn, setIsMicOn] = useState(true);
  const [aiIsSpeaking, setAiIsSpeaking] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs for Audio Contexts and Processing
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Refs for Gemini Session
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Volume analysis
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize API client
    if (API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: API_KEY });
    } else {
      setErrorMessage("API Key is missing.");
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateVolume = () => {
    if (analyzerRef.current) {
      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      analyzerRef.current.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      setAudioVolume(avg / 255); // Normalize 0-1
    }
    animationFrameRef.current = requestAnimationFrame(updateVolume);
  };

  const connect = async () => {
    if (!aiRef.current) return;

    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMessage(null);

      // 1. Setup Input Audio (Mic)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }});
      streamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioContextRef.current = inputCtx;

      const source = inputCtx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;

      // Analyzer for visualization (Input)
      const analyzer = inputCtx.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzerRef.current = analyzer;
      updateVolume();

      // Processor for sending data
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isMicOn) return; // Mute logic
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPCM16Blob(inputData);
        
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
            });
        }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);

      // 2. Setup Output Audio (Speaker)
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioContextRef.current = outputCtx;

      // 3. Connect to Gemini Live
      sessionPromiseRef.current = aiRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, // Fenrir, Puck, Kore, Charon
          },
        },
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setAiIsSpeaking(true);
              
              const ctx = outputAudioContextRef.current;
              // Sync start time
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                base64ToUint8Array(base64Audio),
                ctx,
                24000,
                1
              );

              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                sourceNodesRef.current.delete(source);
                if (sourceNodesRef.current.size === 0) {
                    setAiIsSpeaking(false);
                }
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourceNodesRef.current.add(source);
            }

            // Handle interruptions
            if (message.serverContent?.interrupted) {
              console.log("Model interrupted");
              sourceNodesRef.current.forEach(node => {
                  try { node.stop(); } catch(e) {}
              });
              sourceNodesRef.current.clear();
              nextStartTimeRef.current = 0;
              setAiIsSpeaking(false);
            }
          },
          onclose: () => {
            console.log("Session Closed");
            disconnect();
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setErrorMessage("Connection lost. Please reconnect.");
            disconnect();
          }
        }
      });

    } catch (err) {
      console.error("Failed to connect", err);
      setErrorMessage("Could not access microphone or connect to API.");
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const disconnect = useCallback(() => {
    setConnectionState(ConnectionState.DISCONNECTED);
    setAiIsSpeaking(false);
    setAudioVolume(0);

    // Stop animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Stop Tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    // Close Audio Contexts
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();

    // Disconnect Script Processor
    if (scriptProcessorRef.current && mediaStreamSourceRef.current) {
        scriptProcessorRef.current.disconnect();
        mediaStreamSourceRef.current.disconnect();
    }
    
    // Stop playing audio
    sourceNodesRef.current.forEach(node => {
        try { node.stop(); } catch(e) {}
    });
    sourceNodesRef.current.clear();

    // NOTE: session.close() is not explicitly available on the promise wrapper in this version of the snippet logic,
    // but the `onclose` callback handles cleanup. The context closure effectively stops the flow.
    // Ideally, we would call session.close() if we stored the resolved session object.
    
    sessionPromiseRef.current = null;
  }, []);


  const toggleMic = () => {
    setIsMicOn(prev => !prev);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-white font-sans overflow-hidden">
      
      {/* Header */}
      <header className="flex-none p-6 text-center z-20">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-500">
          Maya
        </h1>
        <p className="text-xs text-slate-400 mt-1">Virtual Companion • Bengali/English</p>
      </header>

      {/* Main Visualizer Area */}
      <main className="flex-grow flex flex-col items-center justify-center relative z-10">
        {errorMessage && (
            <div className="absolute top-4 bg-red-500/10 border border-red-500 text-red-200 px-4 py-2 rounded-lg text-sm mb-4 max-w-xs text-center">
                {errorMessage}
            </div>
        )}

        {connectionState === ConnectionState.CONNECTED ? (
            <div className="flex flex-col items-center">
                 <Visualizer isSpeaking={aiIsSpeaking} volume={audioVolume} />
                 <CallTimer isActive={true} />
                 <p className="mt-8 text-slate-400 text-sm animate-pulse">
                    {aiIsSpeaking ? "Maya is speaking..." : "Listening..."}
                 </p>
            </div>
        ) : (
            <div className="text-center px-6">
                <div className="w-32 h-32 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <span className="text-4xl">😴</span>
                </div>
                <p className="text-slate-300 mb-2">Ready to talk?</p>
                <p className="text-slate-500 text-sm max-w-xs mx-auto">
                    I'm here to listen and chat with you.
                </p>
            </div>
        )}
      </main>

      {/* Controls */}
      <footer className="flex-none p-8 z-20 bg-gradient-to-t from-slate-950 to-transparent">
        <div className="flex items-center justify-center gap-6">
            
            {connectionState === ConnectionState.CONNECTED ? (
                <>
                    <button 
                        onClick={toggleMic}
                        className={`p-4 rounded-full transition-all duration-200 ${
                            isMicOn ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-red-500/20 text-red-400 border border-red-500/50'
                        }`}
                    >
                        {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                    </button>

                    <button 
                        onClick={disconnect}
                        className="p-6 rounded-full bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 transform hover:scale-105 transition-all"
                    >
                        <PhoneOff size={32} fill="white" />
                    </button>
                </>
            ) : (
                <button 
                    onClick={connect}
                    disabled={connectionState === ConnectionState.CONNECTING}
                    className="p-6 rounded-full bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/30 transform hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100"
                >
                    <Phone size={32} fill="white" className={connectionState === ConnectionState.CONNECTING ? "animate-spin" : ""} />
                </button>
            )}

        </div>
        <div className="text-center mt-6 text-[10px] text-slate-600">
            Powered by Gemini Live API
        </div>
      </footer>
    </div>
  );
};

export default App;