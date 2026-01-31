const fs = require('fs');
const path = require('path');

// We use '..' to go UP from the frontend folder to the main lokmat-slicer folder
const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'outputs');
const dbFile = path.join(rootDir, 'processed_files.json'); 

console.log("🛠️ Targeting Root:", rootDir);

// 1. Reset Database
if (fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, '{}');
    console.log("📂 Database reset to empty.");
} else {
    console.log("⚠️ Database file not found at:", dbFile);
}

// 2. Clear Media Files
if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir);
    files.forEach(f => {
        if (f.endsWith('.mp4') || f.endsWith('.jpg')) {
            fs.unlinkSync(path.join(outputDir, f));
        }
    });
    console.log("🎥 Output media cleared.");
} else {
    console.log("⚠️ Output folder not found at:", outputDir);
}

console.log("🧹 System Reset Complete.");