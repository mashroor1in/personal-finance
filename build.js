#!/usr/bin/env node

/**
 * Simple build script for Cloudflare Pages deployment
 * This script ensures all necessary files are in place for deployment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Starting build process for Cloudflare Pages...');

// Ensure public directory exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('✅ Created public directory');
}

// Copy admin files to public directory if they exist
const adminFiles = [
  'admin.html',
  'admin-login.html'
];

adminFiles.forEach(file => {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(publicDir, file);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✅ Copied ${file} to public directory`);
  }
});

// Ensure functions directory is properly structured
const functionsDir = path.join(__dirname, 'functions');
if (fs.existsSync(functionsDir)) {
  console.log('✅ Functions directory exists');
}

// Create a simple index.html in public if it doesn't exist
const indexPath = path.join(publicDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bucksy Admin Dashboard</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        h1 {
            margin-top: 0;
        }
        .admin-link {
            display: inline-block;
            margin-top: 1rem;
            padding: 0.75rem 2rem;
            background: white;
            color: #667eea;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .admin-link:hover {
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bucksy Admin Dashboard</h1>
        <p>Welcome to the Bucksy administration interface.</p>
        <a href="/admin" class="admin-link">Access Admin Dashboard</a>
    </div>
</body>
</html>
  `);
  console.log('✅ Created index.html in public directory');
}

console.log('🎉 Build process completed successfully!');
console.log('📁 Ready for Cloudflare Pages deployment');