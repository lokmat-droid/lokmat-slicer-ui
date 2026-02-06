import { useNavigate } from 'react-router-dom';
import React, { useEffect, useState, useRef } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
// ✅ PLACE THIS HERE (Outside the component)
const API_URL = (import.meta.env.VITE_API_URL || "https://lokmat-slicer-453213181309.us-central1.run.app").replace(/\/$/, "");
const API_BASE_URL = API_URL;
// ✅ HELPER PLACEMENT: Keep this OUTSIDE the component so it's only created once
const calculateLipVariance = (landmarks) => {
  if (!landmarks) return 0;
  // Index 13 = Center of Upper Lip, Index 14 = Center of Lower Lip
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];

  // Calculate the vertical distance between the lips
  const dist = Math.abs(upperLip.y - lowerLip.y);
  return dist;
};

// ✅ SINGLE DECLARATION: Pick one (function or const) and stick to it
function HomePage({ clips, setClips, status, setStatus, socket }) {
  const navigate = useNavigate();

  // 💾 STATE REMOVED: 'clips' and 'status' are now passed as props from App.jsx
  // This ensures we don't have two conflicting sources of truth.

  const [selectedClips, setSelectedClips] = useState([]);
  const [previewClip, setPreviewClip] = useState(null);
  const landmarkerRef = useRef(null);

  const fileInputRef = useRef(null);
  const [manualStart, setManualStart] = useState("00:00:00");
  const [manualEnd, setManualEnd] = useState("00:00:55");
  const [focusX, setFocusX] = useState(0.5);

  const [isShortsMode, setIsShortsMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);

  // ✅ HARD FIX: Prevent accidental unload while processing
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (status && status.isProcessing) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status && status.isProcessing]);

  // --- MEDIAPIPE INITIALIZATION ---
  useEffect(() => {
    const initAI = async () => {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        landmarkerRef.current = await FaceDetector.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "CPU", // CHANGED: CPU for stability as requested
          },
          runningMode: "VIDEO"
        });
        console.log("MediaPipe Scout Ready");
      } catch (e) {
        console.error("AI Init Error:", e);
      }
    };
    initAI();
  }, []);

  const scoutVideo = async (suggestion) => {
    if (!landmarkerRef.current) {
      console.error("Scout aborted: MediaPipe Landmarker not initialized.");
      return;
    }

    // ✅ FIX 1: ID Destructuring preserved
    const id = suggestion.id;
    const start = suggestion.start;
    const end = suggestion.end;
    const rawFile = suggestion.rawFile;
    const title = suggestion.title;
    const aiDescription = suggestion.aiDescription;
    const aiKeywords = suggestion.aiKeywords;
    const fileId = suggestion.fileId;

    const tempVideo = document.createElement("video");
    // ✅ FIX 2: Attributes cleaned & consolidated
    tempVideo.style.display = "none";
    tempVideo.crossOrigin = "anonymous";
    tempVideo.src = rawFile;
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = "auto";

    const toSeconds = (str) => {
      if (!str || typeof str !== 'string') return 0;
      const parts = str.split(':');
      if (parts.length === 3) return (Number(parts[0]) * 3600) + (Number(parts[1]) * 60) + Number(parts[2]);
      if (parts.length === 2) return (Number(parts[0]) * 60) + Number(parts[1]);
      return parseFloat(str) || 0;
    };

    const startSec = toSeconds(start);
    const endSec = toSeconds(end);
    let xCoords = [];

    // --- OPTIMIZED SCOUTING: DOWNSCALE & CPU FRIENDLY ---
    const processFrame = async () => {
      return new Promise((resolve) => {
        let isTimedOut = false;

        const frameTimeout = setTimeout(() => {
          isTimedOut = true;
          console.warn("Frame Timeout (500ms): Skipping " + tempVideo.currentTime.toFixed(2) + "s");
          resolve();
        }, 500);

        setTimeout(async () => {
          if (isTimedOut) return;

          try {
            if (!landmarkerRef.current) {
              clearTimeout(frameTimeout);
              return resolve();
            }

            // ✅ FIX: Use VIDEO TIMESTAMP, NOT Date.now()
            const results = landmarkerRef.current.detectForVideo(tempVideo, tempVideo.currentTime * 1000);
            clearTimeout(frameTimeout);

            if (results.detections && results.detections.length > 0) {
              const bestFace = results.detections[0].boundingBox;
              const midX = bestFace.originX + (bestFace.width / 2);
              const w = tempVideo.videoWidth;

              let finalX = midX / w;
              if (finalX < 0) finalX = 0;
              if (finalX > 1) finalX = 1;

              xCoords.push({
                x: finalX,
                timestamp: tempVideo.currentTime,
                faceArea: bestFace ? bestFace.area : 0,
                qualityScore: (bestFace ? bestFace.area * 100 : 0) + (results.detections.length * 5)
              });

              console.log("Tracked: X=" + finalX.toFixed(2) + " | Faces=" + results.detections.length);
            } else {
              xCoords.push({ x: 0.5, timestamp: tempVideo.currentTime, qualityScore: 0, faceArea: 0 });
            }
          } catch (err) {
            console.error("Scout Error:", err);
          }

          resolve();
        }, 150);
      });
    };

    tempVideo.onloadedmetadata = async () => {
      console.log("Scouting: " + (title || "") + " (" + startSec + "s to " + endSec + "s)");
      let checkTime = startSec;

      while (checkTime < endSec) {
        tempVideo.currentTime = checkTime;
        await new Promise(r => tempVideo.onseeked = r);
        await processFrame();
        checkTime += 30.0;
      }

      let finalAnchorX = 0.5;
      let heroTimestamp = startSec;

      if (xCoords.length > 0) {
        const validSamples = xCoords.filter(p => p.faceArea > 0 && p.qualityScore > 0);
        if (validSamples.length > 0) {
          const qualitySorted = validSamples.slice().sort((a, b) => b.qualityScore - a.qualityScore);
          const topTierSamples = qualitySorted.slice(0, Math.min(15, qualitySorted.length));
          const sortedX = topTierSamples.map(p => p.x).sort((a, b) => a - b);
          finalAnchorX = sortedX[Math.floor(sortedX.length / 2)];
          heroTimestamp = qualitySorted[0].timestamp;

          console.log("AI DIRECTOR: Arrested speaker at X:" + finalAnchorX.toFixed(2));
        }
      }

      if (typeof socket !== 'undefined' && socket) {
        socket.emit('scout-result', {
          id: id,
          anchorX: finalAnchorX,
          heroTimestamp: heroTimestamp
        });
        console.log("Socket Emitted: scout-result for segment " + id);
      }

      if (tempVideo.parentNode) document.body.removeChild(tempVideo);
      tempVideo.remove();
    };

    tempVideo.onerror = (err) => {
      console.error("Video loading error:", err);
      if (tempVideo.parentNode) document.body.removeChild(tempVideo);
      tempVideo.remove();
    };

    document.body.appendChild(tempVideo);
  };

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    if (typeof socket === 'undefined' || !socket) return;

    // ✅ HARD FIX: NO reload here
    const onHardReset = () => {
      console.log("SERVER RESET: Clearing persistent memory (NO RELOAD).");
      localStorage.clear();
      setClips([]);
      setSelectedClips([]);
      setPreviewClip(null);
      setStatus({ isProcessing: false, progress: 0, logs: ["Server reset received. State cleared (no reload)."] });
    };

    const handleStatus = (data) => {
      if (data && data.shortSuggestion) {
        const sid = (data.shortSuggestion.id || 0);
        const staggerDelay = sid * 2000;

        setTimeout(() => {
          console.log("Staggered start for Scout " + sid);
          scoutVideo(data.shortSuggestion);
        }, staggerDelay);
      }

      if (data && data.newClip) {
        setClips((prev) => {
          const exists = prev.find((c) => c.localUrl === data.newClip.localUrl);
          if (exists) return prev.map(c => c.localUrl === data.newClip.localUrl ? data.newClip : c);
          return [data.newClip].concat(prev);
        });
      }

      if (data && (data.progress !== undefined || data.log)) {
        setStatus((prev) => {
          const nextProgress = (data.progress !== undefined ? data.progress : prev.progress);
          return {
            ...prev,
            progress: nextProgress,
            isProcessing: (nextProgress > 0 && nextProgress < 100),
            logs: data.log ? ([]).concat(prev.logs || [], [data.log]).slice(-5) : (prev.logs || [])
          };
        });
      }
    };

    const handleUpload = (data) => {
      setStatus((prev) => {
        const nextProgress = (data && data.percent !== undefined ? data.percent : prev.progress);
        return {
          ...prev,
          progress: nextProgress,
          isProcessing: (nextProgress > 0 && nextProgress < 100),
          logs: (data && data.status) ? ([]).concat(prev.logs || [], ["UPLOAD: " + data.status]).slice(-5) : (prev.logs || [])
        };
      });
    };

    socket.on('SESSION_HARD_RESET', onHardReset);
    socket.on("statusUpdate", handleStatus);
    socket.on("upload-progress", handleUpload);

    return () => {
      socket.off('SESSION_HARD_RESET', onHardReset);
      socket.off("statusUpdate", handleStatus);
      socket.off("upload-progress", handleUpload);
    };
  }, [socket]);

  // --- YOUR EXISTING LOGIC BELOW (DO NOT DELETE) ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, previewClip]);

  const togglePlayback = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    if (next) {
      if (videoRef.current) videoRef.current.play();
      if (bgVideoRef.current) bgVideoRef.current.play();
    } else {
      if (videoRef.current) videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      if (bgVideoRef.current && videoRef.current) {
        bgVideoRef.current.currentTime = videoRef.current.currentTime;
      }
    }
  };

  // Helper for professional timestamp display
  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "00:00:00.00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return [h, m, s].map(v => v < 10 ? "0" + v : String(v)).join(":") + "." + (ms < 10 ? "0" + ms : String(ms));
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = time;
    if (bgVideoRef.current) bgVideoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (event) => {
    if (event && event.preventDefault) event.preventDefault();
    
    const file = event?.target?.files?.[0];
    if (!file) return;

    setClips([]);
    localStorage.removeItem('processedClips');

    setStatus({
      isProcessing: true,
      progress: 5,
      logs: ["Initiating secure Cloud Handshake...", "Requesting GCS Upload Permit..."]
    });

    try {
      // 1. GET THE PERMIT (Signed URL) - Using native fetch
      const signRes = await fetch(`${API_BASE_URL}/api/sign-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type })
      });
      const signData = await signRes.json();
      const { uploadUrl, gcsPath, fileName } = signData;

      // 2. DIRECT UPLOAD (Bypass 32MB limit) - Using native fetch
      setStatus(prev => ({ ...prev, logs: [...prev.logs, "Permit received. Uploading directly to GCS..."] }));
      
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'video/mp4' },
        body: file // Sending the raw file blob
      });

      // 3. TRIGGER ENGINE (Ingest) - Using native fetch
      setStatus(prev => ({ 
        ...prev, 
        progress: 18, 
        logs: [...prev.logs, "✅ GCS Upload Complete.", "🚀 Initializing AI Scout..."] 
      }));
      
      await fetch(`${API_BASE_URL}/api/ingest-from-gcs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gcsPath, fileName, socketId: socket.id })
      });

    } catch (error) {
      console.error("❌ Big File Upload Failed:", error);
      setStatus(prev => ({
        ...prev,
        isProcessing: false,
        logs: [...prev.logs, "❌ ERROR: " + error.message]
      }));
    } finally {
      try { event.target.value = ""; } catch (e) {}
    }
  };

  const handleManualSlice = async () => {
    if (!previewClip) return alert("Select a source video first!");

    setStatus({ isProcessing: true, progress: 10, logs: ["Manual Slicing Initiated..."] });

    try {
  const response = await fetch(API_URL + "/api/manual-slice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // ✅ Mandatory for Session Affinity to work with CORS
    credentials: "include", 
    body: JSON.stringify({
      source: previewClip.localUrl,
      start: manualStart,
      end: manualEnd,
      xOffset: focusX,
      title: "Manual Director's Cut",
    })
  });

  const data = await response.json();
  if (data && data.success) {
    setStatus((prev) => ({
      ...prev,
      logs: ([]).concat(prev.logs || [], ["Slice Sent to Engine"]).slice(-5)
    }));
  }
} catch (err) {
  setStatus({ isProcessing: false, progress: 0, logs: ["Manual Slice Failed"] });
}
  };

  const toggleSelect = (url) => {
    setSelectedClips(prev => prev.includes(url) ? prev.filter(u => u !== url) : prev.concat([url]));
  };

  const handleBulkAction = async (platform) => {
    if (selectedClips.length === 0) return alert("Please select clips first!");
    alert("Initiating bulk upload to " + platform + " for " + selectedClips.length + " clips...");
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-8 font-sans">
      {/* HEADER & BULK CONTROLS */}
      <header className="flex justify-between items-center mb-12 border-b border-slate-800/40 pb-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute -inset-1.5 bg-blue-500/10 rounded-[2rem] blur-xl group-hover:bg-blue-500/20 transition-all duration-700"></div>
              <div className="relative bg-slate-900/60 backdrop-blur-md border border-white/10 w-[180px] h-[85px] rounded-2xl flex items-center justify-center shadow-2xl">
                <img
                  src="https://raw.githubusercontent.com/lokmatonline-source/lokmatlogo/main/lokmatlogo.png"
                  alt="Lokmat"
                  className="h-[137px] w-auto max-w-none object-contain brightness-125 contrast-125 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-transform duration-500 group-hover:scale-110"
                />
              </div>
            </div>

            <h1 className="text-5xl font-black tracking-tighter -ml-[6px] bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              STUDIO
            </h1>
          </div>

          <div className="flex items-center gap-4 mt-6 ml-2 opacity-60">
            <div className="h-[1.5px] w-10 bg-blue-500/50 rounded-full"></div>
            <p className="text-white text-[12px] uppercase tracking-[0.55em] font-bold">
              AI Video Intelligence
            </p>
          </div>
        </div>

        <div className="flex gap-3 bg-slate-900/40 backdrop-blur-xl p-2 rounded-[2rem] border border-slate-800 shadow-2xl">
          <button onClick={() => handleBulkAction('YouTube')} className="bg-red-600 hover:bg-red-500 px-7 py-3 rounded-[1.5rem] font-bold text-sm transition-all active:scale-95 shadow-lg shadow-red-900/20 flex items-center gap-2">
            <span className="bg-white/20 p-1 rounded-full text-[8px]">▶</span> YouTube
          </button>
          <button onClick={() => handleBulkAction('Facebook')} className="bg-blue-600 hover:bg-blue-500 px-7 py-3 rounded-[1.5rem] font-bold text-sm transition-all active:scale-95 shadow-lg shadow-blue-900/20 flex items-center gap-2">
            <span className="bg-white/20 p-1.5 rounded-full text-[8px]">f</span> Facebook
          </button>
          <button className="bg-slate-800 hover:bg-slate-700 px-7 py-3 rounded-[1.5rem] font-bold text-sm transition-all border border-slate-700">
            Export Zip
          </button>
        </div>
      </header>

      {/* TOP SECTION: PREVIEW & ENGINE STATUS */}
      <div className="grid grid-cols-12 gap-8 mb-16">
        {/* LEFT: DRAGGABLE VIEWPORT */}
        <div className="col-span-8 flex flex-col gap-4">
          <div
            className={"bg-black rounded-[2rem] overflow-hidden shadow-2xl border border-slate-800 relative flex items-center justify-center select-none group transition-all duration-500 ease-in-out " + (isShortsMode ? "h-[600px] w-[337.5px] mx-auto" : "w-full aspect-video h-auto cursor-pointer")}
            onClick={(e) => {
              if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') togglePlayback();
            }}
          >
            {previewClip ? (
              <>
                <div className={"relative h-full transition-all duration-500 " + (isShortsMode ? "aspect-[9/16] bg-slate-900 shadow-[0_0_100px_rgba(0,0,0,1)] z-10 overflow-hidden border-x border-blue-500/50" : "w-full h-full")}>
                  <video
                    ref={videoRef}
                    key={"lens-" + previewClip.localUrl + "-" + (isShortsMode ? "shorts" : "vod")}
                    autoPlay
                    loop
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={(e) => setDuration(e.target.duration)}
                    className={"transition-all duration-75 " + (isShortsMode ? "absolute h-full max-w-none cursor-move" : "w-full h-full object-contain shadow-2xl")}
                    style={isShortsMode ? {
                      left: '50%',
                      transform: "translateX(-50%) translateX(" + ((0.5 - focusX) * 100) + "%)",
                      height: '100%',
                      width: 'auto'
                    } : {}}
                    onMouseDown={(e) => {
                      if (!isShortsMode) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const startX = e.pageX;
                      const startFocus = focusX;
                      const onMouseMove = (moveEvent) => {
                        const deltaX = moveEvent.pageX - startX;
                        let newFocus = startFocus - (deltaX / 600);
                        newFocus = Math.max(0, Math.min(1, newFocus));
                        setFocusX(newFocus);
                      };
                      const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                      };
                      document.addEventListener('mousemove', onMouseMove);
                      document.addEventListener('mouseup', onMouseUp);
                    }}
                  >
                    <source src={previewClip.localUrl} type="video/mp4" />
                  </video>

                  {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none z-20">
                      <span className="text-7xl opacity-50 text-white drop-shadow-2xl">⏸</span>
                    </div>
                  )}
                </div>

                {!isShortsMode && (
                  <video
                    ref={bgVideoRef}
                    key={"bg-" + previewClip.localUrl}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover opacity-20 blur-3xl pointer-events-none"
                  >
                    <source src={previewClip.localUrl} type="video/mp4" />
                  </video>
                )}

                {isShortsMode && (
                  <div className="absolute top-4 left-4 bg-black/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/20 font-mono text-xs text-blue-400 z-30 flex items-center gap-2">
                    <span className={"w-2 h-2 rounded-full bg-red-500 " + (isPlaying ? "animate-pulse" : "")}></span>
                    {formatTime(currentTime)}
                  </div>
                )}

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-[10px] font-bold uppercase tracking-widest text-blue-400 whitespace-nowrap">
                  {isShortsMode ? "Drag Lens to Frame • Space to Pause" : "Cinematic 16:9 Mode"}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 italic">
                <span className="text-5xl mb-4">🎬</span> Select a clip to start Director's Mode
              </div>
            )}
          </div>

          {/* PROFESSIONAL SCRUBBER BAR with Player Timestamps */}
          {previewClip && (
            <div className="px-6 -mt-2 flex items-center gap-4">
              <span className="text-[11px] font-mono text-blue-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                {formatTime(currentTime)}
              </span>
              <input
                type="range" min="0" max={duration} step="0.01"
                value={currentTime} onChange={handleSeek}
                className="flex-grow h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
              />
              <span className="text-[11px] font-mono text-slate-500">
                {formatTime(duration)}
              </span>
            </div>
          )}

          {/* DIRECTOR'S CUT CONTROL PANEL */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-[2rem] p-6 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); togglePlayback(); }}
                className={"w-14 h-14 rounded-full flex items-center justify-center border transition-all text-xl shadow-inner active:scale-90 " + (isPlaying ? "bg-slate-800 border-slate-600" : "bg-blue-600 border-blue-400")}
              >
                {isPlaying ? "⏸" : "▶️"}
              </button>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Viewport</label>
                <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setIsShortsMode(false)}
                    className={"px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all " + (!isShortsMode ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white")}
                  >
                    16:9
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsShortsMode(true)}
                    className={"px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all " + (isShortsMode ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white")}
                  >
                    9:16
                  </button>
                </div>
              </div>

              <div className="h-10 w-px bg-slate-800"></div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Start / End</label>
                <div className="flex items-center gap-2">
                  <input value={manualStart} onChange={e => setManualStart(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm w-24 text-blue-400 font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="00:00:00" />
                  <input value={manualEnd} onChange={e => setManualEnd(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm w-24 text-blue-400 font-mono focus:ring-1 focus:ring-blue-500 outline-none" placeholder="00:00:55" />
                </div>
              </div>

              <div className="h-10 w-px bg-slate-800"></div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Subject Focus</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-blue-400 tracking-tighter">{(focusX * 100).toFixed(1)}%</span>
                  <button type="button" onClick={() => setFocusX(0.5)} className="text-[9px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded border border-slate-700 text-slate-400">RESET</button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleManualSlice}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-10 py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-500/20"
            >
              ✂️ SLICE & FOCUS
            </button>
          </div>
        </div>

        {/* RIGHT: ENGINE STATUS & UPLOAD */}
        <div className="col-span-4 flex flex-col gap-6">
          <div
            onClick={handleUploadClick}
            className="bg-gradient-to-br from-blue-600/20 to-slate-900 border-2 border-dashed border-blue-500/30 rounded-[2rem] p-10 flex flex-col items-center justify-center text-center hover:border-blue-500 transition-all cursor-pointer group"
          >
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="video/mp4" />
            <span className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-300">📤</span>
            <h3 className="font-bold text-lg">Upload Master</h3>
            <p className="text-slate-400 text-sm mt-2">Click to browse your Mac</p>
          </div>

          <div className="bg-slate-900/50 rounded-[2rem] p-8 border border-slate-800 flex-grow shadow-inner">
            <h3 className="text-[10px] font-black text-slate-500 uppercase mb-6 tracking-[0.2em]">Live Engine Status</h3>
            <div className="flex justify-between text-sm mb-3 font-mono">
              <span className={(status && status.isProcessing) ? "text-green-400 animate-pulse" : "text-slate-400"}>
                {(status && status.isProcessing) ? "● PROCESSING" : "○ IDLE"}
              </span>
              <span className="text-blue-400">{(status && status.progress) ? status.progress : 0}%</span>
            </div>
            <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-700" style={{ width: ((status && status.progress) ? status.progress : 0) + "%" }}></div>
            </div>
            <div className="mt-6 space-y-2">
              {(status && status.logs ? status.logs : []).map((log, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-500 border-l border-slate-700 pl-3 py-1">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* VOD SECTION */}
      <section className="mb-16">
        <div className="flex items-center gap-4 mb-8">
          <h2 className="text-2xl font-black tracking-tight uppercase">VOD DEEP DIVES</h2>
          <div className="h-px flex-grow bg-slate-800"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {clips.filter(c => c.type === 'VOD' || c.localUrl.includes('VOD')).map((clip) => (
            <VideoCard
              key={clip.localUrl}
              clip={clip}
              isSelected={selectedClips.includes(clip.localUrl)}
              onSelect={() => toggleSelect(clip.localUrl)}
              onPreview={() => setPreviewClip(clip)}
              onEdit={() => navigate("/edit/" + encodeURIComponent(clip.localUrl))}
            />
          ))}
        </div>
      </section>

      {/* SHORTS SECTION */}
      <section>
        <div className="flex items-center gap-4 mb-8">
          <h2 className="text-2xl font-black tracking-tight uppercase">VIRAL SHORTS</h2>
          <div className="h-px flex-grow bg-slate-800"></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {clips.filter(c => c.type === 'SHORT' || !c.localUrl.includes('VOD')).map((clip) => (
            <ShortCard
              key={clip.localUrl}
              clip={clip}
              isSelected={selectedClips.includes(clip.localUrl)}
              onSelect={() => toggleSelect(clip.localUrl)}
              onPreview={() => setPreviewClip(clip)}
              onEdit={() => navigate("/edit/" + encodeURIComponent(clip.localUrl))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// --- HELPER COMPONENTS ---

function VideoCard({ clip, isSelected, onSelect, onPreview, onEdit }) {
  return (
    <div
      className={"w-full max-w-[400px] group relative bg-[#1e293b] rounded-[2rem] transition-all duration-500 ease-out cursor-pointer " +
        (isSelected ? "z-20 scale-105 shadow-2xl border-2 border-blue-500/50" : "border-2 border-transparent hover:scale-[1.02] hover:bg-slate-800")}
      onClick={onPreview}
    >
      <div className="aspect-video bg-black rounded-[1.8rem] overflow-hidden relative m-1">
        {clip.thumbnail ? (
          <img
            src={clip.thumbnail}
            className={"w-full h-full object-cover transition-all duration-700 " + (isSelected ? "scale-110" : "opacity-60 group-hover:opacity-100")}
            alt="VOD Thumbnail"
          />
        ) : (
          <video
            key={clip.localUrl}
            muted
            playsInline
            preload="metadata"
            className={"w-full h-full object-cover transition-all duration-700 " + (isSelected ? "scale-110 opacity-100" : "opacity-60 group-hover:opacity-100")}
          >
            <source src={clip.localUrl + "#t=2"} type="video/mp4" />
          </video>
        )}

        <div className="absolute top-4 right-4 z-30">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-2xl transition-all active:scale-90"
          >
            Edit Clip
          </button>
        </div>

        <div className="absolute top-4 left-4 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onSelect(); }}
            className="w-6 h-6 rounded-full border-2 border-white/20 accent-blue-500 cursor-pointer shadow-2xl transition-transform active:scale-75"
          />
        </div>
      </div>
      <div className="px-6 py-4">
        <h3 className={"text-[13px] font-black tracking-wider uppercase transition-all duration-300 " + (isSelected ? "text-blue-400" : "text-slate-400")}>
          {clip.title || "Untitled Master"}
        </h3>
      </div>
    </div>
  );
}

function ShortCard({ clip, isSelected, onSelect, onPreview, onEdit }) {
  return (
    <div
      className={"w-full max-w-[220px] group relative bg-[#1e293b] rounded-[2.5rem] transition-all duration-500 ease-out cursor-pointer " +
        (isSelected ? "z-20 scale-105 shadow-2xl border-2 border-blue-500/50" : "border-2 border-transparent hover:scale-[1.02] hover:bg-slate-800")}
      onClick={onPreview}
    >
      <div className="aspect-[9/16] bg-black rounded-[2.3rem] overflow-hidden relative m-1">
        {clip.thumbnail ? (
          <img
            src={clip.thumbnail}
            className={"w-full h-full object-cover transition-all duration-700 " + (isSelected ? "scale-110" : "")}
            alt="Short Thumbnail"
          />
        ) : (
          <video
            key={clip.localUrl}
            muted
            playsInline
            preload="metadata"
            className={"w-full h-full object-cover transition-all duration-700 " + (isSelected ? "scale-110 opacity-100" : "opacity-100")}
          >
            <source src={clip.localUrl + "#t=2"} type="video/mp4" />
          </video>
        )}

        <div className="absolute top-4 right-4 z-30">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-2xl transition-all active:scale-90"
          >
            Edit Clip
          </button>
        </div>

        <div className="absolute top-5 left-5 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onSelect(); }}
            className="w-6 h-6 rounded-full border-2 border-white/20 accent-blue-500 cursor-pointer shadow-2xl transition-transform active:scale-75"
          />
        </div>
      </div>
      <div className="px-5 py-5 text-center">
        <h3 className={"text-[11px] font-black tracking-widest uppercase transition-all duration-300 " + (isSelected ? "text-blue-400" : "text-slate-500")}>
          {clip.title || "AI Short"}
        </h3>
      </div>
    </div>
  );
}

export default HomePage;
