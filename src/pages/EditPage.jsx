import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const YOUTUBE_CHANNELS = [
  { key: "Lokmat", id: "UC5MHSwQ2menwYF2DqKoJsZg" },
  { key: "Lokmat Filmy", id: "UCC_aEK1jUpUPaa_N1aamvlA" },
  { key: "Lokmat Sakhi", id: "UCyWi2qIqXKGZSya5mpvwokA" },
  { key: "Lokmat Bhakti", id: "UCRPaDR9Y6tOH3Hgi9H23acw" },
  { key: "Lokmat Hindi", id: "UCmqx3ukqhdbSJWJB_SdCbqA" }
];

function EditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoUrl = decodeURIComponent(id);

  // Extract filename from the URL (e.g., /outputs/SHORT_1.mp4 -> SHORT_1.mp4)
  const filename = videoUrl.split('/').pop();

  // --- STATE FOR AI METADATA ---
  const [metadata, setMetadata] = useState({
    title: "Loading AI Title...",
    description: "Fetching Marathi description...",
    keywords: "news, lokmat, trending"
  });

  const [selectedChannels, setSelectedChannels] = useState([]);

  // --- 1. Add these new states at the top of EditPage ---
  const [publishConfig, setPublishConfig] = useState({
    privacy: 'private', // Draft = private
    scheduleDate: '',
    scheduleTime: ''
  });

  // --- FETCH ACTUAL AI METADATA FROM BACKEND ---
  useEffect(() => {
    if (!filename) return;

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    fetch(`${API_URL}/api/metadata/${encodeURIComponent(filename)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setMetadata({
            title: data.title || "Untitled Clip",
            description: data.description || "No description generated.",
            keywords: data.keywords || "news, lokmat"
          });
        }
      })
      .catch(err => {
        console.error("Error fetching metadata:", err);
        setMetadata({
          title: "Error Loading Data",
          description: "Could not connect to the metadata server.",
          keywords: ""
        });
      });
  }, [filename]);

  const toggleChannel = (channelId) => {
    setSelectedChannels(prev =>
      prev.includes(channelId) ? prev.filter(i => i !== channelId) : [...prev, channelId]
    );
  };

  // --- 2. Update the handlePushToYouTube function ---
  const handlePushToYouTube = async () => {
    if (selectedChannels.length === 0) return alert("Select a channel!");

    try {
      const response = await fetch('http://localhost:3000/api/social/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelIds: selectedChannels,
          videoPath: videoUrl,
          options: publishConfig, // Sends privacy + schedule
          metadata: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.keywords.split(',').map(k => k.trim())
          }
        }),
      });
      const result = await response.json();

      if (result.success) {
        let msg = `✅ REAL SUCCESS: Video is now in Studio for: ${result.uploadedTo.join(', ')}`;
        if (result.errors && result.errors.length > 0) {
          msg += `\n⚠️ PARTIAL ERRORS:\n${result.errors.join('\n')}`;
        }
        alert(msg);
      } else {
        const errText = Array.isArray(result.errors) ? result.errors.join('\n') : result.error || "Unknown Error";
        alert(`❌ REAL FAILURE:\n${errText}`);
      }
    } catch (err) {
      alert("❌ Push Failed: Server connection error.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-200 p-6 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-slate-800 rounded-full text-sm font-bold hover:bg-slate-700 transition-all">
          ← BACK
        </button>
        <div className="text-center">
          <h1 className="text-xl font-black tracking-tighter uppercase italic text-blue-500">Advanced Slicer Pro</h1>
        </div>
        <div className="w-20"></div> {/* Spacer */}
      </div>

      <div className="grid grid-cols-12 gap-6">

        {/* LEFT: Video & Metadata Inputs */}
        <div className="col-span-8 space-y-6">
          <div className="bg-black rounded-[2.5rem] overflow-hidden aspect-video border border-slate-800 shadow-2xl">
            <video src={videoUrl} controls className="w-full h-full" />
          </div>

          {/* AI Metadata Section - NOW CONNECTED TO PERSISTENT JSON */}
          <div className="bg-slate-900/40 p-8 rounded-[2.5rem] border border-slate-800 space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Video Title</label>
              <input
                value={metadata.title}
                onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mt-1 focus:border-blue-500 outline-none font-bold text-blue-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Description</label>
              <textarea
                rows="6"
                value={metadata.description}
                onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mt-1 focus:border-blue-500 outline-none text-sm leading-relaxed"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Keywords (Comma separated)</label>
              <input
                value={metadata.keywords}
                onChange={(e) => setMetadata({ ...metadata, keywords: e.target.value })}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl p-4 mt-1 focus:border-blue-500 outline-none text-xs font-mono text-slate-400"
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Channel Selection & Publish */}
        <div className="col-span-4 space-y-6">
          <div className="bg-slate-900/80 p-6 rounded-[2.5rem] border border-slate-800 shadow-xl">
            <h3 className="text-center text-[11px] font-black uppercase tracking-[0.3em] mb-6 text-slate-400">Target Channels</h3>

            <div className="space-y-2 mb-6">
              {YOUTUBE_CHANNELS.map((ch) => (
                <button key={ch.id} onClick={() => toggleChannel(ch.id)} className={`w-full p-4 rounded-2xl text-left transition-all border-2 flex justify-between items-center ${selectedChannels.includes(ch.id) ? 'bg-blue-600/20 border-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.2)]' : 'bg-slate-800/50 border-transparent text-slate-400 hover:bg-slate-800'}`}>
                  <span className="font-bold">{ch.key}</span>
                  {selectedChannels.includes(ch.id) && <span>✅</span>}
                </button>
              ))}
            </div>

            {/* NEW: PUBLISH SETTINGS */}
            <div className="bg-slate-900/80 p-6 rounded-[2.5rem] border border-slate-800 shadow-xl space-y-10">
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Publication Visibility</label>
                <select
                  value={publishConfig.privacy}
                  onChange={(e) => setPublishConfig({ ...publishConfig, privacy: e.target.value })}
                  className="w-full bg-slate-800 p-4 rounded-2xl text-sm border border-slate-700 outline-none focus:border-blue-500 transition-all"
                >
                  <option value="private">Save as Draft (Private)</option>
                  <option value="unlisted">Unlisted Link</option>
                  <option value="public">Go Public Immediately</option>
                  <option value="scheduled">Schedule Post</option>
                </select>
              </div>

              {/* THE SCHEDULE DRAWER */}
              {publishConfig.privacy === 'scheduled' && (
                <div className="p-5 bg-blue-600/5 rounded-3xl border border-blue-500/20 space-y-4 animate-in fade-in slide-in-from-top-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 font-bold uppercase">Publish Date</label>
                      <input type="date" className="w-full bg-slate-900 p-3 rounded-xl text-xs border border-slate-800" onChange={(e) => setPublishConfig({ ...publishConfig, scheduleDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 font-bold uppercase">Publish Time</label>
                      <input type="time" className="w-full bg-slate-900 p-3 rounded-xl text-xs border border-slate-800" onChange={(e) => setPublishConfig({ ...publishConfig, scheduleTime: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* PADDED ACTION BUTTON */}
              <div className="pt-6">
                <button onClick={handlePushToYouTube} className="w-full py-5 bg-gradient-to-r from-red-600 to-blue-600 rounded-3xl font-black uppercase tracking-widest transition-all scale-105 shadow-[0_20px_40px_rgba(37,99,235,0.3)] hover:brightness-125 active:scale-95">
                  Finalize & Push to YouTube
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default EditPage;