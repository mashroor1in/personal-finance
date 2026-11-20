#!/usr/bin/env node

/**
 * Bucksy Database Migration Helper
 * 
 * This script helps apply database migrations to a Cloudflare Pages project.
 * It can be run manually or as part of the setup process.
 */

const fs = require('fs');
const path = require('path');

// Migration files to apply
const MIGRATIONS = [
  '0006_waitlist.sql',
  '0007_waitlist_verification_sent_at.sql',
  '0008_email_logs.sql',
  '0009_admin_tables.sql'
];

// Sample data to insert
const SAMPLE_DATA = [
  {
    table: 'waitlist',
    data: [
      "('sample-user-1', 'user1@example.com', 'Alice Johnson', 'verified', 1698765432100, 1698765432100)",
      "('sample-user-2', 'user2@example.com', 'Bob Smith', 'pending', 1698765432100, 1698765432100)",
      "('sample-user-3', 'user3@example.com', 'Carol Davis', 'verified', 1698765432100, 1698765432100)"
    ]
  },
  {
    table: 'admin_actions',
    data: [
      "('sample-action-1', 'admin', 'admin@bucksy.life', 'Test dashboard access', '{}', 1698765432100)"
    ]
  }
];

async function runMigration() {
  console.log('🚀 Starting Bucksy database migration...');
  
  try {
    // Check if wrangler is installed
    const { execSync } = require('child_process');
    
    try {
      execSync('wrangler --version', { stdio: 'ignore' });
    } catch (error) {
      console.error('❌ Wrangler is not installed. Please install it first:');
      console.log('   npm install -g wrangler');
      process.exit(1);
    }
    
    // Check if database exists
    try {
      execSync('wrangler d1 list | grep "bucksy-db"', { stdio: 'ignore' });
      console.log('✅ Database found');
    } catch (error) {
      console.error('❌ Database not found. Please create it first:');
      console.log('   wrangler d1 create bucksy-db');
      process.exit(1);
    }
    
    // Apply migrations
    console.log('🔧 Applying migrations...');
    
    for (const migrationFile of MIGRATIONS) {
      const migrationPath = path.join(__dirname, '..', 'migrations', migrationFile);
      
      if (!fs.existsSync(migrationPath)) {
        console.warn(`⚠️  Migration file not found: ${migrationPath}`);
        continue;
      }
      
      console.log(`Applying ${migrationFile}...`);
      try {
        execSync(`wrangler d1 execute bucksy-db --file=${migrationPath}`, { 
          stdio: 'inherit' 
        });
        console.log(`✅ ${migrationFile} applied successfully`);
      } catch (error) {
        console.error(`❌ Failed to apply ${migrationFile}:`, error.message);
      }
    }
    
    // Add sample data
    console.log('📝 Adding sample data...');
    
    for (const { table, data } of SAMPLE_DATA) {
      for (const values of data) {
        const command = `wrangler d1 execute bucksy-db --command="INSERT INTO ${table} (id, email, name, status, created_at, updated_at) VALUES ${values};"`;
        try {
          execSync(command, { stdio: 'inherit' });
        } catch (error) {
          console.error(`❌ Failed to insert sample data into ${table}:`, error.message);
        }
      }
    }
    
    console.log('✅ Sample data added');
    
    // Generate admin token
    const adminToken = generateAdminToken();
    console.log(`🔑 Generated admin token: ${adminToken}`);
    
    // Update pages.toml
    updatePagesToml(adminToken);
    
    console.log('🎉 Migration complete!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Update your email provider API key in pages.toml');
    console.log('2. Deploy your Pages project:');
    console.log('   wrangler pages deploy');
    console.log('3. Access the admin dashboard:');
    console.log('   https://your-domain.com/admin/login');
    console.log('');
    console.log('💡 Tip: Save this admin token somewhere safe!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

function generateAdminToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('base64');
}

function updatePagesToml(adminToken) {
  const pagesTomlPath = path.join(__dirname, '..', 'pages.toml');
  
  const pagesTomlContent = `# Cloudflare Pages configuration for Bucksy project

[build]
command = "npm run build"  # Or your build command if you have one

[build.environment]
NODE_VERSION = "18"

# Environment variables
[env.production]
vars = { 
  ADMIN_TOKEN = "${adminToken}",
  WAITLIST_EMAIL_PROVIDER = "resend",
  RESEND_API_KEY = "your_resend_api_key_here",
  WAITLIST_FROM_EMAIL = "noreply@bucksy.life"
}
`;
  
  fs.writeFileSync(pagesTomlPath, pagesTomlContent);
  console.log('✅ Updated pages.toml with environment variables');
}

// Run the migration
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };