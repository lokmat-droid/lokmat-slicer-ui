import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditPage from './pages/EditPage';
import io from 'socket.io-client';

// --- VERSION 3.05: CLOUD HANDSHAKE + NO-RELOAD RESET + ESBUILD-SAFE STRINGS ---
function App() {
  const [clips, setClips] = useState([]);
  const [status, setStatus] = useState({ isProcessing: false, progress: 0, logs: [] });
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // ✅ SINGLE SOURCE OF TRUTH: Use one stable backend base for BOTH fetch + socket
    const backendUrl = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

    console.log("LOKMAT STUDIO: Initializing Engine at:", backendUrl);

    const newSocket = io(backendUrl, {
      path: "/socket.io/",
      transports: ["websocket"],
      upgrade: false,
      withCredentials: false, // ✅ keep false unless you really need cookies
      secure: backendUrl.indexOf("https://") === 0,
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 45000
    });

    newSocket.on("connect", () => {
      console.log("ENGINE CONNECTED! Session ID:", newSocket.id);
      setStatus((prev) => ({
        ...prev,
        logs: ([]).concat(prev.logs || [], ["Engine connected: " + newSocket.id]).slice(-10)
      }));
    });

    newSocket.on("connect_error", (err) => {
      console.error("CONNECTION ERROR:", err.message);
      setStatus((prev) => ({
        ...prev,
        logs: ([]).concat(prev.logs || [], ["Socket connect_error: " + err.message]).slice(-10)
      }));
    });

    // 🧼 HARD FIX: DO NOT reload. Reload is the silent refresh killer.
    // App.jsx
// --- VERSION 3.04: SHIELDED ENGINE HANDLER ---

const handleReset = (payload) => {
  // 🛡️ THE SHIELD: If the engine is mid-stream, ignore the reset to prevent UI jump-back
  setStatus((currentStatus) => {
    if (currentStatus.isProcessing && currentStatus.progress > 0 && currentStatus.progress < 100) {
      console.log("🛡️ SHIELD ACTIVE: Server signaled reset, but we are mid-process. Staying alive.");
      return currentStatus;
    }

    console.log("🧼 SERVER RESET: Cleaning state, keeping page alive.", payload || "");
    localStorage.removeItem('lokmat_processed_clips');
    localStorage.removeItem('processedClips');
    setClips([]);
    
    return { 
      isProcessing: false, 
      progress: 0, 
      logs: ["⚠️ Server restarted. Connection resumed."] 
    };
  });
};

newSocket.on("SESSION_HARD_RESET", handleReset);
newSocket.on("GLOBAL_RESET", handleReset);

newSocket.on("statusUpdate", (data) => {
  if (data && data.newClip) {
    setClips((prev) => {
      const exists = prev.find((c) => c.localUrl === data.newClip.localUrl);
      const updatedClip = {
        ...data.newClip,
        thumbnail: data.newClip.thumbnail
          ? (data.newClip.thumbnail.split('?')[0] + "?v=" + Date.now())
          : null
      };
      if (exists) {
        return prev.map(c => (c.localUrl === updatedClip.localUrl ? updatedClip : c));
      }
      return [updatedClip].concat(prev);
    });
  }

  if (data && (data.progress !== undefined || data.log)) {
    setStatus((prev) => {
      const nextProgress = (data.progress !== undefined ? data.progress : prev.progress);
      
      // LOGIC: Ensure we don't drop 'isProcessing' if a log comes in without progress data
      return {
        ...prev,
        progress: nextProgress,
        isProcessing: (nextProgress > 0 && nextProgress < 100),
        logs: data.log ? ([]).concat(prev.logs || [], [data.log]).slice(-10) : (prev.logs || [])
      };
    });
  }
});

    newSocket.on("upload-progress", (data) => {
      if (!data) return;
      setStatus((prev) => {
        const nextProgress = (data.percent !== undefined ? data.percent : prev.progress);
        return {
          ...prev,
          progress: nextProgress,
          isProcessing: (nextProgress > 0 && nextProgress < 100),
          logs: data.status ? ([]).concat(prev.logs || [], ["UPLOAD: " + data.status]).slice(-10) : (prev.logs || [])
        };
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.off("SESSION_HARD_RESET", handleReset);
      newSocket.off("GLOBAL_RESET", handleReset);
      newSocket.off("statusUpdate");
      newSocket.off("upload-progress");
      newSocket.disconnect();
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            socket ? (
              <HomePage
                clips={clips}
                setClips={setClips}
                status={status}
                setStatus={setStatus}
                socket={socket}
              />
            ) : (
              <div style={{
                backgroundColor: '#1a1a1a',
                color: 'white',
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'sans-serif'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <h2 style={{ marginBottom: '10px' }}>Initializing Lokmat AI Engine...</h2>
                  <p style={{ opacity: 0.7 }}>Establishing handshake with Google Cloud...</p>
                </div>
              </div>
            )
          }
        />
        <Route path="/edit/:id" element={<EditPage />} />
      </Routes>
    </Router>
  );
}

export default App;
