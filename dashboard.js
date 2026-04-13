const express = require('express');
const path = require('path');
const db = require('./src/db.js');

function startDashboard(port = 3000) {
  const app = express();

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

  const server = app.listen(port, () => {
    console.log(`[Dashboard] Server running at http://localhost:${port}`);
  });
  
  // Handling grace shutdowns safely for express instances
  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());
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