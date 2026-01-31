import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditPage from './pages/EditPage';
import io from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const socket = io(API_URL);

function App() {
  const [clips, setClips] = useState([]);
  const [status, setStatus] = useState({ isProcessing: false, progress: 0, logs: [] });

  useEffect(() => {
    // 🧼 THE BRAIN WASH: Kill ghosts when server restarts
    const handleReset = () => {
      console.log("🧼 SERVER RESET: Clearing persistent memory.");
      localStorage.removeItem('lokmat_processed_clips');
      setClips([]);
      setStatus({ isProcessing: false, progress: 0, logs: [] });
      window.location.reload();
    };

    socket.on("SESSION_HARD_RESET", handleReset);
    socket.on("GLOBAL_RESET", handleReset);

    socket.on("statusUpdate", (data) => {
      if (data.newClip) {
        setClips((prev) => {
          const exists = prev.find((c) => c.localUrl === data.newClip.localUrl);

          // Force thumbnail cache busting with timestamp
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
          isProcessing: data.progress > 0 && data.progress < 100,
          logs: data.log ? [...prev.logs, data.log].slice(-10) : prev.logs
        }));
      }
    });

    return () => {
      socket.off("SESSION_HARD_RESET");
      socket.off("statusUpdate");
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={<HomePage clips={clips} setClips={setClips} status={status} setStatus={setStatus} socket={socket} />}
        />
        <Route path="/edit/:id" element={<EditPage />} />
      </Routes>
    </Router>
  );
}

export default App;