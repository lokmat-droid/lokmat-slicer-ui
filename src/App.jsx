```jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditPage from './pages/EditPage';
import io from 'socket.io-client';

// --- VERSION 3.04: CLOUD HANDSHAKE + NO-RELOAD RESET + CORS-SAFE SOCKET ---
function App() {
  const [clips, setClips] = useState([]);
  const [status, setStatus] = useState({ isProcessing: false, progress: 0, logs: [] });
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // ✅ SINGLE SOURCE OF TRUTH: Use one stable backend base for BOTH fetch + socket
    const backendUrl = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

    console.log("🚀 LOKMAT STUDIO: Initializing Engine at:", backendUrl);

    const newSocket = io(backendUrl, {
      path: "/socket.io/",
      transports: ["websocket"], // 🚀 FORCE WEBSOCKET ONLY
      upgrade: false,            // 🚀 DISABLE POLLING UPGRADES
      withCredentials: false,    // ✅ CORS-SAFE: avoid credentialed CORS unless you truly need cookies
      secure: backendUrl.startsWith("https"),
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 45000
    });

    newSocket.on("connect", () => {
      console.log("✅ ENGINE CONNECTED! Session ID:", newSocket.id);
      setStatus((prev) => ({
        ...prev,
        logs: [...(prev.logs || []), `✅ Engine connected: ${newSocket.id}`].slice(-10)
      }));
    });

    newSocket.on("connect_error", (err) => {
      console.error("❌ CONNECTION ERROR:", err.message);
      setStatus((prev) => ({
        ...prev,
        logs: [...(prev.logs || []), `❌ Socket connect_error: ${err.message}`].slice(-10)
      }));
    });

    // 🧼 THE BRAIN WASH: Kill ghosts when server restarts
    // ✅ HARD FIX: DO NOT reload the page. Reload is the "silent refresh" killer.
    const handleReset = (payload) => {
      console.log("🧼 SERVER RESET: Clearing memory (NO RELOAD).", payload || "");
      localStorage.removeItem('lokmat_processed_clips');
      localStorage.removeItem('processedClips');
      setClips([]);
      setStatus({
        isProcessing: false,
        progress: 0,
        logs: ["🧼 Server reset received. State cleared (no reload)."]
      });
      // window.location.reload(); // ❌ removed
    };

    newSocket.on("SESSION_HARD_RESET", handleReset);
    newSocket.on("GLOBAL_RESET", handleReset);

    // Keep the global statusUpdate listener here (App-level source of truth)
    newSocket.on("statusUpdate", (data) => {
      if (data?.newClip) {
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

      if (data?.progress !== undefined || data?.log) {
        setStatus((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          isProcessing: ((data.progress ?? prev.progress) > 0 && (data.progress ?? prev.progress) < 100),
          logs: data.log ? [...(prev.logs || []), data.log].slice(-10) : (prev.logs || [])
        }));
      }
    });

    // Optional: keep upload-progress at App-level as well, so HomePage doesn't need to duplicate
    newSocket.on("upload-progress", (data) => {
      if (!data) return;
      setStatus((prev) => ({
        ...prev,
        progress: data.percent ?? prev.progress,
        isProcessing: (data.percent ?? prev.progress) > 0 && (data.percent ?? prev.progress) < 100,
        logs: data.status ? [...(prev.logs || []), `⚙️ ${data.status}`].slice(-10) : (prev.logs || [])
      }));
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
