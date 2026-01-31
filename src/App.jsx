import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditPage from './pages/EditPage';
import io from 'socket.io-client';

// --- VERSION 3.03: CLOUD HANDSHAKE FIX ---
function App() {
  const [clips, setClips] = useState([]);
  const [status, setStatus] = useState({ isProcessing: false, progress: 0, logs: [] });
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Force direct connection to Google Cloud Run
    const backendUrl = "https://lokmat-slicer-453213181309.us-central1.run.app";
    console.log("🚀 LOKMAT STUDIO: Initializing Engine at:", backendUrl);

    const newSocket = io(backendUrl, {
  path: "/socket.io/",
  transports: ["websocket"], // 👈 STRICT: Remove 'polling' entirely
  upgrade: false,             // 👈 CRITICAL: Stop it from trying to switch methods
  withCredentials: true,
  secure: true,
  reconnection: true,
  reconnectionAttempts: 10,
  timeout: 45000 
});

    newSocket.on("connect", () => {
      console.log("✅ ENGINE CONNECTED! Session ID:", newSocket.id);
    });

    newSocket.on("connect_error", (err) => {
      console.error("❌ CONNECTION ERROR:", err.message);
    });

    // 🧼 THE BRAIN WASH: Kill ghosts when server restarts
    const handleReset = () => {
      console.log("🧼 SERVER RESET: Clearing memory.");
      localStorage.removeItem('lokmat_processed_clips');
      setClips([]);
      setStatus({ isProcessing: false, progress: 0, logs: [] });
      window.location.reload();
    };

    newSocket.on("SESSION_HARD_RESET", handleReset);
    newSocket.on("GLOBAL_RESET", handleReset);

    newSocket.on("statusUpdate", (data) => {
      if (data.newClip) {
        setClips((prev) => {
          const exists = prev.find((c) => c.localUrl === data.newClip.localUrl);
          const updatedClip = {
            ...data.newClip,
            thumbnail: data.newClip.thumbnail
              ? `${data.newClip.thumbnail.split('?')[0]}?v=${Date.now()}`
              : null
          };
          if (exists) {
            return prev.map(c => c.localUrl === updatedClip.localUrl ? updatedClip : c);
          }
          return [updatedClip, ...prev];
        });
      }

      if (data.progress !== undefined || data.log) {
        setStatus((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          isProcessing: (data.progress > 0 && data.progress < 100),
          logs: data.log ? [...prev.logs, data.log].slice(-10) : prev.logs
        }));
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.off("SESSION_HARD_RESET");
      newSocket.off("statusUpdate");
      newSocket.disconnect();
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            /* 🛡️ GUARD: Only show HomePage once the socket is initialized */
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
