/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  History, 
  Target, 
  Activity, 
  Sparkles, 
  Clock, 
  Smartphone, 
  BookOpen, 
  Coffee,
  CheckCircle2,
  AlertCircle,
  Plus,
  Send,
  User,
  PieChart,
  Camera,
  CameraOff
} from 'lucide-react';

// --- Types ---
interface ActivityEntry {
  id: string;
  activity: string;
  timestamp: Date;
  durationMs?: number;
}

interface UserProfile {
  goal: string;
  description: string;
}

interface DailySummary {
  studyTime: number; // in milliseconds
  phoneTime: number;
  idleTime: number;
}

// --- Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  // --- State ---
  const [profile, setProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('habitMirror_profile');
    return saved ? JSON.parse(saved) : { goal: '', description: '' };
  });
  
  const [isSetup, setIsSetup] = useState(!profile.goal);
  const [currentActivity, setCurrentActivity] = useState('');
  const [history, setHistory] = useState<ActivityEntry[]>(() => {
    const saved = localStorage.getItem('habitMirror_history');
    if (!saved) return [];
    return JSON.parse(saved).map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
  });
  
  const [mirrorResponse, setMirrorResponse] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Camera States
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('habitMirror_profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem('habitMirror_history', JSON.stringify(history));
  }, [history]);

  // Camera Stream Management
  useEffect(() => {
    let stream: MediaStream | null = null;
    
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        setIsCameraOn(false);
      }
    };

    if (isCameraOn) {
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraOn]);

  // Periodic Analysis Effect
  useEffect(() => {
    let intervalId: any;

    if (isCameraOn) {
      intervalId = setInterval(() => {
        captureAndAnalyze();
      }, 20000); // Analyze every 20 seconds
    }

    return () => clearInterval(intervalId);
  }, [isCameraOn, profile.goal]);

  // --- Calculations ---
  const getDailySummary = (): DailySummary => {
    const today = new Date().toDateString();
    const todayHistory = history.filter(h => h.timestamp.toDateString() === today);
    
    let study = 0;
    let phone = 0;
    let idle = 0;

    todayHistory.forEach((entry, i) => {
      const nextEntry = todayHistory[i + 1] || { timestamp: new Date() };
      const duration = nextEntry.timestamp.getTime() - entry.timestamp.getTime();
      
      const act = entry.activity.toLowerCase();
      if (act.includes('study') || act.includes('work') || act.includes('read')) {
        study += duration;
      } else if (act.includes('phone') || act.includes('social') || act.includes('instagram') || act.includes('scrolling')) {
        phone += duration;
      } else {
        idle += duration;
      }
    });

    return { studyTime: study, phoneTime: phone, idleTime: idle };
  };

  const formatDuration = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
  };

  // --- Actions ---
  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing || !isCameraOn) return;

    // Check if video is ready and has dimensions
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
      console.warn("Video dimensions not ready for capture");
      return;
    }

    setIsAnalyzing(true);
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      // Use set dimensions to avoid empty canvas
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];

      if (!base64Image || base64Image.length < 100) {
        throw new Error("Captured image is empty or invalid");
      }

      const imagePart = {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      };

      const textPart = {
        text: `
          Look at this image of the user. 
          The user's goal is: "${profile.goal}". 
          Description: "${profile.description}".
          
          Based on the image, what is the user doing? 
          Does this activity align with their goal?
          
          Provide a 2-3 sentence reflection as the "Habit Mirror".
          Sound like a thoughtful friend.
          
          Also, precisely identify the activity in 1-3 words (e.g., "Studying", "Using Phone", "Resting").
          Return the response in this JSON format:
          {
            "activity": "IDENTIFIED_ACTIVITY",
            "reflection": "YOUR_REFLECTION"
          }
        `,
      };

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [imagePart, textPart] },
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(result.text || '{}');
      if (data.activity) {
        handleLogActivity(data.activity, data.reflection);
      }
    } catch (error) {
      console.error("Camera analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLogActivity = async (activityStr: string, customFeedback?: string) => {
    if (!activityStr.trim()) return;

    // Only log if it's different from the last activity or enough time has passed
    const lastActivity = history[0];
    const isNewActivity = !lastActivity || lastActivity.activity.toLowerCase() !== activityStr.toLowerCase();
    const timeSinceLastLog = lastActivity ? (new Date().getTime() - lastActivity.timestamp.getTime()) : Infinity;

    if (isNewActivity || timeSinceLastLog > 300000) { // 5 minutes break between identical logs
      const newEntry: ActivityEntry = {
        id: crypto.randomUUID(),
        activity: activityStr,
        timestamp: new Date(),
      };
      setHistory(prev => [newEntry, ...prev]);
    }

    if (customFeedback) {
      setMirrorResponse(customFeedback);
    } else {
      generateFeedback(activityStr);
    }
  };

  const generateFeedback = async (activity: string) => {
    if (!profile.goal) return;
    
    setIsGenerating(true);
    try {
      const summary = getDailySummary();
      const recentHistoryStr = history
        .slice(0, 5)
        .map(h => `${h.timestamp.toLocaleTimeString()}: ${h.activity}`)
        .join('\n');

      const prompt = `
        You are an AI Habit Mirror — a smart, behavior coach.
        
        USER PROFILE:
        Goal: ${profile.goal}
        Goal description: ${profile.description}
        
        LIVE INPUT:
        Current activity: ${activity}
        Current time: ${new Date().toLocaleTimeString()}
        
        Recent activity history (last hour):
        ${recentHistoryStr}
        
        DAILY SUMMARY:
        - Studying: ${formatDuration(summary.studyTime)}
        - Phone usage: ${formatDuration(summary.phoneTime)}
        - Idle time: ${formatDuration(summary.idleTime)}
        
        INSTRUCTIONS:
        1. Understand the user's CURRENT behavior.
        2. Compare behavior against their GOAL.
        3. Give a SHORT, natural, human-like response (2-3 sentences only).
        4. Always connect behavior to the USER'S GOAL.
        
        RESPONSE STRUCTURE:
        - A natural observation
        - A subtle connection to the goal
        - A gentle, actionable suggestion
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setMirrorResponse(result.text || 'I see what you are doing. How does this align with your goals?');
    } catch (error) {
      console.error("Mirror error:", error);
      setMirrorResponse("The mirror is a bit cloudy right now. Keep going, I'm watching!");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Render Helpers ---
  if (isSetup) {
    return (
      <div className="min-h-screen bg-[#0A0B10] flex items-center justify-center p-6 font-sans text-slate-200 overflow-hidden relative">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-900/30 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[140px]"></div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full glass-card p-10 relative z-10"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-indigo-500/20 text-indigo-400 p-2 rounded-xl border border-indigo-500/20">
              <Target size={24} />
            </div>
            <h1 className="text-2xl font-light text-white tracking-tight">Define Your Focus</h1>
          </div>
          
          <p className="text-slate-400 mb-8 text-sm leading-relaxed">
            The AI Habit Mirror reflects your actions back to you. To start, what is one habit or goal you want to improve?
          </p>

          <div className="space-y-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Main Goal</label>
              <input 
                type="text"
                placeholder="e.g. reduce phone usage"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-white placeholder:text-slate-600"
                value={profile.goal}
                onChange={e => setProfile(prev => ({ ...prev, goal: e.target.value }))}
              />
            </div>
            
            <div>
              <label className="block text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Why is this important?</label>
              <textarea 
                placeholder="Describe your motivation..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all h-24 resize-none text-white placeholder:text-slate-600"
                value={profile.description}
                onChange={e => setProfile(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <button 
              onClick={() => profile.goal && setIsSetup(false)}
              disabled={!profile.goal}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-medium hover:bg-indigo-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              Start Reflected Life
              <Sparkles size={18} />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const summary = getDailySummary();

  return (
    <div className="min-h-screen bg-[#0A0B10] font-sans text-slate-200 overflow-hidden relative">
      {/* Mesh Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-900/30 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[140px]"></div>
      <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] bg-amber-500/10 rounded-full blur-[100px]"></div>

      {/* Main Content */}
      <div className="max-w-[1200px] mx-auto p-6 flex flex-col min-h-screen relative z-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/30">
              <Sparkles size={20} className="text-indigo-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-white leading-none">HabitLens</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-indigo-400 font-bold mt-1">AI Habit Mirror</span>
            </div>
          </div>
          <button 
            onClick={() => setIsSetup(true)}
            className="text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-indigo-400 transition-colors"
          >
            Update Goal
          </button>
        </header>

        <div className="flex flex-1 gap-6 mb-8">
          {/* Sidebar */}
          <aside className="w-1/3 flex flex-col gap-6">
            {/* Camera View */}
            <div className="glass-card overflow-hidden relative group">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-48 object-cover bg-black/40 ${!isCameraOn ? 'hidden' : ''}`}
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {!isCameraOn ? (
                <div className="h-48 flex flex-col items-center justify-center gap-3 bg-black/40 text-slate-500">
                  <CameraOff size={32} />
                  <span className="text-[10px] uppercase font-bold tracking-widest">Mirror Offline</span>
                </div>
              ) : (
                <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 bg-black/60 rounded-full border border-white/10">
                  <div className={`w-1.5 h-1.5 rounded-full bg-red-500 ${isAnalyzing ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] uppercase font-bold tracking-widest text-white">Live</span>
                </div>
              )}

              <button 
                onClick={() => setIsCameraOn(!isCameraOn)}
                className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"
              >
                <div className="bg-white text-black p-3 rounded-full shadow-xl">
                  {isCameraOn ? <CameraOff size={20} /> : <Camera size={20} />}
                </div>
              </button>
            </div>

            {/* Goal Card */}
            <div className="glass-card p-6">
              <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold mb-2">Primary Goal</p>
              <h2 className="text-2xl font-light text-white leading-tight capitalize">{profile.goal || "Set a Goal"}</h2>
              <p className="text-sm text-slate-400 mt-2 line-clamp-2">{profile.description || "Living intentionally through reflection."}</p>
              
              <div className="mt-8 flex flex-col gap-4">
                <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} className="text-indigo-400" />
                    <span className="text-slate-400 text-sm">Studying</span>
                  </div>
                  <span className="text-white font-mono text-sm">{formatDuration(summary.studyTime)}</span>
                </div>
                <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-purple-400" />
                    <span className="text-slate-400 text-sm">Phone Usage</span>
                  </div>
                  <span className="text-white font-mono text-sm">{formatDuration(summary.phoneTime)}</span>
                </div>
              </div>
            </div>

            {/* Recent Pattern Card */}
            <div className="p-5 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-xl flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-2">
                <PieChart size={14} className="text-indigo-400" />
                <p className="text-xs text-indigo-300 font-semibold uppercase tracking-wider">Pattern Analysis</p>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed italic">
                {history.length > 0 
                  ? `You've logged ${history.length} activities today. The mirror is watching for consistency in your ${profile.goal} efforts.`
                  : "Start logging your activities to see behavior patterns reflect in the mirror."}
              </p>
            </div>
          </aside>

          {/* Main Panel */}
          <main className="flex-1 flex flex-col gap-6">
            <div className="flex-1 glass-card-heavy p-10 flex flex-col relative overflow-hidden">
              {/* Light Overlay */}
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-tr from-white/5 to-transparent pointer-events-none"></div>

              {/* Live Info Header */}
              <div className="flex justify-between items-start mb-12 relative z-10">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse"></div>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest font-mono">Live Reflection</span>
                  </div>
                  <h3 className="text-3xl font-light text-white">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    <span className="text-slate-600 mx-3 font-thin">•</span>
                    <span className="text-slate-400 text-xl">
                      {history[0]?.activity || "Awaiting Activity"}
                    </span>
                  </h3>
                </div>
                <div className="flex items-center gap-6">
                  <button 
                    onClick={() => captureAndAnalyze()}
                    disabled={!isCameraOn || isAnalyzing}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30"
                    title="Manual Mirror Reflection"
                  >
                    <Sparkles size={20} className={isAnalyzing ? 'animate-spin' : ''} />
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Mirror Mode</p>
                    <p className="text-sm text-indigo-400 font-medium">{isCameraOn ? 'Auto-Reflecting' : 'Manual Log'}</p>
                  </div>
                </div>
              </div>

              {/* AI Mirror Response */}
              <div className="flex-1 flex flex-col justify-center max-w-[600px] relative z-10">
                <AnimatePresence mode="wait">
                  {mirrorResponse ? (
                    <motion.div
                      key={mirrorResponse}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.02 }}
                    >
                      <h1 className="text-[32px] leading-tight font-light text-white italic mb-6">
                         "{mirrorResponse}"
                      </h1>
                    </motion.div>
                  ) : (
                    <div className="text-slate-500 italic text-2xl font-light">
                      Silence is the first step to reflection. Log what you're doing.
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Input Overlay */}
              <div className="mt-8 relative z-10">
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-[24px] blur opacity-20 group-focus-within:opacity-40 transition duration-1000"></div>
                  <div className="relative flex">
                    <input 
                      type="text"
                      value={currentActivity}
                      onChange={e => setCurrentActivity(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleLogActivity(currentActivity)}
                      placeholder="What are you doing now?"
                      className="flex-1 px-6 py-5 bg-[#0D0E15] border border-white/5 rounded-l-[24px] text-lg text-white placeholder:text-slate-600 focus:outline-none"
                    />
                    <button 
                      onClick={() => handleLogActivity(currentActivity)}
                      disabled={!currentActivity.trim() || isGenerating}
                      className="bg-indigo-600 text-white px-8 rounded-r-[24px] font-medium hover:bg-indigo-500 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isGenerating ? <Activity className="animate-spin" size={18} /> : <Send size={18} />}
                      Log
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  {['Studying 📚', 'Using phone 📱', 'Take a break ☕', 'Reading 📖', 'Working 💻'].map(preset => (
                    <button 
                      key={preset}
                      onClick={() => handleLogActivity(preset.replace(/[^a-zA-Z ]/g, "").trim())}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 text-slate-400 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>

        {/* Footer Navigation */}
        <footer className="mt-auto py-8">
          <nav className="flex justify-center gap-10 text-[11px] text-slate-500 font-bold tracking-[0.2em] uppercase">
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`${showHistory ? 'text-white' : 'hover:text-indigo-400'} transition-colors flex items-center gap-2`}
            >
              Reflection Log
            </button>
            <span className="cursor-pointer hover:text-indigo-400 transition-colors">HabitLens Map</span>
            <span className="cursor-pointer hover:text-indigo-400 transition-colors">Insights</span>
            <span className="cursor-pointer hover:text-indigo-400 transition-colors">Settings</span>
          </nav>

          <AnimatePresence>
            {showHistory && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-6 max-w-2xl mx-auto glass-card p-6"
              >
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Activity History</h4>
                  <History size={14} className="text-slate-600" />
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                  {history.length > 0 ? history.map((entry) => (
                    <div key={entry.id} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                      <span className="text-slate-300 text-sm font-light">{entry.activity}</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )) : (
                    <div className="text-center py-4 text-slate-600 text-xs italic">Clear as a mirror... No logs yet.</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </footer>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
