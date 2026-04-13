const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const db = require('./src/db.js');

function startDashboard(port = 3000) {
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server);

  // Configure EJS template engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Define main route
  app.get('/', async (req, res) => {
    try {
      // Ensure the read-only queries don't fail immediately due to non-existent tables
      // This ensures safety when db is completely empty
      await db.setupDatabase();
      
      const stats = await db.getDashboardStats();
      const changes = await db.getDashboardChanges(50);
      const listings = await db.getDashboardListings();

      res.render('dashboard', {
        stats,
        changes,
        listings
      });
    } catch (err) {
      console.error("[Dashboard] Request error:", err);
      // Provide a fallback clean empty state error handling
      res.render('dashboard', {
        error: "Could not load data. " + err.message,
        stats: { activeListings: 0, recentChanges: 0 },
        changes: [],
        listings: []
      });
    }
  });

  // Background polling to detect DB changes and broadcast to clients
  let lastRunId = null;
  const pollInterval = setInterval(async () => {
    try {
      // Find the most recently finished scrape run
      const result = await db.db.execute(`
        SELECT run_id 
        FROM scrape_runs 
        WHERE finished_at IS NOT NULL 
        ORDER BY finished_at DESC LIMIT 1
      `);
      
      if (result.rows.length > 0) {
        const currentRunId = result.rows[0].run_id;
        
        if (lastRunId !== null && currentRunId !== lastRunId) {
          // A new run has finished since we last checked!
          io.emit('db_updated');
        }
        
        lastRunId = currentRunId;
      }
    } catch (e) {
      // Ignore errors (e.g. table doesn't exist yet on first boot before setup completes)
    }
  }, 5000);

  const activeServer = server.listen(port, () => {
    console.log(`[Dashboard] Server running at http://localhost:${port}`);
  });
  
  io.on('connection', (socket) => {
    // Client connected
  });

  // Handling grace shutdowns safely for express instances
  const cleanup = () => {
    clearInterval(pollInterval);
    activeServer.close();
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

if (require.main === module) {
  // If run directly: `node dashboard.js`
  const port = process.argv.includes('--port') 
    ? process.argv[process.argv.indexOf('--port') + 1] 
    : 3000;
  startDashboard(port);
}

module.exports = {
  startDashboard
};